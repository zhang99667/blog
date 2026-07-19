import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml, parseDocument, visit } from "yaml"
import { collectDesignSystemFailures } from "../design-system/check.mjs"
import { loadContentSecurityPolicy } from "../quality/content-security-policy.mjs"
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

const securityHeaderInclude = "include /etc/nginx/conf.d/security-headers.inc;"
const governedSecurityHeaders = [
  'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
  'add_header X-Content-Type-Options "nosniff" always;',
  'add_header X-Frame-Options "DENY" always;',
  "add_header Referrer-Policy $markz_referrer_policy always;",
]
const hiddenUpstreamSecurityHeaders = [
  "proxy_hide_header Strict-Transport-Security;",
  "proxy_hide_header X-Content-Type-Options;",
  "proxy_hide_header X-Frame-Options;",
  "proxy_hide_header Referrer-Policy;",
]

export function validateNginxSecurityHeaderContexts(source) {
  const failures = []
  const contexts = []

  function closeContext(lineNumber) {
    const context = contexts.pop()
    if (!context) {
      failures.push(`nginx has an unmatched closing brace at line ${lineNumber}`)
      return
    }
    if (context.hasAddHeader && !context.hasSecurityHeaders) {
      failures.push(
        `${context.label} at line ${context.lineNumber} declares add_header without the governed security include`,
      )
    }
    if (context.label === "server" && context.hasTlsListen && !context.hasSecurityHeaders) {
      failures.push(
        `TLS server at line ${context.lineNumber} is missing the governed security include`,
      )
    }
  }

  for (const [index, rawLine] of source.split("\n").entries()) {
    const lineNumber = index + 1
    const line = rawLine.replace(/\s+#.*$/, "").trim()
    if (!line) continue
    if (line === "}") {
      closeContext(lineNumber)
      continue
    }
    if (line.endsWith("{")) {
      contexts.push({
        label: line.slice(0, -1).trim(),
        lineNumber,
        hasAddHeader: false,
        hasSecurityHeaders: false,
        hasTlsListen: false,
      })
      continue
    }
    const context = contexts.at(-1)
    if (!context) continue
    if (line === securityHeaderInclude) context.hasSecurityHeaders = true
    if (line.startsWith("add_header ")) context.hasAddHeader = true
    if (/^listen\s+443\s+ssl;/.test(line)) context.hasTlsListen = true
  }
  while (contexts.length > 0) {
    const context = contexts.at(-1)
    failures.push(`${context.label} at line ${context.lineNumber} is not closed`)
    contexts.pop()
  }
  return failures
}

export async function collectSecurityHeaderPolicyFailures(root = defaultRoot) {
  const [nginx, securityHeaders, compose, deploy, smoke] = await Promise.all([
    readText(root, "deploy/nginx.conf"),
    readText(root, "deploy/security-headers.inc"),
    readText(root, "deploy/docker-compose.edge.yml"),
    readText(root, "scripts/deploy.mjs"),
    readText(root, "scripts/quality/smoke-production.mjs"),
  ])
  const failures = validateNginxSecurityHeaderContexts(nginx)
  for (const directive of governedSecurityHeaders) {
    if (!securityHeaders.includes(directive)) {
      failures.push(`security header authority is missing ${directive}`)
    }
    if (nginx.includes(directive)) {
      failures.push(`nginx duplicates the governed directive ${directive}`)
    }
  }
  for (const directive of hiddenUpstreamSecurityHeaders) {
    if (!securityHeaders.includes(directive)) {
      failures.push(`security header authority is missing ${directive}`)
    }
  }
  for (const snippet of [
    "map $upstream_http_referrer_policy $markz_referrer_policy",
    '"" "strict-origin-when-cross-origin";',
  ]) {
    if (!nginx.includes(snippet)) failures.push(`nginx referrer policy map is missing ${snippet}`)
  }
  for (const [source, snippet, label] of [
    [
      compose,
      "security-headers.inc:/etc/nginx/conf.d/security-headers.inc:ro",
      "edge Compose mount",
    ],
    [deploy, "securityHeaders", "deployment sync"],
    [smoke, "validateSecurityHeaders", "production smoke"],
    [smoke, "__security-header-smoke__.png", "production 404 smoke"],
  ]) {
    if (!source.includes(snippet)) failures.push(`${label} is missing ${snippet}`)
  }
  return failures
}

export async function collectContentSecurityPolicyFailures(root = defaultRoot) {
  const failures = []
  let policy
  try {
    policy = await loadContentSecurityPolicy(root)
  } catch (error) {
    return [`content security policy is invalid: ${error.message}`]
  }

  for (const [directive, expected] of [
    ["default-src", ["'self'"]],
    ["base-uri", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["object-src", ["'none'"]],
    ["script-src", ["'self'"]],
    ["script-src-attr", ["'none'"]],
  ]) {
    const actual = policy.directives.get(directive) ?? []
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(`CSP ${directive} must be ${expected.join(" ")}`)
    }
  }
  if (policy.value.includes("'unsafe-eval'")) failures.push("CSP must reject unsafe eval")
  for (const directive of ["style-src", "style-src-attr", "style-src-elem"]) {
    if (!policy.directives.get(directive)?.includes("'unsafe-inline'")) {
      failures.push(`CSP ${directive} must cover generated and legacy presentation styles`)
    }
  }

  const [
    securityHeaders,
    componentResources,
    renderPage,
    notFound,
    explorer,
    graphAssets,
    mermaidCompatibility,
    mermaidAssets,
    head,
    staticEmitter,
    quality,
    localServer,
    browser,
    smoke,
    packageJson,
    budgets,
  ] = await Promise.all([
    readText(root, "deploy/security-headers.inc"),
    readText(root, "quartz/plugins/emitters/componentResources.ts"),
    readText(root, "quartz/components/renderPage.tsx"),
    readText(root, "quartz/components/pages/404.tsx"),
    readText(root, "quartz/components/ExplorerCompatibility.ts"),
    readText(root, "quartz/components/graphRuntimeAssets.ts"),
    readText(root, "quartz/components/MermaidCompatibility.ts"),
    readText(root, "quartz/components/mermaidRuntimeAssets.ts"),
    readText(root, "quartz/components/Head.tsx"),
    readText(root, "quartz/plugins/emitters/static.ts"),
    readText(root, "scripts/quality/check-build.mjs"),
    readText(root, "scripts/quality/serve-static.mjs"),
    readText(root, "tests/quality/site-quality.spec.ts"),
    readText(root, "scripts/quality/smoke-production.mjs"),
    readJson(root, "package.json"),
    readJson(root, "quality/budgets.json"),
  ])

  for (const snippet of [
    "add_header Content-Security-Policy $markz_content_security_policy always;",
  ]) {
    if (!securityHeaders.includes(snippet)) failures.push(`CSP edge include is missing ${snippet}`)
  }
  if (securityHeaders.includes("proxy_hide_header Content-Security-Policy")) {
    failures.push("shared edge headers must preserve independent product CSP ownership")
  }
  for (const [source, label, snippets] of [
    [
      componentResources,
      "component resources",
      ["globalThis.fetchData", "document.currentScript", "patchMermaidRuntimeSource"],
    ],
    [notFound, "404 component", ["NotFound.afterDOMLoaded = script"]],
    [explorer, "Explorer compatibility", ["patchExplorerRuntime", "sanitizeExplorerOptions"]],
    [graphAssets, "Pixi CSP runtime", ['import "pixi.js/unsafe-eval"']],
    [
      mermaidCompatibility,
      "Mermaid compatibility",
      ["patchMermaidRuntimeSource", "location.origin"],
    ],
    [
      mermaidAssets,
      "Mermaid runtime asset",
      ['mermaidRuntimeVersion = "11.16.0"', "buildMermaidRuntimeAsset"],
    ],
    [staticEmitter, "static emitter", ["buildMermaidRuntimeAsset", "mermaidRuntimeAsset"]],
    [
      quality,
      "build quality",
      ["validateContentSecurityPolicy", "inline executable script", "must not depend on cdnjs"],
    ],
    [localServer, "local browser server", ['setHeader("Content-Security-Policy"']],
    [browser, "browser gate", ["securitypolicyviolation", "render Mermaid from the local runtime"]],
    [
      smoke,
      "production smoke",
      ["expectedContentSecurityPolicy", 'headers.get("content-security-policy")'],
    ],
  ]) {
    for (const snippet of snippets) {
      if (!source.includes(snippet)) failures.push(`${label} is missing ${snippet}`)
    }
  }

  if (renderPage.includes("contentIndexScript") || notFound.includes("dangerouslySetInnerHTML")) {
    failures.push("page rendering must not restore inline executable bootstrap scripts")
  }
  if (explorer.includes("new Function")) {
    failures.push("Explorer compatibility must not construct executable callbacks")
  }
  if (head.includes("cdnjs.cloudflare.com")) {
    failures.push("page head must not preconnect to the retired Mermaid CDN")
  }
  if (packageJson.dependencies?.["@mermaid-js/tiny"] !== "11.16.0") {
    failures.push("Mermaid runtime dependency must be pinned to 11.16.0")
  }
  for (const output of budgets.outputs ?? []) {
    if (output.maxInitialJsBytes > 200000) {
      failures.push(`${output.id} initial JS budget must not be relaxed for CSP runtimes`)
    }
  }
  return failures
}

export async function collectRoutingContractFailures(root = defaultRoot) {
  const failures = []
  const compose = await readText(root, "deploy/docker-compose.edge.yml")
  const nginx = await readText(root, "deploy/nginx.conf")
  const deploy = await readText(root, "scripts/deploy.mjs")
  const blogFrame = await readText(root, "quartz/components/frames/BlogFrame.tsx")
  const budgets = await readJson(root, "quality/budgets.json")
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
  const adminNoindexHeaders =
    nginx.match(/add_header X-Robots-Tag "noindex, nofollow" always;/g) ?? []
  if (adminNoindexHeaders.length < 2) {
    failures.push("JSONUtils admin routes must send noindex, nofollow response headers")
  }
  if (deploy.includes("docker-compose.override") || deploy.includes("JSONUTILS_REMOTE_DIR")) {
    failures.push("deployment is coupled to the JSONUtils Compose lifecycle")
  }
  const exactPackingRedirect = nginx.match(/location = \/zhangjihao\s*\{([\s\S]*?)\}/)?.[1] ?? ""
  const nestedPackingRedirect =
    nginx.match(/location \^~ \/zhangjihao\/\s*\{([\s\S]*?)\}/)?.[1] ?? ""
  if (!exactPackingRedirect.includes("return 301 https://zhangjihao.markz.fun/;")) {
    failures.push("legacy packing-list root must redirect to its canonical subdomain")
  }
  if (
    !nestedPackingRedirect.includes(
      "rewrite ^/zhangjihao/(.*)$ https://zhangjihao.markz.fun/$1 permanent;",
    )
  ) {
    failures.push("legacy packing-list paths must preserve suffixes on the canonical subdomain")
  }
  if (/\b(?:alias|root|try_files)\b/.test(nestedPackingRedirect)) {
    failures.push("legacy packing-list paths must not serve a second copy of the product")
  }
  if (
    !blogFrame.includes('href="https://zhangjihao.markz.fun/"') ||
    blogFrame.includes('href="/zhangjihao')
  ) {
    failures.push("blog navigation must use the canonical packing-list subdomain")
  }
  const blogBudget = budgets.outputs?.find((output) => output.id === "blog")
  if (blogBudget?.allowedExternalRoutes?.includes("/zhangjihao/")) {
    failures.push("build quality must not retain the retired packing-list path exception")
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
  const blogFrame = await readText(root, "quartz/components/frames/BlogFrame.tsx")
  const browserSuite = await readText(root, "tests/quality/site-quality.spec.ts")
  const customStyles = await readText(root, "quartz/styles/custom.scss")
  const reactionScript = await readText(
    root,
    "quartz/components/scripts/articleReactions.inline.ts",
  )
  const componentResources = await readText(root, "quartz/plugins/emitters/componentResources.ts")
  const buildQuality = await readText(root, "scripts/quality/check-build.mjs")
  const productionSmoke = await readText(root, "scripts/quality/smoke-production.mjs")
  for (const snippet of [
    "renderBlogTableOfContents",
    'hasClassName(rendered, "toc")',
    "blog-article-toc",
  ]) {
    if (!blogFrame.includes(snippet)) failures.push(`blog reading frame is missing ${snippet}`)
  }
  for (const snippet of [
    'page.locator(".blog-article-toc")',
    "page.locator('.page[data-frame=\"blog\"] .graph')",
    'toHaveAttribute("aria-expanded", "false")',
    'toHaveAttribute("data-side", "start")',
  ]) {
    if (!browserSuite.includes(snippet)) failures.push(`browser matrix is missing ${snippet}`)
  }
  if (
    !customStyles.includes('.blog-main[data-has-toc="true"]') ||
    !customStyles.includes("position: sticky")
  ) {
    failures.push("blog table of contents must keep its governed responsive layout")
  }
  for (const snippet of [
    "preferredStartLeft",
    'root.dataset.side = "start"',
    'root.style.bottom = "auto"',
  ]) {
    if (!reactionScript.includes(snippet)) {
      failures.push(`article-adjacent reaction positioning is missing ${snippet}`)
    }
  }
  for (const snippet of [
    "postcssCascadeLayers",
    "componentResources.componentCssStrings",
    "compatibleStylesheet.css",
    "ctx.componentCssMap = new Map()",
  ]) {
    if (!componentResources.includes(snippet)) {
      failures.push(`legacy CSS build contract is missing ${snippet}`)
    }
  }
  for (const source of [buildQuality, productionSmoke]) {
    if (!source.includes("validateLegacyStylesheetCompatibility")) {
      failures.push("legacy CSS compatibility must be checked before and after deployment")
    }
  }
  return failures
}

export async function collectRuntimeBackupBoundaryFailures(root = defaultRoot) {
  const failures = []
  const evolution = await readJson(root, "ai/evolution.json")
  const runtimeBackup = evolution.capabilities?.find(
    (capability) => capability.id === "runtime-backup",
  )
  const isDeclined = runtimeBackup?.disposition?.status === "declined"
  const backup = await readText(root, "services/reactions/backup.mjs")
  const offsite = await readText(root, "services/reactions/offsite-backup.mjs")
  const compose = await readText(root, "deploy/docker-compose.edge.yml")
  const smoke = await readText(root, "scripts/quality/smoke-production.mjs")
  const ageTool = await readText(root, "scripts/runtime-backup/age-tool.sh")
  const keyBootstrap = await readText(root, "scripts/runtime-backup/bootstrap-key.sh")
  const packageScript = await readText(root, "scripts/runtime-backup/package-encrypted.sh")
  const restoreScript = await readText(root, "scripts/runtime-backup/restore-encrypted.sh")
  const knownHosts = await readText(root, "deploy/known_hosts")
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

  for (const snippet of [
    "verifyBackupSet",
    "verifyOffsiteBundle",
    "restoreOffsiteBundle",
    'assertEqual(names, expectedNames, "file set")',
  ]) {
    if (!offsite.includes(snippet)) failures.push(`off-site backup verifier is missing ${snippet}`)
  }
  for (const snippet of [
    'MARKZ_AGE_VERSION="1.3.1"',
    "bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377",
    "01120ea2cbf0463d4c6bd767f99f3271bbed1cdc8a9aa718a76ba1fe4f01998b",
    "age release checksum mismatch",
  ]) {
    if (!ageTool.includes(snippet)) failures.push(`age tool installer is missing ${snippet}`)
  }
  for (const snippet of [
    "ephemeral_identity",
    'offsite-backup.mjs" verify',
    'offsite-backup.mjs" restore',
    "Runtime backup output contains an unexpected file",
  ]) {
    if (!packageScript.includes(snippet)) {
      failures.push(`off-site backup packaging is missing ${snippet}`)
    }
  }
  for (const snippet of ["--confirm-create-key", "private backup identity must stay outside"]) {
    if (!keyBootstrap.includes(snippet)) failures.push(`backup key bootstrap is missing ${snippet}`)
  }
  for (const snippet of [
    "Encrypted artifact checksum does not match",
    "Artifact directory contains an unexpected file",
    "Restore destination already exists",
    'offsite-backup.mjs" verify',
    'offsite-backup.mjs" restore',
  ]) {
    if (!restoreScript.includes(snippet)) failures.push(`off-site recovery is missing ${snippet}`)
  }
  for (const source of [ageTool, keyBootstrap, packageScript, restoreScript]) {
    if (/MARKZ_SSH_PRIVATE_KEY|NOTE_REPO_SSH_KEY/.test(source)) {
      failures.push("runtime backup tools must not consume deployment or notes private keys")
    }
  }
  if (!/^39\.97\.237\.248 ssh-ed25519 [A-Za-z0-9+/=]+\n$/.test(knownHosts)) {
    failures.push("production SSH trust must pin one Ed25519 host key")
  }

  const workflowPath = path.join(root, ".github/workflows/markz-backup.yaml")
  try {
    const workflow = await fs.readFile(workflowPath, "utf8")
    for (const snippet of [
      "workflow_dispatch:",
      "contents: read",
      "deploy/known_hosts",
      "backup.mjs latest-json",
      "backup.mjs drill",
      "package-encrypted.sh",
      "MARKZ_RUNTIME_BACKUP_ENABLED",
      "path: .cache/runtime-backup-upload",
      "compression-level: 0",
      "retention-days: 90",
      "steps.upload.outputs.artifact-digest",
    ]) {
      if (!workflow.includes(snippet)) failures.push(`off-site workflow is missing ${snippet}`)
    }
    if (workflow.includes("ssh-keyscan")) {
      failures.push("off-site workflow must not trust a live SSH key scan")
    }
    const parsed = parseYaml(workflow)
    if (isDeclined && parsed.on?.schedule !== undefined) {
      failures.push("a declined off-site backup must not keep an automatic schedule")
    }
    if (!isDeclined && parsed.on?.schedule === undefined) {
      failures.push("an active off-site backup must define an automatic schedule")
    }
    const upload = parsed.jobs?.backup?.steps?.find((step) =>
      String(step.uses ?? "").startsWith("actions/upload-artifact@"),
    )
    if (upload?.with?.path !== ".cache/runtime-backup-upload") {
      failures.push("off-site workflow artifact path must contain ciphertext only")
    }
  } catch (error) {
    if (error.code === "ENOENT") failures.push("off-site backup workflow is missing")
    else throw error
  }
  return failures
}

export async function collectEvolutionDispositionFailures(root = defaultRoot) {
  const failures = []
  const evolution = await readJson(root, "ai/evolution.json")
  const runtimeBackup = evolution.capabilities?.find(
    (capability) => capability.id === "runtime-backup",
  )
  const expectedScoring = {
    impact: 5,
    urgency: 5,
    confidence: 5,
    effort: 4,
    risk: "critical",
    check: "runtime-backup",
  }
  if (!runtimeBackup) {
    failures.push("runtime-backup must remain visible in the evolution model")
  } else {
    for (const [field, expected] of Object.entries(expectedScoring)) {
      if (runtimeBackup[field] !== expected) {
        failures.push(`runtime-backup.${field} must remain ${expected}`)
      }
    }
    const disposition = runtimeBackup.disposition
    if (
      disposition?.status !== "declined" ||
      disposition?.decidedAt !== "2026-07-15" ||
      disposition?.decision !== "D-022" ||
      !disposition?.reason
    ) {
      failures.push("runtime-backup must preserve the explicit D-022 decline")
    }
  }

  const evolutionScript = await readText(root, "scripts/ai/evolve.mjs")
  for (const snippet of [
    'capability.disposition?.status === "declined"',
    '.filter((capability) => capability.status === "gap")',
    "## 已明确不采纳",
    "现有探针保持原判定",
  ]) {
    if (!evolutionScript.includes(snippet)) {
      failures.push(`evolution reporting is missing ${snippet}`)
    }
  }

  const schema = await readText(root, "ai/evolution.schema.json")
  for (const snippet of ['"disposition"', '"const": "declined"', '"decision"']) {
    if (!schema.includes(snippet)) failures.push(`evolution schema is missing ${snippet}`)
  }

  const evolvePrompt = await readText(root, ".github/prompts/evolve-site.prompt.md")
  const backupPrompt = await readText(root, ".github/prompts/runtime-backup.prompt.md")
  for (const [source, label] of [
    [evolvePrompt, "evolution prompt"],
    [backupPrompt, "runtime backup prompt"],
  ]) {
    if (!source.includes("D-022") || !source.includes("明确反转")) {
      failures.push(`${label} must honor D-022 until an explicit reversal`)
    }
  }

  const decisions = await readText(root, "docs/AI-DECISIONS.md")
  if (!decisions.includes("## D-022")) failures.push("AI decisions must record D-022")

  const workflow = parseYaml(await readText(root, ".github/workflows/markz-backup.yaml"))
  if (workflow.on?.schedule !== undefined) {
    failures.push("the declined runtime backup workflow must not be scheduled")
  }
  if (workflow.on?.workflow_dispatch === undefined) {
    failures.push("the dormant runtime backup workflow must remain manually dispatchable")
  }
  if (workflow.jobs?.backup?.if !== "vars.MARKZ_RUNTIME_BACKUP_ENABLED == 'true'") {
    failures.push("manual runtime backup must retain the explicit enable gate")
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
  "evolution-decision-boundary": collectEvolutionDispositionFailures,
  "graph-runtime-boundary": collectGraphRuntimeBoundaryFailures,
  "article-social-image-boundary": collectArticleSocialImageFailures,
  "ci-action-lifecycle": collectCiActionLifecycleFailures,
  "security-header-policy": collectSecurityHeaderPolicyFailures,
  "content-security-policy": collectContentSecurityPolicyFailures,
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
