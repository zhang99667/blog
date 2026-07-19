import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { promises as fs } from "node:fs"
import sharp from "sharp"
import {
  inspectHtml,
  validateArticleSocialMetadata,
  validateLegacyStylesheetCompatibility,
} from "./check-build.mjs"
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
const pairedReactionRoutes = [
  {
    origin: "https://markz.fun",
    site: "blog",
    slug: "blog/agent-mcp",
  },
  {
    origin: "https://note.markz.fun",
    site: "notes",
    slug: linkedGraphSlug,
  },
]
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
    applicationName: "MarkZ 个人博客",
    canonical: "https://markz.fun/",
    description: tokens.brand.description,
    siteName: "MarkZ 个人博客",
    structuredTypes: ["WebSite", "Blog", "WebPage"],
    forbiddenEvidence: ["JSONUtils - 在线 JSON 格式化、校验与智能修复工具"],
  },
  {
    url: "https://www.markz.fun/",
    evidence: brandEvidence,
    title: "MarkZ · 个人博客",
    applicationName: "MarkZ 个人博客",
  },
  {
    url: "https://note.markz.fun/",
    evidence: brandEvidence,
    title: "Notes · 公开笔记",
    applicationName: "MarkZ 公开笔记",
  },
  {
    url: "https://note.markz.fun/ai/agent-mcp-%E5%AE%8C%E5%85%A8%E6%8C%87%E5%8D%97",
    evidence: [`data-slug="${linkedGraphSlug}"`],
    title: "Agent MCP 完全指南 · 公开笔记",
    applicationName: "MarkZ 公开笔记",
  },
  {
    url: "https://jsonutils.markz.fun/",
    title: "JSONUtils - 在线 JSON 格式化、校验与智能修复工具",
    applicationName: "JSONUtils",
    canonical: "https://jsonutils.markz.fun/",
    description:
      "JSONUtils 是面向开发者的在线 JSON 格式化与校验工具，可定位语法错误、智能修复异常 JSON，并支持 JSONPath 查询、差异对比、JSON Schema 校验和 TypeScript 类型生成；常规处理在浏览器本地完成。",
    siteName: "JSONUtils",
    structuredTypes: ["WebSite", "WebApplication"],
    forbiddenEvidence: ["MarkZ 个人博客"],
  },
  {
    url: "https://jsonutils.markz.fun/admin",
    title: "JSON Utils - 后台管理",
    responseHeaders: { "x-robots-tag": "noindex, nofollow" },
  },
  { url: "https://zhangjihao.markz.fun/", title: "智能装箱单生成器" },
  { url: "https://jsonutils.markz.fun/api/health" },
  {
    url: "https://markz.fun/api/visitors",
    evidence: ['"todayVisitors":', '"totalVisitors":'],
  },
  { url: "https://markz.fun/api/reactions/health", evidence: ['"status":"ok"'] },
  { url: "https://note.markz.fun/api/reactions/health", evidence: ['"status":"ok"'] },
  {
    url: "https://markz.fun/robots.txt",
    evidence: ["Sitemap: https://markz.fun/sitemap.xml"],
    forbiddenEvidence: ["jsonutils.markz.fun"],
    contentType: "text/plain",
  },
  {
    url: "https://markz.fun/sitemap.xml",
    evidence: ["<loc>https://markz.fun/"],
    forbiddenEvidence: ["jsonutils.markz.fun"],
    contentType: "xml",
  },
  {
    url: "https://jsonutils.markz.fun/robots.txt",
    evidence: ["Sitemap: https://jsonutils.markz.fun/sitemap.xml"],
    forbiddenEvidence: ["Sitemap: https://markz.fun/"],
    contentType: "text/plain",
  },
  {
    url: "https://jsonutils.markz.fun/sitemap.xml",
    evidence: ["<loc>https://jsonutils.markz.fun/</loc>"],
    forbiddenEvidence: ["<loc>https://markz.fun/"],
    contentType: "xml",
  },
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

function structuredDataTypes(payloads) {
  return new Set(
    payloads.flatMap((payload) => [
      payload?.["@type"],
      ...(Array.isArray(payload?.["@graph"])
        ? payload["@graph"].map((node) => node?.["@type"])
        : []),
    ]),
  )
}

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
  routes.map(
    async ({
      url,
      evidence = [],
      forbiddenEvidence = [],
      status = 200,
      title,
      applicationName,
      canonical,
      description,
      siteName,
      structuredTypes = [],
      contentType,
      responseHeaders = {},
    }) => {
      try {
        const response = await fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        })
        const body = await response.text()
        if (response.status !== status)
          failures.push(`${url} returned ${response.status}, expected ${status}`)
        validateSecurityHeaders(url, response)
        for (const [header, expected] of Object.entries(responseHeaders)) {
          const actual = response.headers.get(header)
          if (actual !== expected) {
            failures.push(
              `${url} has invalid ${header}: ${actual ?? "missing"}; expected ${expected}`,
            )
          }
        }
        for (const snippet of evidence) {
          if (!body.includes(snippet)) failures.push(`${url} is missing ${snippet}`)
        }
        for (const snippet of forbiddenEvidence) {
          if (body.includes(snippet)) failures.push(`${url} must not contain ${snippet}`)
        }
        if (contentType && !response.headers.get("content-type")?.includes(contentType)) {
          failures.push(`${url} has invalid content-type ${response.headers.get("content-type")}`)
        }
        if (
          title ||
          applicationName ||
          canonical ||
          description ||
          siteName ||
          structuredTypes.length
        ) {
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
          if (canonical && facts.canonical !== canonical)
            failures.push(`${url} has invalid canonical`)
          if (description && facts.meta.get("description") !== description) {
            failures.push(`${url} has invalid description`)
          }
          if (siteName && facts.meta.get("og:site_name") !== siteName) {
            failures.push(`${url} has invalid og:site_name`)
          }
          const types = structuredDataTypes(facts.structuredData)
          for (const type of structuredTypes) {
            if (!types.has(type)) failures.push(`${url} is missing ${type} structured data`)
          }
        }
      } catch (error) {
        failures.push(`${url} failed: ${error.message}`)
      }
    },
  ),
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
  const localStylesheets = facts.stylesheets.filter((reference) => !/^https?:\/\//i.test(reference))
  const productionCss = await Promise.all(
    localStylesheets.map(async (reference) => {
      const url = new URL(reference, articleResponse.url)
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(`${url} returned ${response.status}`)
      validateSecurityHeaders(url.toString(), response)
      return response.text()
    }),
  )
  failures.push(
    ...validateLegacyStylesheetCompatibility(facts.stylesheets, productionCss).map(
      (failure) => `production CSS ${failure}`,
    ),
  )

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

try {
  const metrics = await Promise.all(
    pairedReactionRoutes.map(async ({ origin, site, slug }) => {
      const url = new URL("/api/reactions", origin)
      url.search = new URLSearchParams({ site, slug }).toString()
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
      validateSecurityHeaders(url.toString(), response)
      if (!response.ok) throw new Error(`${url} returned ${response.status}`)
      const body = await response.json()
      if (!Number.isInteger(body.likes) || !Number.isInteger(body.views)) {
        throw new Error(`${url} returned invalid metrics`)
      }
      return body
    }),
  )
  if (metrics[0].likes !== metrics[1].likes || metrics[0].views !== metrics[1].views) {
    failures.push(
      `same-source reaction metrics diverged: blog=${JSON.stringify(metrics[0])}, notes=${JSON.stringify(metrics[1])}`,
    )
  }
} catch (error) {
  failures.push(`same-source reaction metrics failed: ${error.message}`)
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
    "Production routes, legacy CSS compatibility, canonical redirects, CSP and security headers, article social images, brand assets, notes graph index, visitor metrics, reactions, backup restore, API health, and port ownership are correct.",
  )
}
