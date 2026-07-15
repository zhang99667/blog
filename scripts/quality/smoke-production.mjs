import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { promises as fs } from "node:fs"
import sharp from "sharp"
import { inspectHtml, validateArticleSocialMetadata } from "./check-build.mjs"
import { loadContentSecurityPolicy } from "./content-security-policy.mjs"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..")
const sshHost = process.env.BLOG_SSH_HOST ?? "markz@39.97.237.248"
const sshKey = process.env.BLOG_SSH_KEY ?? path.join(os.homedir(), ".ssh/id_ed25519")
const tokens = JSON.parse(await fs.readFile(path.join(root, "design-system/tokens.json"), "utf8"))
const brandEvidence = [
  `data-brand-version="${tokens.version}"`,
  `markz-icon-${tokens.brand.assetRevision}.png`,
  `markz-card-${tokens.brand.assetRevision}.png`,
]
const linkedGraphSlug = "ai/agent-mcp-完全指南"
const { value: expectedContentSecurityPolicy } = await loadContentSecurityPolicy(root)
const expectedSecurityHeaders = new Map([
  ["strict-transport-security", ["max-age=31536000; includeSubDomains"]],
  ["x-content-type-options", ["nosniff"]],
  ["x-frame-options", ["DENY"]],
  ["referrer-policy", ["strict-origin-when-cross-origin", "no-referrer"]],
])
const routes = [
  {
    url: "https://markz.fun/",
    evidence: brandEvidence,
    title: "MarkZ · 个人博客",
    applicationName: "MarkZ",
  },
  {
    url: "https://www.markz.fun/",
    evidence: brandEvidence,
    title: "MarkZ · 个人博客",
    applicationName: "MarkZ",
  },
  {
    url: "https://note.markz.fun/",
    evidence: brandEvidence,
    title: "Notes · 公开笔记",
    applicationName: "MarkZ",
  },
  {
    url: "https://note.markz.fun/ai/agent-mcp-%E5%AE%8C%E5%85%A8%E6%8C%87%E5%8D%97",
    evidence: [`data-slug="${linkedGraphSlug}"`],
    title: "Agent MCP 完全指南 · 公开笔记",
    applicationName: "MarkZ",
  },
  { url: "https://jsonutils.markz.fun/", title: "JSONUtils - 专业版" },
  { url: "https://jsonutils.markz.fun/admin", title: "JSON Utils - 后台管理" },
  { url: "https://zhangjihao.markz.fun/", title: "智能装箱单生成器" },
  { url: "https://jsonutils.markz.fun/api/health" },
  {
    url: "https://markz.fun/api/visitors",
    evidence: ['"todayVisitors":', '"totalVisitors":'],
  },
  { url: "https://markz.fun/api/reactions/health", evidence: ['"status":"ok"'] },
  { url: "https://note.markz.fun/api/reactions/health", evidence: ['"status":"ok"'] },
  { url: "https://markz.fun/static/__security-header-smoke__.png", status: 404 },
]
const legacyPackingListRedirects = [
  {
    url: "https://markz.fun/zhangjihao",
    location: "https://zhangjihao.markz.fun/",
  },
  {
    url: "https://markz.fun/zhangjihao/guide?source=legacy",
    location: "https://zhangjihao.markz.fun/guide?source=legacy",
  },
]

const failures = []

function validateSecurityHeaders(label, response) {
  for (const [header, expectedValues] of expectedSecurityHeaders) {
    const actual = response.headers.get(header)
    if (!expectedValues.includes(actual)) {
      failures.push(
        `${label} has invalid ${header}: ${actual ?? "missing"}; expected ${expectedValues.join(" or ")}`,
      )
    }
  }
  let hostname = ""
  try {
    hostname = new URL(label).hostname
  } catch {
    // Callers with descriptive labels pass the CSP expectation explicitly below.
  }
  if (["markz.fun", "www.markz.fun", "note.markz.fun"].includes(hostname)) {
    const actual = response.headers.get("content-security-policy")
    if (actual !== expectedContentSecurityPolicy) {
      failures.push(`${label} has invalid content-security-policy: ${actual ?? "missing"}`)
    }
  }
}

await Promise.all(
  routes.map(async ({ url, evidence = [], status = 200, title, applicationName }) => {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) })
      const body = await response.text()
      if (response.status !== status)
        failures.push(`${url} returned ${response.status}, expected ${status}`)
      validateSecurityHeaders(url, response)
      for (const snippet of evidence) {
        if (!body.includes(snippet)) failures.push(`${url} is missing ${snippet}`)
      }
      if (title || applicationName) {
        const facts = inspectHtml(body)
        if (title && facts.title !== title) {
          failures.push(`${url} has title ${JSON.stringify(facts.title)}, expected ${title}`)
        }
        if (applicationName && facts.meta.get("application-name") !== applicationName) {
          failures.push(`${url} has invalid application-name`)
        }
        if (applicationName && facts.meta.get("apple-mobile-web-app-title") !== applicationName) {
          failures.push(`${url} has invalid apple-mobile-web-app-title`)
        }
      }
    } catch (error) {
      failures.push(`${url} failed: ${error.message}`)
    }
  }),
)

await Promise.all(
  legacyPackingListRedirects.map(async ({ url, location }) => {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      })
      validateSecurityHeaders(url, response)
      if (response.status !== 301) {
        failures.push(`${url} returned ${response.status}, expected 301`)
      }
      if (response.headers.get("location") !== location) {
        failures.push(
          `${url} redirects to ${response.headers.get("location")}, expected ${location}`,
        )
      }
    } catch (error) {
      failures.push(`${url} redirect failed: ${error.message}`)
    }
  }),
)

try {
  const [socialManifest, budgets] = await Promise.all([
    fs
      .readFile(path.join(root, ".cache/social-images/social/articles/manifest.json"), "utf8")
      .then(JSON.parse),
    fs.readFile(path.join(root, "quality/budgets.json"), "utf8").then(JSON.parse),
  ])
  const entry = socialManifest.entries?.find((item) => item.slug === "agent-mcp")
  if (!entry) throw new Error("agent-mcp is missing from the social image manifest")

  const articleResponse = await fetch("https://markz.fun/blog/agent-mcp", {
    signal: AbortSignal.timeout(15000),
  })
  if (!articleResponse.ok) throw new Error(`article returned ${articleResponse.status}`)
  validateSecurityHeaders("https://markz.fun/blog/agent-mcp", articleResponse)
  const facts = inspectHtml(await articleResponse.text())
  failures.push(...validateArticleSocialMetadata("production agent-mcp", facts, entry))

  const imageUrl = `https://markz.fun/static/${entry.path}`
  const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) })
  if (!imageResponse.ok) throw new Error(`social image returned ${imageResponse.status}`)
  validateSecurityHeaders("production article social image", imageResponse)
  if (imageResponse.headers.get("content-security-policy") !== expectedContentSecurityPolicy) {
    failures.push("production article social image has invalid content-security-policy")
  }
  if (imageResponse.headers.get("content-type")?.split(";")[0] !== "image/png") {
    failures.push("production article social image must return image/png")
  }
  const image = Buffer.from(await imageResponse.arrayBuffer())
  const metadata = await sharp(image).metadata()
  if (metadata.format !== "png" || metadata.width !== 1200 || metadata.height !== 630) {
    failures.push("production article social image must decode as a 1200x630 PNG")
  }
  const blogBudget = budgets.outputs?.find((output) => output.id === "blog")
  if (image.length > blogBudget?.maxSocialImageBytes) {
    failures.push(
      `production article social image budget exceeded: ${image.length} > ${blogBudget?.maxSocialImageBytes}`,
    )
  }
} catch (error) {
  failures.push(`production article social image failed: ${error.message}`)
}

try {
  const response = await fetch("https://note.markz.fun/static/contentIndex.json", {
    signal: AbortSignal.timeout(15000),
  })
  validateSecurityHeaders("production note graph index", response)
  if (response.headers.get("content-security-policy") !== expectedContentSecurityPolicy) {
    failures.push("production note graph index has invalid content-security-policy")
  }
  const index = await response.json()
  const outgoing = index[linkedGraphSlug]?.links ?? []
  if (outgoing.length < 4) {
    failures.push(
      `note graph index has only ${outgoing.length} outgoing links for ${linkedGraphSlug}`,
    )
  }
} catch (error) {
  failures.push(`note graph index failed: ${error.message}`)
}

const smokeInteraction = {
  site: "blog",
  slug: "blog/__reaction-smoke__",
  visitor: "00000000-0000-4000-8000-000000000001",
}

async function writeInteraction(pathname) {
  const response = await fetch(`https://markz.fun${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(smokeInteraction),
    signal: AbortSignal.timeout(15000),
  })
  return { response, body: await response.json() }
}

try {
  const firstView = await writeInteraction("/api/reactions/view")
  const duplicateView = await writeInteraction("/api/reactions/view")
  if (
    !firstView.response.ok ||
    !duplicateView.response.ok ||
    firstView.body.views < 1 ||
    duplicateView.body.views !== firstView.body.views ||
    duplicateView.body.added !== false
  ) {
    failures.push("production unique view write is not idempotently available")
  }

  const { response, body: reaction } = await writeInteraction("/api/reactions")
  if (!response.ok || reaction.liked !== true || reaction.likes < 1) {
    failures.push("production reactions write is not idempotently available")
  }
} catch (error) {
  failures.push(`production interaction write failed: ${error.message}`)
}

if (process.env.MARKZ_SKIP_REMOTE_PORT_CHECK !== "1") {
  try {
    const output = execFileSync(
      "ssh",
      [
        "-i",
        sshKey,
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        sshHost,
        'docker inspect -f "{{.Name}} {{json .HostConfig.PortBindings}} {{if .State.Health}}{{.State.Health.Status}}{{end}}" markz-edge markz-reactions markz-reactions-backup jsonutil-app-frontend-1 jsonutil-app-backend-1 && docker exec markz-reactions-backup node /app/backup.mjs drill',
      ],
      { encoding: "utf8" },
    )
    if (!/markz-edge.*"80\/tcp".*"443\/tcp"|markz-edge.*"443\/tcp".*"80\/tcp"/.test(output)) {
      failures.push("markz-edge does not own both public ports")
    }
    for (const container of ["jsonutil-app-frontend-1", "jsonutil-app-backend-1"]) {
      if (!new RegExp(`${container} \\{\\}`).test(output)) {
        failures.push(`${container} unexpectedly binds a host port`)
      }
    }
    if (!/markz-reactions \{\} healthy/.test(output)) {
      failures.push("markz-reactions is unhealthy or unexpectedly binds a host port")
    }
    if (!/markz-reactions-backup \{\} healthy/.test(output)) {
      failures.push("markz-reactions-backup is unhealthy or unexpectedly binds a host port")
    }
    if (!/Reactions restore drill passed/.test(output)) {
      failures.push("production reactions backup did not pass a restore drill")
    }
  } catch (error) {
    failures.push(`remote port ownership check failed: ${error.message}`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    "Production routes, canonical legacy redirects, CSP and security headers, article social images, brand assets, notes graph index, visitor metrics, reactions, backup restore, API health, and port ownership are correct.",
  )
}
