import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"
import {
  collectCiActionLifecycleFailures,
  collectContentSecurityPolicyFailures,
  collectSecurityHeaderPolicyFailures,
  runEvalCases,
} from "./run-evals.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, "../..")
const risks = ["low", "medium", "high", "critical"]

async function readText(root, relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8")
}

async function readJson(root, relativePath) {
  return JSON.parse(await readText(root, relativePath))
}

async function fileExists(root, relativePath) {
  try {
    await fs.access(path.join(root, relativePath))
    return true
  } catch {
    return false
  }
}

function probe(passed, summary, evidence = []) {
  return { passed, summary, evidence }
}

async function sourceContract(root, contracts, summary) {
  const missing = []
  for (const [relativePath, snippets] of Object.entries(contracts)) {
    let source = ""
    try {
      source = await readText(root, relativePath)
    } catch {
      missing.push(`${relativePath} is missing`)
      continue
    }
    for (const snippet of snippets) {
      if (!source.includes(snippet)) missing.push(`${relativePath} lacks ${snippet}`)
    }
  }
  return probe(
    missing.length === 0,
    summary,
    missing.length === 0 ? Object.keys(contracts) : missing,
  )
}

async function editorialSeo(root) {
  return sourceContract(
    root,
    {
      "quartz/components/Head.tsx": [
        'rel="canonical"',
        'type="application/ld+json"',
        'property="article:published_time"',
        "isNotesFallback",
      ],
      "quartz/components/seo.ts": ["BlogPosting", "canonicalPageUrl", "serializeStructuredData"],
      "scripts/quality/check-build.mjs": [
        "expectedCanonicalUrl",
        "validateSeoMetadata",
        "needs BlogPosting structured data",
      ],
    },
    "Canonical, article semantics, JSON-LD, and notes fallback deduplication are governed.",
  )
}

async function editorialRss(root) {
  return sourceContract(
    root,
    {
      "scripts/build-site-extras.mjs": ["renderEditorialRss", "editorialPosts", "renderRobotsTxt"],
      "scripts/quality/check-build.mjs": ["blog RSS contains a non-article item"],
      "package.json": ["build-site-extras.mjs --site blog"],
    },
    "The blog feed and robots file are generated from the editorial post index.",
  )
}

async function fontAuthority(root) {
  const config = parseYaml(await readText(root, "quartz.config.yaml"))
  const fonts = (config.plugins ?? []).find(
    (plugin) => plugin.source === "github:quartz-community/fonts",
  )
  const quality = await readText(root, "scripts/quality/check-build.mjs")
  const passed =
    fonts?.enabled === false && quality.includes("must not load remote Google Fonts stylesheets")
  return probe(passed, "Typography has one generated authority and no remote font stylesheet.", [
    `fonts plugin enabled=${String(fonts?.enabled)}`,
    "build HTML remote-font rejection contract",
  ])
}

async function readerContinuity(root) {
  return sourceContract(
    root,
    {
      "scripts/sync-notes.mjs": ["rankRelatedPosts", "related-reading"],
      "quartz/styles/custom.scss": [".related-reading"],
      "tests/quality/site-quality.spec.ts": ["data-related-reading"],
    },
    "Articles provide deterministic, tested continuation links.",
  )
}

async function anonymousFeedback(root) {
  return sourceContract(
    root,
    {
      "services/reactions/server.mjs": ["/api/reactions", "/api/visitors", "sha256"],
      "services/reactions/server.test.mjs": ["assigns stable daily visitor ordinals"],
      "services/reactions/deployment.test.mjs": ["stores anonymous identifiers as hashes"],
    },
    "Likes, unique views, and site visitors use the isolated hashed-identity service.",
  )
}

export function validateRuntimeBackupActivation(activation, recipient) {
  const recipientSha256 = createHash("sha256").update(recipient).digest("hex")
  if (
    activation.version !== "1.0.0" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(activation.activatedAt ?? "") ||
    !Number.isSafeInteger(activation.workflowRunId) ||
    activation.workflowRunId <= 0 ||
    !Number.isSafeInteger(activation.artifactId) ||
    activation.artifactId <= 0 ||
    activation.artifactName !== `markz-runtime-backup-${activation.workflowRunId}` ||
    !/^sha256:[a-f0-9]{64}$/.test(activation.artifactDigest ?? "") ||
    !/^[a-f0-9]{40}$/.test(activation.sourceCommit ?? "") ||
    activation.recipientSha256 !== recipientSha256 ||
    activation.retentionDays !== 90 ||
    activation.restoreDrill !== "passed"
  ) {
    return ["off-site backup activation evidence is invalid or stale for its recipient"]
  }
  return []
}

async function runtimeBackup(root) {
  const required = [
    "services/reactions/backup.mjs",
    "services/reactions/backup.test.mjs",
    "services/reactions/offsite-backup.mjs",
    "services/reactions/offsite-backup.test.mjs",
    "scripts/runtime-backup/age-tool.sh",
    "scripts/runtime-backup/bootstrap-key.sh",
    "scripts/runtime-backup/package-encrypted.sh",
    "scripts/runtime-backup/restore-encrypted.sh",
    ".github/workflows/markz-backup.yaml",
    "deploy/runtime-backup-recipient.txt",
    "ai/runtime-backup-activation.json",
  ]
  const missing = []
  for (const file of required)
    if (!(await fileExists(root, file))) missing.push(`${file} is missing`)
  if (missing.length === 0) {
    const compose = await readText(root, "deploy/docker-compose.edge.yml")
    const smoke = await readText(root, "scripts/quality/smoke-production.mjs")
    const workflow = await readText(root, ".github/workflows/markz-backup.yaml")
    const ageTool = await readText(root, "scripts/runtime-backup/age-tool.sh")
    const packageScript = await readText(root, "scripts/runtime-backup/package-encrypted.sh")
    const restoreScript = await readText(root, "scripts/runtime-backup/restore-encrypted.sh")
    const recipient = await readText(root, "deploy/runtime-backup-recipient.txt")
    const activation = await readJson(root, "ai/runtime-backup-activation.json")
    if (!compose.includes("reactions-backup")) missing.push("backup sidecar is not deployed")
    if (!smoke.includes("reactions backup"))
      missing.push("production smoke does not verify backups")
    for (const snippet of [
      "schedule:",
      "backup.mjs latest-json",
      "package-encrypted.sh",
      "MARKZ_RUNTIME_BACKUP_ENABLED",
      "upload-artifact",
      "retention-days: 90",
    ]) {
      if (!workflow.includes(snippet)) missing.push(`off-site backup workflow lacks ${snippet}`)
    }
    for (const snippet of [
      "ephemeral_identity",
      'offsite-backup.mjs" verify',
      'offsite-backup.mjs" restore',
    ]) {
      if (!packageScript.includes(snippet))
        missing.push(`off-site backup packaging lacks ${snippet}`)
    }
    if (!ageTool.includes('MARKZ_AGE_VERSION="1.3.1"')) {
      missing.push("off-site backup age tool is not pinned")
    }
    for (const snippet of [
      "Encrypted artifact checksum does not match",
      'offsite-backup.mjs" restore',
    ]) {
      if (!restoreScript.includes(snippet)) missing.push(`off-site recovery lacks ${snippet}`)
    }
    const recipients = recipient
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
    if (
      recipients.length === 0 ||
      recipients.some((line) => !/^age1[0-9a-z]+$/.test(line)) ||
      recipient.includes("AGE-SECRET-KEY")
    ) {
      missing.push("off-site backup requires public age recipients without private identities")
    }
    missing.push(...validateRuntimeBackupActivation(activation, recipient))
  }
  return probe(
    missing.length === 0,
    "Interaction data has verified automated snapshots and an off-host recovery path.",
    missing.length === 0 ? required : missing,
  )
}

async function productionObservability(root) {
  return sourceContract(
    root,
    {
      ".github/workflows/markz-publish.yaml": ["schedule:", "npm run smoke:production"],
      "scripts/quality/smoke-production.mjs": [
        "note.markz.fun",
        "jsonutils.markz.fun/admin",
        "markz-edge does not own both public ports",
      ],
    },
    "Scheduled publishing checks every public surface, runtime API, and edge port owner.",
  )
}

async function linkDebt(root) {
  const baseline = await readJson(root, "quality/link-baseline.json")
  const count = Array.isArray(baseline.knownBroken) ? baseline.knownBroken.length : 0
  return probe(count === 0, "Public broken-link debt is zero.", [
    `${count} baseline entries remain`,
  ])
}

async function articleSocialImages(root) {
  const config = parseYaml(await readText(root, "quartz.config.yaml"))
  const emitter = (config.plugins ?? []).find(
    (plugin) => plugin.source === "github:quartz-community/og-image",
  )
  const contract = await sourceContract(
    root,
    {
      "scripts/design-system/article-social-images.mjs": [
        "articleSocialImageContract",
        "renderArticleSocialCardSvg",
        "checksum mismatch",
      ],
      "scripts/sync-notes.mjs": ["generateArticleSocialImages", "socialImage:"],
      "quartz/components/Head.tsx": ["socialImageUrl", 'property="og:image:secure_url"'],
      "quartz/plugins/emitters/static.ts": ["social-images", 'QUARTZ_SITE ?? "blog"'],
      "scripts/quality/check-build.mjs": [
        "validateArticleSocialMetadata",
        "maxTotalSocialImageBytes",
      ],
      "scripts/quality/smoke-production.mjs": [
        "validateArticleSocialMetadata",
        "production article social image",
      ],
      "quality/budgets.json": ["maxSocialImageBytes", "maxTotalSocialImageBytes"],
    },
    "Articles generate title-specific governed social cards.",
  )
  const missingFonts = []
  for (const font of [
    "design-system/fonts/noto-sans-sc-chinese-simplified-800-normal.woff",
    "design-system/fonts/noto-sans-sc-latin-800-normal.woff",
  ]) {
    if (!(await fileExists(root, font))) missingFonts.push(`${font} is missing`)
  }
  const evidence = [...contract.evidence, ...missingFonts]
  if (emitter?.enabled !== false) {
    evidence.push(`generic remote-font OG emitter enabled=${String(emitter?.enabled)}`)
  }
  return probe(
    contract.passed && missingFonts.length === 0 && emitter?.enabled === false,
    "Articles generate title-specific governed social cards.",
    contract.passed && missingFonts.length === 0 && emitter?.enabled === false
      ? [
          "content-addressed local card generator",
          "frontmatter metadata contract",
          "1200x630 asset and byte budgets",
        ]
      : evidence,
  )
}

async function evolutionControlPlane(root) {
  const required = [
    "ai/evolution.json",
    "ai/evolution.schema.json",
    "scripts/ai/evolve.mjs",
    "scripts/ai/evolve.test.mjs",
    ".github/prompts/evolve-site.prompt.md",
    ".github/workflows/markz-evolve.yaml",
  ]
  const missing = []
  for (const file of required)
    if (!(await fileExists(root, file))) missing.push(`${file} is missing`)
  if (missing.length === 0) {
    const [manifest, skill, workflow] = await Promise.all([
      readText(root, "ai/manifest.json"),
      readText(root, ".codex/skills/markz-site-maintainer/SKILL.md"),
      readText(root, ".github/workflows/markz-evolve.yaml"),
    ])
    if (!manifest.includes("ai/evolution.json"))
      missing.push("AI manifest omits evolution authority")
    if (!skill.includes("evolve:report")) missing.push("project skill omits the evolution loop")
    if (!workflow.includes("gh issue")) missing.push("evolution workflow does not update one issue")
  }
  return probe(
    missing.length === 0,
    "A governed report ranks current gaps and refreshes one scheduled GitHub task.",
    missing.length === 0 ? required : missing,
  )
}

async function decisionContract(root) {
  return sourceContract(
    root,
    {
      "scripts/ai/check-ai-infra.mjs": [
        "validateDecisionLog",
        "decision numbers must be contiguous",
      ],
      "scripts/ai/check-ai-infra.test.mjs": ["decision log contract"],
    },
    "The complete decision log is structurally checked without a stale ID allowlist.",
  )
}

async function liveEvalEvidence(root) {
  return sourceContract(
    root,
    {
      "scripts/ai/evolve.mjs": ["runEvalCases", "evalReport"],
      ".github/workflows/markz-evolve.yaml": ["npm run evals:check", "evolution-report.json"],
    },
    "Every evolution report embeds the current deterministic eval result.",
  )
}

async function ciActionLifecycle(root) {
  const failures = await collectCiActionLifecycleFailures(root)
  return probe(
    failures.length === 0,
    "CI Actions use immutable current releases with automated lifecycle updates.",
    failures.length === 0
      ? [
          "all remote Actions are pinned to full commit SHAs",
          "Node 24-compatible release annotations are enforced",
          "Dependabot checks GitHub Actions at least weekly",
        ]
      : failures,
  )
}

async function securityHeaderPolicy(root) {
  const failures = await collectSecurityHeaderPolicyFailures(root)
  return probe(
    failures.length === 0,
    "Every edge response preserves the governed security headers across Nginx contexts.",
    failures.length === 0
      ? [
          "one mounted security header authority",
          "every TLS server and cache-header location is covered",
          "production smoke checks pages, APIs, static assets, and 404 responses",
        ]
      : failures,
  )
}

async function contentSecurityPolicy(root) {
  const failures = await collectContentSecurityPolicyFailures(root)
  return probe(
    failures.length === 0,
    "Blog and notes enforce a tested Content Security Policy without runtime violations.",
    failures.length === 0
      ? [
          "host-scoped edge policy with independent product boundaries",
          "zero inline executable scripts and self-hosted dynamic runtimes",
          "build, browser violation, and exact production header enforcement",
        ]
      : failures,
  )
}

const providers = {
  "editorial-seo": editorialSeo,
  "editorial-rss": editorialRss,
  "font-authority": fontAuthority,
  "reader-continuity": readerContinuity,
  "anonymous-feedback": anonymousFeedback,
  "runtime-backup": runtimeBackup,
  "production-observability": productionObservability,
  "link-debt": linkDebt,
  "article-social-images": articleSocialImages,
  "evolution-control-plane": evolutionControlPlane,
  "decision-contract": decisionContract,
  "live-eval-evidence": liveEvalEvidence,
  "ci-action-lifecycle": ciActionLifecycle,
  "security-header-policy": securityHeaderPolicy,
  "content-security-policy": contentSecurityPolicy,
}

export function scoreCapability(capability) {
  return Number(
    ((capability.impact * capability.urgency * capability.confidence) / capability.effort).toFixed(
      2,
    ),
  )
}

export function validateEvolutionProgram(program) {
  const failures = []
  if (!/^\d+\.\d+\.\d+$/.test(program.version ?? "")) {
    failures.push("evolution version must use semantic versioning")
  }
  if (!program.objective || !Array.isArray(program.guardrails) || program.guardrails.length < 3) {
    failures.push("evolution program requires an objective and at least three guardrails")
  }
  if (program.selectionPolicy?.formula !== "impact * urgency * confidence / effort") {
    failures.push("evolution scoring formula is unsupported")
  }
  if (!Array.isArray(program.capabilities) || program.capabilities.length < 5) {
    failures.push("evolution program requires at least five capabilities")
    return failures
  }
  const ids = new Set()
  for (const capability of program.capabilities) {
    if (!capability.id || ids.has(capability.id)) {
      failures.push(`invalid or duplicate capability id: ${capability.id ?? ""}`)
    }
    ids.add(capability.id)
    if (!providers[capability.check])
      failures.push(`${capability.id} uses unknown check ${capability.check}`)
    for (const field of ["impact", "urgency", "confidence", "effort"]) {
      if (!Number.isInteger(capability[field]) || capability[field] < 1 || capability[field] > 5) {
        failures.push(`${capability.id}.${field} must be an integer from 1 to 5`)
      }
    }
    if (!risks.includes(capability.risk)) failures.push(`${capability.id} has invalid risk`)
    if (
      capability.disposition !== undefined &&
      (capability.disposition.status !== "declined" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(capability.disposition.decidedAt ?? "") ||
        !/^D-\d{3}$/.test(capability.disposition.decision ?? "") ||
        !capability.disposition.reason)
    ) {
      failures.push(`${capability.id} has an invalid disposition`)
    }
    if (
      !capability.nextAction ||
      !Array.isArray(capability.validation) ||
      !capability.validation.length
    ) {
      failures.push(`${capability.id} requires a next action and validation commands`)
    }
  }
  return failures
}

export function rankGaps(capabilities) {
  return capabilities
    .filter((capability) => capability.status === "gap")
    .sort(
      (first, second) =>
        second.score - first.score ||
        risks.indexOf(first.risk) - risks.indexOf(second.risk) ||
        first.id.localeCompare(second.id),
    )
}

export function classifyCapability(capability, evidence) {
  if (capability.disposition?.status === "declined") return "declined"
  return evidence.passed ? "achieved" : "gap"
}

function decisionCount(source) {
  return [...source.matchAll(/^## D-\d{3}\s+/gm)].length
}

export async function auditEvolution(root = defaultRoot) {
  const program = await readJson(root, "ai/evolution.json")
  const validationFailures = validateEvolutionProgram(program)
  const capabilities = []
  const probeErrors = []
  if (validationFailures.length === 0) {
    for (const capability of program.capabilities) {
      try {
        const evidence = await providers[capability.check](root)
        capabilities.push({
          ...capability,
          status: classifyCapability(capability, evidence),
          score: scoreCapability(capability),
          evidence,
        })
      } catch (error) {
        probeErrors.push(`${capability.id}: ${error.message}`)
      }
    }
  }
  const evalReport = await runEvalCases(root)
  const decisions = decisionCount(await readText(root, "docs/AI-DECISIONS.md"))
  const gaps = rankGaps(capabilities)
  return {
    generatedAt: new Date().toISOString(),
    version: program.version,
    objective: program.objective,
    guardrails: program.guardrails,
    summary: {
      achieved: capabilities.filter((capability) => capability.status === "achieved").length,
      total: capabilities.length,
      gaps: gaps.length,
      declined: capabilities.filter((capability) => capability.status === "declined").length,
      decisions,
      evalsPassed: evalReport.passed,
      evalsTotal: evalReport.total,
    },
    next: gaps[0] ?? null,
    gaps,
    achieved: capabilities.filter((capability) => capability.status === "achieved"),
    declined: capabilities.filter((capability) => capability.status === "declined"),
    evalReport,
    validationFailures,
    probeErrors,
  }
}

function evidenceLines(capability) {
  return capability.evidence.evidence.map((item) => `- ${item}`).join("\n")
}

export function renderEvolutionMarkdown(report) {
  const next = report.next
    ? `## 下一项\n\n### ${report.next.name}\n\n${report.next.description}\n\n- 评分：${report.next.score}\n- 风险：${report.next.risk}\n- 证据：${report.next.evidence.summary}\n- 动作：${report.next.nextAction}\n- 验证：${report.next.validation.map((item) => `\`${item}\``).join("、")}\n\n${evidenceLines(report.next)}`
    : "## 下一项\n\n当前没有进入自动执行队列的未完成项；定时巡检应复核能力模型并新增有证据的成熟度目标。"
  const queue = report.gaps
    .slice(1)
    .map(
      (capability, index) =>
        `${index + 2}. **${capability.name}** · ${capability.score} · ${capability.risk}：${capability.evidence.summary}`,
    )
    .join("\n")
  const achieved = report.achieved
    .map((capability) => `- **${capability.name}**：${capability.evidence.summary}`)
    .join("\n")
  const declined = (report.declined ?? [])
    .map(
      (capability) =>
        `- **${capability.name}**（${capability.disposition.decision}，${capability.disposition.decidedAt}）：${capability.disposition.reason}；该能力不计入已达成，现有探针保持原判定。`,
    )
    .join("\n")
  return `# MarkZ Evolution Report

生成时间：${report.generatedAt}

${report.objective}

## 当前状态

- 能力：${report.summary.achieved}/${report.summary.total} 已达成，${report.summary.gaps} 项待改进，${report.summary.declined ?? 0} 项明确不采纳
- 实时评测：${report.summary.evalsPassed}/${report.summary.evalsTotal} 通过
- 架构决策：${report.summary.decisions} 条

${next}

## 后续队列

${queue || "无"}

## 已达成

${achieved || "无"}

## 已明确不采纳

${declined || "无"}

## 自动化边界

${report.guardrails.map((guardrail) => `- ${guardrail}`).join("\n")}
`
}

function readOption(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const report = await auditEvolution()
  const failures = [...report.validationFailures, ...report.probeErrors]
  if (report.evalReport.passed !== report.evalReport.total) {
    failures.push(`live evals failed: ${report.evalReport.passed}/${report.evalReport.total}`)
  }
  if (process.argv.includes("--check")) {
    if (failures.length === 0) {
      console.log(
        `Evolution program is valid: ${report.summary.achieved}/${report.summary.total} capabilities achieved; ${report.summary.declined} declined; next is ${report.next?.id ?? "model review"}.`,
      )
    }
  } else {
    const format = readOption("format") ?? "markdown"
    const content =
      format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderEvolutionMarkdown(report)
    const output = readOption("output")
    if (output) {
      const target = path.resolve(output)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content)
      console.log(`Wrote evolution ${format} report to ${output}.`)
    } else {
      process.stdout.write(content)
    }
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
  }
}
