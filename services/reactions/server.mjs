import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"

const MAX_BODY_BYTES = 2_048
const VALID_SITES = new Set(["blog", "notes"])
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function normalizePage(site, slug) {
  if (!VALID_SITES.has(site)) throw new HttpError(400, "Invalid site")
  if (typeof slug !== "string") throw new HttpError(400, "Invalid slug")

  const normalized = slug
    .normalize("NFC")
    .trim()
    .replace(/^\/+|\/+$/g, "")
  if (
    normalized.length === 0 ||
    normalized.length > 300 ||
    /[\u0000-\u001f\u007f\\?#]/u.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..") ||
    (site === "blog" && !normalized.startsWith("blog/"))
  ) {
    throw new HttpError(400, "Invalid slug")
  }

  return { site, slug: normalized }
}

function normalizeVisitor(visitor) {
  if (typeof visitor !== "string" || !UUID_V4.test(visitor)) {
    throw new HttpError(400, "Invalid visitor")
  }
  return createHash("sha256").update(visitor.toLowerCase()).digest("hex")
}

function jsonResponse(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  })
  response.end(body)
}

async function readJson(request) {
  const declaredLength = Number(request.headers["content-length"] ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Request body too large")
  }

  let bytes = 0
  let tooLarge = false
  const chunks = []
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > MAX_BODY_BYTES) {
      tooLarge = true
    } else {
      chunks.push(chunk)
    }
  }
  if (tooLarge) throw new HttpError(413, "Request body too large")

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error()
    return value
  } catch {
    throw new HttpError(400, "Invalid JSON")
  }
}

export function createReactionStore(databasePath) {
  if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true })

  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS reactions (
      site TEXT NOT NULL,
      slug TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (site, slug, visitor_hash)
    ) STRICT, WITHOUT ROWID;
  `)

  const countStatement = database.prepare(
    "SELECT COUNT(*) AS count FROM reactions WHERE site = ? AND slug = ?",
  )
  const insertStatement = database.prepare(
    "INSERT OR IGNORE INTO reactions (site, slug, visitor_hash) VALUES (?, ?, ?)",
  )

  return {
    count(site, slug) {
      const page = normalizePage(site, slug)
      const row = countStatement.get(page.site, page.slug)
      return Number(row.count)
    },
    add(site, slug, visitor) {
      const page = normalizePage(site, slug)
      const visitorHash = normalizeVisitor(visitor)
      const result = insertStatement.run(page.site, page.slug, visitorHash)
      const row = countStatement.get(page.site, page.slug)
      return { added: Number(result.changes) === 1, count: Number(row.count) }
    },
    close() {
      database.close()
    },
  }
}

export function createReactionService({ databasePath = ":memory:" } = {}) {
  const store = createReactionStore(databasePath)
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://reactions.internal")

      if (url.pathname === "/api/reactions/health") {
        if (request.method !== "GET") {
          jsonResponse(response, 405, { error: "Method not allowed" }, { allow: "GET" })
          return
        }
        jsonResponse(response, 200, { status: "ok" })
        return
      }

      if (url.pathname !== "/api/reactions") {
        jsonResponse(response, 404, { error: "Not found" })
        return
      }

      if (request.method === "GET") {
        const site = url.searchParams.get("site")
        const slug = url.searchParams.get("slug")
        jsonResponse(response, 200, { count: store.count(site, slug) })
        return
      }

      if (request.method === "POST") {
        const body = await readJson(request)
        const result = store.add(body.site, body.slug, body.visitor)
        jsonResponse(response, result.added ? 201 : 200, {
          count: result.count,
          liked: true,
          added: result.added,
        })
        return
      }

      jsonResponse(response, 405, { error: "Method not allowed" }, { allow: "GET, POST" })
    } catch (error) {
      if (error instanceof HttpError) {
        jsonResponse(response, error.status, { error: error.message })
        return
      }
      console.error("Reaction request failed", error)
      jsonResponse(response, 500, { error: "Internal server error" })
    }
  })

  server.headersTimeout = 5_000
  server.requestTimeout = 5_000
  server.keepAliveTimeout = 5_000
  server.maxRequestsPerSocket = 100

  return {
    server,
    async listen({ host = "127.0.0.1", port = 0 } = {}) {
      await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(port, host, () => {
          server.off("error", reject)
          resolve()
        })
      })
      return server.address()
    },
    async close() {
      if (server.listening) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      }
      store.close()
    },
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  const databasePath = process.env.REACTIONS_DB_PATH ?? "/data/reactions.sqlite"
  const port = Number(process.env.PORT ?? 3000)
  const service = createReactionService({ databasePath })
  await service.listen({ host: "0.0.0.0", port })
  console.log(`MarkZ reactions listening on port ${port}`)

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await service.close()
    process.exit(0)
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
}
