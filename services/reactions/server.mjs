import { createHash } from "node:crypto"
import { mkdirSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"

const MAX_BODY_BYTES = 2_048
const PUBLIC_SITES = new Set(["blog", "notes"])
const CONTENT_ID = /^v1\/[a-f0-9]{64}$/
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VISITOR_TIME_ZONE = "Asia/Shanghai"
const VISITOR_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: VISITOR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function normalizePageInput(site, slug) {
  if (!PUBLIC_SITES.has(site)) throw new HttpError(400, "Invalid site")
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

function normalizeContentTarget(id) {
  if (typeof id !== "string" || !CONTENT_ID.test(id)) {
    throw new Error("Invalid reactions content ID")
  }
  return { site: "content", slug: id }
}

function pageKey({ site, slug }) {
  return `${site}\0${slug}`
}

export function parseReactionAliases(value = { version: 1, pages: [] }) {
  if (!value || value.version !== 1 || !Array.isArray(value.pages)) {
    throw new Error("Invalid reactions alias manifest")
  }

  const aliasMap = new Map()
  const migrations = []
  for (const entry of value.pages) {
    if (!entry || !Array.isArray(entry.aliases)) {
      throw new Error("Invalid reactions alias entry")
    }
    const target = normalizeContentTarget(entry.id)
    for (const candidate of entry.aliases) {
      const alias = normalizePageInput(candidate?.site, candidate?.slug)
      const key = pageKey(alias)
      const existing = aliasMap.get(key)
      if (existing && pageKey(existing) !== pageKey(target)) {
        throw new Error(`Reaction alias ${alias.site}:${alias.slug} has multiple owners`)
      }
      aliasMap.set(key, target)
      migrations.push({ alias, target })
    }
  }
  return { aliasMap, migrations }
}

export function loadReactionAliases(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"))
}

function normalizePage(site, slug, aliasMap) {
  const page = normalizePageInput(site, slug)
  return aliasMap.get(pageKey(page)) ?? page
}

function migrateReactionAliases(database, migrations) {
  if (migrations.length === 0) return

  const copies = ["reactions", "views"].map((table) =>
    database.prepare(`
      INSERT OR IGNORE INTO ${table} (site, slug, visitor_hash, created_at)
      SELECT ?, ?, visitor_hash, created_at
      FROM ${table}
      WHERE site = ? AND slug = ?
    `),
  )
  const removals = ["reactions", "views"].map((table) =>
    database.prepare(`DELETE FROM ${table} WHERE site = ? AND slug = ?`),
  )

  database.exec("BEGIN IMMEDIATE")
  try {
    for (const { alias, target } of migrations) {
      for (const copy of copies) {
        copy.run(target.site, target.slug, alias.site, alias.slug)
      }
      for (const remove of removals) {
        remove.run(alias.site, alias.slug)
      }
    }
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}

function normalizeVisitor(visitor) {
  if (typeof visitor !== "string" || !UUID_V4.test(visitor)) {
    throw new HttpError(400, "Invalid visitor")
  }
  return createHash("sha256").update(visitor.toLowerCase()).digest("hex")
}

function visitorDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error("Invalid visitor clock")

  const parts = Object.fromEntries(
    VISITOR_DATE_FORMATTER.formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: part }) => [type, part]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
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

export function createReactionStore(databasePath, { reactionAliases } = {}) {
  if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true })

  const database = new DatabaseSync(databasePath)
  const { aliasMap, migrations } = parseReactionAliases(reactionAliases)
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
    CREATE TABLE IF NOT EXISTS views (
      site TEXT NOT NULL,
      slug TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (site, slug, visitor_hash)
    ) STRICT, WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS visitors (
      visitor_hash TEXT NOT NULL PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT, WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS daily_visitors (
      visit_date TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK (ordinal > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (visit_date, visitor_hash),
      UNIQUE (visit_date, ordinal)
    ) STRICT, WITHOUT ROWID;
    INSERT OR IGNORE INTO visitors (visitor_hash, created_at)
    SELECT visitor_hash, MIN(created_at)
    FROM (
      SELECT visitor_hash, created_at FROM reactions WHERE site = 'blog'
      UNION ALL
      SELECT visitor_hash, created_at FROM views WHERE site = 'blog'
    )
    GROUP BY visitor_hash;
  `)
  migrateReactionAliases(database, migrations)

  const likeCountStatement = database.prepare(
    "SELECT COUNT(*) AS count FROM reactions WHERE site = ? AND slug = ?",
  )
  const viewCountStatement = database.prepare(
    "SELECT COUNT(*) AS count FROM views WHERE site = ? AND slug = ?",
  )
  const insertLikeStatement = database.prepare(
    "INSERT OR IGNORE INTO reactions (site, slug, visitor_hash) VALUES (?, ?, ?)",
  )
  const insertViewStatement = database.prepare(
    "INSERT OR IGNORE INTO views (site, slug, visitor_hash) VALUES (?, ?, ?)",
  )
  const likedStatement = database.prepare(
    "SELECT 1 AS liked FROM reactions WHERE site = ? AND slug = ? AND visitor_hash = ?",
  )
  const visitorCountStatement = database.prepare("SELECT COUNT(*) AS count FROM visitors")
  const dailyVisitorCountStatement = database.prepare(
    "SELECT COUNT(*) AS count FROM daily_visitors WHERE visit_date = ?",
  )
  const visitorOrdinalStatement = database.prepare(
    "SELECT ordinal FROM daily_visitors WHERE visit_date = ? AND visitor_hash = ?",
  )
  const insertVisitorStatement = database.prepare(
    "INSERT OR IGNORE INTO visitors (visitor_hash) VALUES (?)",
  )
  const insertDailyVisitorStatement = database.prepare(`
    INSERT OR IGNORE INTO daily_visitors (visit_date, visitor_hash, ordinal)
    SELECT ?, ?, COALESCE(MAX(ordinal), 0) + 1
    FROM daily_visitors
    WHERE visit_date = ?
  `)

  function countsFor(page) {
    const likes = Number(likeCountStatement.get(page.site, page.slug).count)
    const views = Number(viewCountStatement.get(page.site, page.slug).count)
    return { likes, views }
  }

  function add(insertStatement, site, slug, visitor) {
    const page = normalizePage(site, slug, aliasMap)
    const visitorHash = normalizeVisitor(visitor)
    const result = insertStatement.run(page.site, page.slug, visitorHash)
    return {
      added: Number(result.changes) === 1,
      ...countsFor(page),
      liked: Boolean(likedStatement.get(page.site, page.slug, visitorHash)),
    }
  }

  function visitorCountsFor(visitDate) {
    return {
      date: visitDate,
      todayVisitors: Number(dailyVisitorCountStatement.get(visitDate).count),
      totalVisitors: Number(visitorCountStatement.get().count),
    }
  }

  return {
    counts(site, slug) {
      const page = normalizePage(site, slug, aliasMap)
      return countsFor(page)
    },
    addLike(site, slug, visitor) {
      return add(insertLikeStatement, site, slug, visitor)
    },
    addView(site, slug, visitor) {
      return add(insertViewStatement, site, slug, visitor)
    },
    visitorCounts(visitDate) {
      return visitorCountsFor(visitDate)
    },
    addVisitor(visitor, visitDate) {
      const visitorHash = normalizeVisitor(visitor)
      database.exec("BEGIN IMMEDIATE")
      try {
        const totalResult = insertVisitorStatement.run(visitorHash)
        const todayResult = insertDailyVisitorStatement.run(visitDate, visitorHash, visitDate)
        const ordinal = visitorOrdinalStatement.get(visitDate, visitorHash)?.ordinal
        if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
          throw new Error("Visitor ordinal was not persisted")
        }
        database.exec("COMMIT")
        return {
          ...visitorCountsFor(visitDate),
          todayOrdinal: Number(ordinal),
          addedToday: Number(todayResult.changes) === 1,
          addedTotal: Number(totalResult.changes) === 1,
        }
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
    close() {
      database.close()
    },
  }
}

export function createReactionService({
  databasePath = ":memory:",
  now = () => new Date(),
  reactionAliases,
} = {}) {
  const store = createReactionStore(databasePath, { reactionAliases })
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

      if (url.pathname === "/api/visitors") {
        const visitDate = visitorDate(now())
        if (request.method === "GET") {
          jsonResponse(response, 200, store.visitorCounts(visitDate))
          return
        }
        if (request.method === "POST") {
          const body = await readJson(request)
          const result = store.addVisitor(body.visitor, visitDate)
          jsonResponse(response, result.addedToday ? 201 : 200, result)
          return
        }
        jsonResponse(response, 405, { error: "Method not allowed" }, { allow: "GET, POST" })
        return
      }

      if (url.pathname === "/api/reactions/view") {
        if (request.method !== "POST") {
          jsonResponse(response, 405, { error: "Method not allowed" }, { allow: "POST" })
          return
        }
        const body = await readJson(request)
        const result = store.addView(body.site, body.slug, body.visitor)
        jsonResponse(response, result.added ? 201 : 200, result)
        return
      }

      if (url.pathname !== "/api/reactions") {
        jsonResponse(response, 404, { error: "Not found" })
        return
      }

      if (request.method === "GET") {
        const site = url.searchParams.get("site")
        const slug = url.searchParams.get("slug")
        const counts = store.counts(site, slug)
        jsonResponse(response, 200, { count: counts.likes, ...counts })
        return
      }

      if (request.method === "POST") {
        const body = await readJson(request)
        const result = store.addLike(body.site, body.slug, body.visitor)
        jsonResponse(response, result.added ? 201 : 200, {
          count: result.likes,
          likes: result.likes,
          views: result.views,
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
  const aliasesPath = process.env.REACTIONS_ALIASES_PATH
  const reactionAliases = aliasesPath ? loadReactionAliases(aliasesPath) : undefined
  const port = Number(process.env.PORT ?? 3000)
  const service = createReactionService({ databasePath, reactionAliases })
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
