import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
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

const providers = {
  "design-contract": collectDesignSystemFailures,
  "ai-contract": collectAiInfraFailures,
  "routing-contract": collectRoutingContractFailures,
  "content-boundary": collectContentBoundaryFailures,
  "browser-contract": collectBrowserContractFailures,
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
