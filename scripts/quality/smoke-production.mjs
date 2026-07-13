import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { promises as fs } from "node:fs"

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
const routes = [
  { url: "https://markz.fun/", evidence: brandEvidence },
  { url: "https://note.markz.fun/", evidence: brandEvidence },
  {
    url: "https://note.markz.fun/ai/agent-mcp-%E5%AE%8C%E5%85%A8%E6%8C%87%E5%8D%97",
    evidence: [`data-slug="${linkedGraphSlug}"`],
  },
  { url: "https://jsonutils.markz.fun/" },
  { url: "https://jsonutils.markz.fun/admin" },
  { url: "https://zhangjihao.markz.fun/" },
  { url: "https://jsonutils.markz.fun/api/health" },
  { url: "https://markz.fun/api/reactions/health", evidence: ['"status":"ok"'] },
  { url: "https://note.markz.fun/api/reactions/health", evidence: ['"status":"ok"'] },
]

const failures = []
await Promise.all(
  routes.map(async ({ url, evidence = [] }) => {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) })
      const body = await response.text()
      if (!response.ok) failures.push(`${url} returned ${response.status}`)
      for (const snippet of evidence) {
        if (!body.includes(snippet)) failures.push(`${url} is missing ${snippet}`)
      }
    } catch (error) {
      failures.push(`${url} failed: ${error.message}`)
    }
  }),
)

try {
  const response = await fetch("https://note.markz.fun/static/contentIndex.json", {
    signal: AbortSignal.timeout(15000),
  })
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
  const response = await fetch("https://markz.fun/api/reactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      site: "blog",
      slug: "blog/__reaction-smoke__",
      visitor: "00000000-0000-4000-8000-000000000001",
    }),
    signal: AbortSignal.timeout(15000),
  })
  const reaction = await response.json()
  if (!response.ok || reaction.liked !== true || reaction.count < 1) {
    failures.push("production reactions write is not idempotently available")
  }
} catch (error) {
  failures.push(`production reactions write failed: ${error.message}`)
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
        'docker inspect -f "{{.Name}} {{json .HostConfig.PortBindings}} {{if .State.Health}}{{.State.Health.Status}}{{end}}" markz-edge markz-reactions jsonutil-app-frontend-1 jsonutil-app-backend-1',
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
  } catch (error) {
    failures.push(`remote port ownership check failed: ${error.message}`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    "Production routes, brand assets, notes graph index, reactions, API health, and port ownership are correct.",
  )
}
