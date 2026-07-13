import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, "../..")

async function readText(root, relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8")
}

async function requireFile(root, relativePath, failures) {
  try {
    await fs.access(path.join(root, relativePath))
  } catch {
    failures.push(`missing required AI asset: ${relativePath}`)
  }
}

export function validateSkill(source) {
  const failures = []
  if (/\[TODO:|## Resources \(optional\)/.test(source))
    failures.push("skill contains template text")
  const frontmatter = source.match(/^---\n([\s\S]+?)\n---/)
  if (!frontmatter) {
    failures.push("skill frontmatter is missing")
  } else {
    const keys = [...frontmatter[1].matchAll(/^([a-zA-Z][\w-]*):/gm)].map((match) => match[1])
    if (!keys.includes("name") || !keys.includes("description")) {
      failures.push("skill frontmatter requires name and description")
    }
    const extraKeys = keys.filter((key) => !["name", "description"].includes(key))
    if (extraKeys.length > 0) failures.push(`skill frontmatter has unsupported keys: ${extraKeys}`)
  }
  for (const heading of ["## Required reading", "## Workflow", "## Command map", "## Boundaries"]) {
    if (!source.includes(heading)) failures.push(`skill is missing ${heading}`)
  }
  return failures
}

export function validateEvalCases(payload) {
  const failures = []
  if (!/^\d+\.\d+\.\d+$/.test(payload.version ?? "")) {
    failures.push("eval case version must use semantic versioning")
  }
  if (!Array.isArray(payload.cases) || payload.cases.length < 3) {
    failures.push("eval corpus must contain at least three cases")
    return failures
  }
  const ids = new Set()
  for (const item of payload.cases) {
    if (!item.id || ids.has(item.id))
      failures.push(`invalid or duplicate eval id: ${item.id ?? ""}`)
    ids.add(item.id)
    if (!item.prompt || !["low", "medium", "high", "critical"].includes(item.risk)) {
      failures.push(`${item.id} requires a prompt and valid risk`)
    }
    for (const key of ["mustRead", "invariants", "validation", "automatedChecks"]) {
      if (!Array.isArray(item[key]) || item[key].length === 0) {
        failures.push(`${item.id}.${key} must be a non-empty array`)
      }
    }
  }
  return failures
}

export function validateAiManifest(payload) {
  const failures = []
  if (!/^\d+\.\d+\.\d+$/.test(payload.version ?? "")) {
    failures.push("AI manifest version must use semantic versioning")
  }
  for (const [key, minimum] of [
    ["authorities", 5],
    ["instructionLayers", 4],
    ["evalSuites", 2],
  ]) {
    if (!Array.isArray(payload[key]) || payload[key].length < minimum) {
      failures.push(`AI manifest ${key} requires at least ${minimum} entries`)
    }
  }
  const authorityIds = new Set()
  for (const authority of payload.authorities ?? []) {
    if (!authority.id || authorityIds.has(authority.id) || !authority.path || !authority.kind) {
      failures.push(`invalid or duplicate AI authority: ${authority.id ?? ""}`)
    }
    authorityIds.add(authority.id)
  }
  for (const workflow of Object.values(payload.workflows ?? {})) {
    if (
      !["low", "medium", "high", "critical"].includes(workflow.risk) ||
      !workflow.prompt ||
      !Array.isArray(workflow.requiredCommands) ||
      workflow.requiredCommands.length === 0 ||
      !Array.isArray(workflow.requiredEvidence) ||
      workflow.requiredEvidence.length === 0
    ) {
      failures.push("AI workflows require risk, prompt, commands, and evidence")
    }
  }
  return failures
}

function requireSnippet(source, relativePath, snippet, failures) {
  if (!source.includes(snippet)) {
    failures.push(`${relativePath} must include ${JSON.stringify(snippet)}`)
  }
}

export async function collectAiInfraFailures(root = defaultRoot) {
  const failures = []
  const requiredAssets = [
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "ai/manifest.json",
    "ai/manifest.schema.json",
    ".codex/README.md",
    ".codex/skills/markz-site-maintainer/SKILL.md",
    ".codex/skills/markz-site-maintainer/agents/openai.yaml",
    ".github/copilot-instructions.md",
    ".github/instructions/design-system.instructions.md",
    ".github/instructions/content-pipeline.instructions.md",
    ".github/instructions/deployment.instructions.md",
    ".github/prompts/brand-change.prompt.md",
    ".github/prompts/publish-content.prompt.md",
    ".github/prompts/edge-incident.prompt.md",
    ".github/pull_request_template.md",
    ".github/workflows/markz-verify.yaml",
    ".github/workflows/markz-publish.yaml",
    "docs/ARCHITECTURE.md",
    "docs/OPERATIONS.md",
    "docs/SYSTEM-BENCHMARKS.md",
    "docs/AI-ENGINEERING-PLAYBOOK.md",
    "docs/AI-DECISIONS.md",
    "docs/AI-ASSET-REGISTRY.md",
    "docs/DESIGN-SYSTEM.md",
    "design-system/tokens.json",
    "design-system/manifest.json",
    "design-system/reference/markz-wordmark.png",
    "scripts/design-system/generate.mjs",
    "scripts/design-system/check.mjs",
    "scripts/ai/check-ai-infra.mjs",
    "scripts/ai/run-evals.mjs",
    "quality/budgets.json",
    "scripts/quality/check-build.mjs",
    "scripts/quality/smoke-production.mjs",
    "playwright.config.ts",
    "tests/quality/site-quality.spec.ts",
    "evals/design-system/cases.json",
    "evals/design-system/outcomes.jsonl",
  ]
  await Promise.all(requiredAssets.map((asset) => requireFile(root, asset, failures)))
  if (failures.length > 0) return failures

  const registry = await readText(root, "docs/AI-ASSET-REGISTRY.md")
  for (const asset of requiredAssets) {
    if (asset === ".codex/skills/markz-site-maintainer/agents/openai.yaml") continue
    const parentEntry = `${path.dirname(asset)}/`
    if (!registry.includes(asset) && !registry.includes(parentEntry)) {
      failures.push(`AI asset registry is missing ${asset}`)
    }
  }

  const agents = await readText(root, "AGENTS.md")
  const claude = await readText(root, "CLAUDE.md")
  const gemini = await readText(root, "GEMINI.md")
  const copilot = await readText(root, ".github/copilot-instructions.md")
  requireSnippet(agents, "AGENTS.md", "ai/manifest.json", failures)
  for (const [file, source] of [
    ["CLAUDE.md", claude],
    ["GEMINI.md", gemini],
    [".github/copilot-instructions.md", copilot],
  ]) {
    requireSnippet(source, file, "AGENTS.md", failures)
    requireSnippet(source, file, "ai/manifest.json", failures)
  }
  for (const snippet of [
    "docs/AI-ENGINEERING-PLAYBOOK.md",
    "design-system/tokens.json",
    "npm run check",
    "npm run quality:web",
  ]) {
    requireSnippet(agents, "AGENTS.md", snippet, failures)
  }

  const aiManifest = JSON.parse(await readText(root, "ai/manifest.json"))
  failures.push(...validateAiManifest(aiManifest))
  const manifestPaths = [
    ...(aiManifest.authorities ?? []).map((item) => item.path),
    ...(aiManifest.instructionLayers ?? []).map((item) => item.path),
    ...Object.values(aiManifest.workflows ?? {}).map((item) => item.prompt),
    ...(aiManifest.evalSuites ?? []).map((item) => item.path),
  ]
  await Promise.all([...new Set(manifestPaths)].map((file) => requireFile(root, file, failures)))

  for (const file of [
    ".github/instructions/design-system.instructions.md",
    ".github/instructions/content-pipeline.instructions.md",
    ".github/instructions/deployment.instructions.md",
  ]) {
    const source = await readText(root, file)
    requireSnippet(source, file, "applyTo:", failures)
  }

  const skill = await readText(root, ".codex/skills/markz-site-maintainer/SKILL.md")
  failures.push(...validateSkill(skill))

  const cases = JSON.parse(await readText(root, "evals/design-system/cases.json"))
  failures.push(...validateEvalCases(cases))
  for (const item of cases.cases ?? []) {
    for (const referencedPath of item.mustRead ?? []) {
      await requireFile(root, referencedPath, failures)
    }
  }

  const outcomes = await readText(root, "evals/design-system/outcomes.jsonl")
  for (const [index, line] of outcomes.split("\n").entries()) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      if (!record.caseId || !["pass", "partial", "fail"].includes(record.result)) {
        failures.push(`invalid outcome record at line ${index + 1}`)
      }
      if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
        failures.push(`outcome line ${index + 1} requires evidence`)
      }
    } catch {
      failures.push(`outcomes.jsonl line ${index + 1} is not valid JSON`)
    }
  }

  const decisions = await readText(root, "docs/AI-DECISIONS.md")
  for (const decision of ["D-001", "D-002", "D-003", "D-004", "D-005", "D-006", "D-007", "D-008"]) {
    requireSnippet(decisions, "docs/AI-DECISIONS.md", decision, failures)
  }

  const deployScript = await readText(root, "scripts/deploy.mjs")
  if (
    deployScript.includes("JSONUTILS_REMOTE_DIR") ||
    deployScript.includes("docker-compose.override")
  ) {
    failures.push("blog deployment must not write into the JSONUtils Compose project")
  }
  try {
    await fs.access(path.join(root, "deploy/docker-compose.override.yml"))
    failures.push("legacy JSONUtils compose override must not return")
  } catch {
    // Expected: public routing belongs to markz-edge.
  }

  const packageJson = JSON.parse(await readText(root, "package.json"))
  for (const script of [
    "design:generate",
    "design:check",
    "ai:check",
    "evals:check",
    "quality:build",
    "quality:web",
    "security:check",
    "smoke:production",
    "verify",
    "deploy",
  ]) {
    if (!packageJson.scripts?.[script]) failures.push(`package.json is missing ${script}`)
  }
  if (!packageJson.scripts?.deploy?.includes("npm run verify")) {
    failures.push("deploy must run the complete verify gate")
  }
  if (!packageJson.scripts?.deploy?.includes("npm run quality:web")) {
    failures.push("deploy must run browser quality checks")
  }
  for (const script of ["build:blog", "build:notes-fallback", "build:notes"]) {
    if (!packageJson.scripts?.[script]?.includes("QUARTZ_INCLUDE_GITIGNORED=1")) {
      failures.push(`${script} must include generated, gitignored content`)
    }
  }

  const gitignore = await readText(root, ".gitignore")
  for (const generatedPath of ["content/site/", "content/notes/"]) {
    requireSnippet(gitignore, ".gitignore", generatedPath, failures)
  }

  const verifyWorkflow = await readText(root, ".github/workflows/markz-verify.yaml")
  for (const command of [
    "npm run check",
    "npm test",
    "npm run evals:check",
    "npm run security:check",
  ]) {
    requireSnippet(verifyWorkflow, ".github/workflows/markz-verify.yaml", command, failures)
  }

  const publishWorkflow = await readText(root, ".github/workflows/markz-publish.yaml")
  for (const snippet of [
    "zhang99667/note",
    "NOTE_REPO_SSH_KEY",
    "NOTE_REPO_PRECHECKED_OUT",
    "fetch-depth: 0",
    "playwright install",
    "npm run deploy",
    "npm run smoke:production",
    "upload-artifact",
  ]) {
    requireSnippet(publishWorkflow, ".github/workflows/markz-publish.yaml", snippet, failures)
  }

  return failures
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const failures = await collectAiInfraFailures()
  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
  } else {
    console.log("MarkZ AI collaboration assets are governed and linked.")
  }
}
