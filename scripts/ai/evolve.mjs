import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"
import { runEvalCases } from "./run-evals.mjs"

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
  const passed = fonts?.enabled === false && quality.includes("exactly one governed Google Fonts")
  return probe(passed, "Typography has one generated authority and one runtime stylesheet.", [
    `fonts plugin enabled=${String(fonts?.enabled)}`,
    "build HTML font-count contract",
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

async function runtimeBackup(root) {
  const required = [
    "services/reactions/backup.mjs",
    "services/reactions/backup.test.mjs",
    ".github/workflows/markz-backup.yaml",
  ]
  const missing = []
  for (const file of required)
    if (!(await fileExists(root, file))) missing.push(`${file} is missing`)
  if (missing.length === 0) {
    const compose = await readText(root, "deploy/docker-compose.edge.yml")
    const smoke = await readText(root, "scripts/quality/smoke-production.mjs")
    if (!compose.includes("reactions-backup")) missing.push("backup sidecar is not deployed")
    if (!smoke.includes("reactions backup"))
      missing.push("production smoke does not verify backups")
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
  return probe(
    emitter?.enabled === true,
    "Articles generate title-specific governed social cards.",
    [`custom OG image emitter enabled=${String(emitter?.enabled)}`],
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
          status: evidence.passed ? "achieved" : "gap",
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
      decisions,
      evalsPassed: evalReport.passed,
      evalsTotal: evalReport.total,
    },
    next: gaps[0] ?? null,
    gaps,
    achieved: capabilities.filter((capability) => capability.status === "achieved"),
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
    : "## 下一项\n\n当前能力模型没有未完成项；应先复核模型并新增有证据的成熟度目标。"
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
  return `# MarkZ Evolution Report

生成时间：${report.generatedAt}

${report.objective}

## 当前状态

- 能力：${report.summary.achieved}/${report.summary.total} 已达成，${report.summary.gaps} 项待改进
- 实时评测：${report.summary.evalsPassed}/${report.summary.evalsTotal} 通过
- 架构决策：${report.summary.decisions} 条

${next}

## 后续队列

${queue || "无"}

## 已达成

${achieved || "无"}

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
        `Evolution program is valid: ${report.summary.achieved}/${report.summary.total} capabilities achieved; next is ${report.next?.id ?? "model review"}.`,
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
