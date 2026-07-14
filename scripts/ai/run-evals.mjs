import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml, parseDocument, visit } from "yaml"
import { collectDesignSystemFailures } from "../design-system/check.mjs"
import { collectAiInfraFailures } from "./check-ai-infra.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, "../..")

async function readText(root, relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8")
}

async function readJson(root, relativePath) {
  return JSON.parse(await readText(root, relativePath))
}

const minimumCiActionMajors = new Map([
  ["actions/checkout", 7],
  ["actions/setup-node", 7],
  ["actions/upload-artifact", 7],
])

function workflowActionReferences(source, relativePath) {
  const document = parseDocument(source)
  if (document.errors.length > 0) {
    return {
      failures: document.errors.map((error) => `${relativePath} is invalid YAML: ${error.message}`),
      references: [],
    }
  }

  const references = []
  visit(document, {
    Pair(_, pair) {
      if (pair.key?.value !== "uses" || typeof pair.value?.value !== "string") return
      references.push({
        reference: pair.value.value,
        versionComment: pair.value.comment?.trim() ?? "",
      })
    },
  })
  return { failures: [], references }
}

export function validateCiActionLifecycle(workflowSources, dependabotSource) {
  const failures = []
  const seenActions = new Set()
  for (const { path: relativePath, source } of workflowSources) {
    const parsed = workflowActionReferences(source, relativePath)
    failures.push(...parsed.failures)
    for (const { reference, versionComment } of parsed.references) {
      if (reference.startsWith("./") || reference.startsWith("docker://")) continue
      const match = reference.match(/^([^@\s]+)@(.+)$/)
      if (!match) {
        failures.push(`${relativePath} has an invalid remote Action reference: ${reference}`)
        continue
      }
      const [, action, revision] = match
      seenActions.add(action)
      if (!/^[0-9a-f]{40}$/.test(revision)) {
        failures.push(`${relativePath} must pin ${action} to a full commit SHA`)
      }
      const version = versionComment.match(/^v(\d+)\.(\d+)\.(\d+)$/)
      if (!version) {
        failures.push(`${relativePath} must annotate ${action} with an exact version comment`)
        continue
      }
      const minimumMajor = minimumCiActionMajors.get(action)
      if (minimumMajor && Number(version[1]) < minimumMajor) {
        failures.push(
          `${relativePath} uses ${action} ${versionComment}; v${minimumMajor}+ is required`,
        )
      }
    }
  }

  for (const action of minimumCiActionMajors.keys()) {
    if (!seenActions.has(action))
      failures.push(`CI workflows are missing governed Action ${action}`)
  }

  try {
    const dependabot = parseYaml(dependabotSource)
    const update = (dependabot.updates ?? []).find(
      (item) => item["package-ecosystem"] === "github-actions" && item.directory === "/",
    )
    if (!update) {
      failures.push("Dependabot must govern GitHub Actions at the repository root")
    } else if (!["daily", "weekly"].includes(update.schedule?.interval)) {
      failures.push("Dependabot must check GitHub Actions at least weekly")
    }
  } catch (error) {
    failures.push(`.github/dependabot.yml is invalid YAML: ${error.message}`)
  }
  return failures
}

export async function collectCiActionLifecycleFailures(root = defaultRoot) {
  const workflowDirectory = path.join(root, ".github/workflows")
  const entries = await fs.readdir(workflowDirectory, { withFileTypes: true })
  const workflowSources = []
  for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue
    const relativePath = `.github/workflows/${entry.name}`
    workflowSources.push({ path: relativePath, source: await readText(root, relativePath) })
  }
  return validateCiActionLifecycle(workflowSources, await readText(root, ".github/dependabot.yml"))
}

export async function collectRoutingContractFailures(root = defaultRoot) {
  const failures = []
  const compose = await readText(root, "deploy/docker-compose.edge.yml")
  const nginx = await readText(root, "deploy/nginx.conf")
  const deploy = await readText(root, "scripts/deploy.mjs")
  for (const snippet of [
    "container_name: markz-edge",
    '"${EDGE_HTTP_PORT:-80}:80"',
    '"${EDGE_HTTPS_PORT:-443}:443"',
  ]) {
    if (!compose.includes(snippet)) failures.push(`edge compose is missing ${snippet}`)
  }
  for (const host of [
    "markz.fun",
    "note.markz.fun",
    "jsonutils.markz.fun",
    "zhangjihao.markz.fun",
  ]) {
    if (!nginx.includes(`server_name ${host}`) && !nginx.includes(` ${host};`)) {
      failures.push(`edge nginx is missing ${host}`)
    }
  }
  if (deploy.includes("docker-compose.override") || deploy.includes("JSONUTILS_REMOTE_DIR")) {
    failures.push("deployment is coupled to the JSONUtils Compose lifecycle")
  }
  return failures
}

export async function collectContentBoundaryFailures(root = defaultRoot) {
  const failures = []
  const manifest = await readJson(root, "design-system/manifest.json")
  if (manifest.surfaces?.blog?.role !== "editorial") failures.push("blog must remain editorial")
  if (manifest.surfaces?.notes?.role !== "knowledge-base") {
    failures.push("notes must remain a knowledge base")
  }
  for (const product of ["jsonutils", "packing-list"]) {
    if (manifest.surfaces?.[product]?.inheritsPersonalWordmark !== false) {
      failures.push(`${product} must keep its product identity`)
    }
  }
  return failures
}

export async function collectBrowserContractFailures(root = defaultRoot) {
  const failures = []
  const required = [
    "playwright.config.ts",
    "tests/quality/site-quality.spec.ts",
    "quality/budgets.json",
    "scripts/quality/check-build.mjs",
  ]
  for (const file of required) {
    try {
      await fs.access(path.join(root, file))
    } catch {
      failures.push(`browser quality contract is missing ${file}`)
    }
  }
  const manifest = await readJson(root, "design-system/manifest.json")
  const widths = new Set((manifest.requiredViewports ?? []).map((viewport) => viewport.width))
  for (const width of [320, 390, 1440]) {
    if (!widths.has(width)) failures.push(`browser matrix is missing width ${width}`)
  }
  for (const theme of ["light", "dark"]) {
    if (!manifest.requiredThemes?.includes(theme))
      failures.push(`browser matrix is missing ${theme}`)
  }
  return failures
}

export async function collectRuntimeBackupBoundaryFailures(root = defaultRoot) {
  const failures = []
  const backup = await readText(root, "services/reactions/backup.mjs")
  const compose = await readText(root, "deploy/docker-compose.edge.yml")
  const smoke = await readText(root, "scripts/quality/smoke-production.mjs")
  for (const snippet of [
    "await backup(source, temporarySnapshot",
    "PRAGMA integrity_check",
    "PRAGMA foreign_key_check",
    "PRAGMA journal_mode = DELETE",
    "Restore destination already exists",
  ]) {
    if (!backup.includes(snippet)) failures.push(`backup implementation is missing ${snippet}`)
  }
  for (const snippet of [
    "container_name: markz-reactions-backup",
    "network_mode: none",
    ":/data:ro",
    'BACKUP_RETENTION_COUNT: "32"',
  ]) {
    if (!compose.includes(snippet)) failures.push(`backup sidecar is missing ${snippet}`)
  }
  if (!smoke.includes("backup.mjs drill")) {
    failures.push("production smoke must perform a reactions restore drill")
  }

  const workflowPath = path.join(root, ".github/workflows/markz-backup.yaml")
  try {
    const workflow = await fs.readFile(workflowPath, "utf8")
    if (
      workflow.includes("upload-artifact") &&
      /\.sqlite\b/.test(workflow) &&
      !/(?:age|gpg|openssl|encrypt)/i.test(workflow)
    ) {
      failures.push("off-host workflow must not upload a plaintext SQLite snapshot")
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  return failures
}

export async function collectGraphRuntimeBoundaryFailures(root = defaultRoot) {
  const failures = []
  const packageJson = await readJson(root, "package.json")
  const assets = await readText(root, "quartz/components/graphRuntimeAssets.ts")
  const compatibility = await readText(root, "quartz/components/GraphCompatibility.ts")
  const staticEmitter = await readText(root, "quartz/plugins/emitters/static.ts")
  const qualityCheck = await readText(root, "scripts/quality/check-build.mjs")
  const budgets = await readJson(root, "quality/budgets.json")

  for (const [dependency, version] of [
    ["d3", "7.9.0"],
    ["pixi.js", "8.19.0"],
  ]) {
    if (packageJson.dependencies?.[dependency] !== version) {
      failures.push(`Graph dependency ${dependency} must be pinned to ${version}`)
    }
  }
  for (const snippet of [
    "bundleGraphRuntimeAsset",
    "treeShaking: true",
    'site === "notes" || site === "notes-fallback"',
  ]) {
    if (!assets.includes(snippet)) failures.push(`Graph runtime assets are missing ${snippet}`)
  }
  for (const snippet of [
    "patchGraphRuntimeSources",
    "document.body.dataset.basepath",
    "isGraphRuntimeSite()",
  ]) {
    if (!compatibility.includes(snippet)) {
      failures.push(`Graph compatibility boundary is missing ${snippet}`)
    }
  }
  if (!staticEmitter.includes("bundleGraphRuntimeAsset(asset, projectRoot)")) {
    failures.push("static emitter must publish the self-hosted Graph runtimes")
  }
  if (!qualityCheck.includes("Graph runtime must not depend on jsDelivr")) {
    failures.push("build quality must reject an external Graph runtime")
  }
  for (const output of budgets.outputs ?? []) {
    if (output.maxInitialJsBytes > 200000) {
      failures.push(`${output.id} initial JS budget must not be relaxed for Graph dependencies`)
    }
  }
  return failures
}

export async function collectArticleSocialImageFailures(root = defaultRoot) {
  const failures = []
  const generator = await readText(root, "scripts/design-system/article-social-images.mjs")
  const sync = await readText(root, "scripts/sync-notes.mjs")
  const head = await readText(root, "quartz/components/Head.tsx")
  const staticEmitter = await readText(root, "quartz/plugins/emitters/static.ts")
  const quality = await readText(root, "scripts/quality/check-build.mjs")
  const productionSmoke = await readText(root, "scripts/quality/smoke-production.mjs")
  const budgets = await readJson(root, "quality/budgets.json")
  const config = parseYaml(await readText(root, "quartz.config.yaml"))

  for (const [source, snippets] of [
    [
      generator,
      ["articleSocialImageDescriptor", "renderArticleSocialCardSvg", "checksum mismatch"],
    ],
    [sync, ["generateArticleSocialImages", "socialImage:"]],
    [head, ["socialImageUrl", "og:image:secure_url"]],
    [staticEmitter, ["social-images", 'QUARTZ_SITE ?? "blog"']],
    [quality, ["validateArticleSocialMetadata", "maxTotalSocialImageBytes"]],
    [productionSmoke, ["validateArticleSocialMetadata", "production article social image"]],
  ]) {
    for (const snippet of snippets) {
      if (!source.includes(snippet))
        failures.push(`article social image contract is missing ${snippet}`)
    }
  }

  const genericEmitter = (config.plugins ?? []).find(
    (plugin) => plugin.source === "github:quartz-community/og-image",
  )
  if (genericEmitter?.enabled !== false) {
    failures.push("generic remote-font OG emitter must remain disabled")
  }

  const blogBudget = budgets.outputs?.find((output) => output.id === "blog")
  if (!blogBudget?.maxSocialImageBytes || !blogBudget?.maxTotalSocialImageBytes) {
    failures.push("article social images need per-file and total byte budgets")
  }

  for (const [file, expected] of [
    [
      "design-system/fonts/noto-sans-sc-chinese-simplified-800-normal.woff",
      "dcb2e590d4ec4d6dee1004fcd333990ae5941511459c4d2a3238706689844826",
    ],
    [
      "design-system/fonts/noto-sans-sc-latin-800-normal.woff",
      "6c462a676276dfb8987aaa9c6c332e58dbdd1b4e7d8fda9761e6a3a0adcc1865",
    ],
  ]) {
    try {
      const actual = createHash("sha256")
        .update(await fs.readFile(path.join(root, file)))
        .digest("hex")
      if (actual !== expected) failures.push(`${file} checksum must update through the contract`)
    } catch {
      failures.push(`${file} is missing`)
    }
  }
  return failures
}

const providers = {
  "design-contract": collectDesignSystemFailures,
  "ai-contract": collectAiInfraFailures,
  "routing-contract": collectRoutingContractFailures,
  "content-boundary": collectContentBoundaryFailures,
  "browser-contract": collectBrowserContractFailures,
  "runtime-backup-boundary": collectRuntimeBackupBoundaryFailures,
  "graph-runtime-boundary": collectGraphRuntimeBoundaryFailures,
  "article-social-image-boundary": collectArticleSocialImageFailures,
  "ci-action-lifecycle": collectCiActionLifecycleFailures,
}

export async function runEvalCases(root = defaultRoot) {
  const corpus = await readJson(root, "evals/design-system/cases.json")
  const requestedChecks = [
    ...new Set((corpus.cases ?? []).flatMap((item) => item.automatedChecks ?? [])),
  ]
  const checkResults = new Map()
  for (const check of requestedChecks) {
    const provider = providers[check]
    checkResults.set(check, provider ? await provider(root) : [`unknown automated check: ${check}`])
  }
  const cases = (corpus.cases ?? []).map((item) => {
    const failures = item.automatedChecks.flatMap((check) =>
      (checkResults.get(check) ?? []).map((failure) => `${check}: ${failure}`),
    )
    return {
      id: item.id,
      risk: item.risk,
      result: failures.length === 0 ? "pass" : "fail",
      failures,
    }
  })
  return {
    version: corpus.version,
    passed: cases.filter((item) => item.result === "pass").length,
    total: cases.length,
    cases,
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const report = await runEvalCases()
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2))
  else {
    for (const item of report.cases) console.log(`${item.result.toUpperCase()} ${item.id}`)
    console.log(`${report.passed}/${report.total} deterministic AI scenarios passed.`)
  }
  if (report.passed !== report.total) {
    for (const item of report.cases) {
      for (const failure of item.failures) console.error(`- ${item.id}: ${failure}`)
    }
    process.exitCode = 1
  }
}
