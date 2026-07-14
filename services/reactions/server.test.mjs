import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, test } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { createReactionService } from "./server.mjs"

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function startService(databasePath = ":memory:") {
  const service = createReactionService({ databasePath })
  const address = await service.listen()
  return {
    service,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options)
  return { response, body: await response.json() }
}

function visitor(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
}

describe("MarkZ reactions API", () => {
  test("counts anonymous likes and views idempotently while keeping surfaces separate", async () => {
    const { service, baseUrl } = await startService()
    try {
      const initial = await requestJson(
        `${baseUrl}/api/reactions?site=notes&slug=${encodeURIComponent("ai/中文笔记")}`,
      )
      assert.equal(initial.response.status, 200)
      assert.equal(initial.response.headers.get("cache-control"), "no-store")
      assert.match(initial.response.headers.get("content-type"), /^application\/json/)
      assert.deepEqual(initial.body, { count: 0, likes: 0, views: 0 })

      const firstView = await requestJson(`${baseUrl}/api/reactions/view`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site: "notes", slug: "ai/中文笔记", visitor: visitor(1) }),
      })
      assert.equal(firstView.response.status, 201)
      assert.deepEqual(firstView.body, { likes: 0, views: 1, added: true })

      const duplicateView = await requestJson(`${baseUrl}/api/reactions/view`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site: "notes", slug: "ai/中文笔记", visitor: visitor(1) }),
      })
      assert.equal(duplicateView.response.status, 200)
      assert.deepEqual(duplicateView.body, { likes: 0, views: 1, added: false })

      const first = await requestJson(`${baseUrl}/api/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site: "notes", slug: "ai/中文笔记", visitor: visitor(1) }),
      })
      assert.equal(first.response.status, 201)
      assert.deepEqual(first.body, {
        count: 1,
        likes: 1,
        views: 1,
        liked: true,
        added: true,
      })

      const duplicate = await requestJson(`${baseUrl}/api/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site: "notes", slug: "ai/中文笔记", visitor: visitor(1) }),
      })
      assert.equal(duplicate.response.status, 200)
      assert.deepEqual(duplicate.body, {
        count: 1,
        likes: 1,
        views: 1,
        liked: true,
        added: false,
      })

      const blog = await requestJson(`${baseUrl}/api/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site: "blog", slug: "blog/中文笔记", visitor: visitor(1) }),
      })
      assert.deepEqual(blog.body, {
        count: 1,
        likes: 1,
        views: 0,
        liked: true,
        added: true,
      })
    } finally {
      await service.close()
    }
  })

  test("serializes concurrent writes without losing likes or views", async () => {
    const { service, baseUrl } = await startService()
    try {
      const writes = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          requestJson(`${baseUrl}/api/reactions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              site: "blog",
              slug: "blog/concurrent",
              visitor: visitor(index + 1),
            }),
          }),
        ),
      )
      assert.equal(writes.filter(({ body }) => body.added).length, 20)
      assert.equal(Math.max(...writes.map(({ body }) => body.count)), 20)

      const views = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          requestJson(`${baseUrl}/api/reactions/view`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              site: "blog",
              slug: "blog/concurrent",
              visitor: visitor(index + 1),
            }),
          }),
        ),
      )
      assert.equal(views.filter(({ body }) => body.added).length, 20)
      assert.equal(Math.max(...views.map(({ body }) => body.views)), 20)

      const count = await requestJson(`${baseUrl}/api/reactions?site=blog&slug=blog%2Fconcurrent`)
      assert.deepEqual(count.body, { count: 20, likes: 20, views: 20 })
    } finally {
      await service.close()
    }
  })

  test("persists counts while storing only a visitor hash", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "markz-reactions-"))
    temporaryDirectories.push(directory)
    const databasePath = path.join(directory, "reactions.sqlite")

    const firstRun = await startService(databasePath)
    await requestJson(`${firstRun.baseUrl}/api/reactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site: "blog", slug: "blog/persisted", visitor: visitor(7) }),
    })
    await requestJson(`${firstRun.baseUrl}/api/reactions/view`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site: "blog", slug: "blog/persisted", visitor: visitor(7) }),
    })
    await firstRun.service.close()

    const database = new DatabaseSync(databasePath)
    for (const table of ["reactions", "views"]) {
      const row = database.prepare(`SELECT visitor_hash FROM ${table}`).get()
      assert.equal(row.visitor_hash.length, 64)
      assert.notEqual(row.visitor_hash, visitor(7))
    }
    database.close()

    const secondRun = await startService(databasePath)
    try {
      const count = await requestJson(
        `${secondRun.baseUrl}/api/reactions?site=blog&slug=blog%2Fpersisted`,
      )
      assert.deepEqual(count.body, { count: 1, likes: 1, views: 1 })
    } finally {
      await secondRun.service.close()
    }
  })

  test("adds view storage without disturbing an existing likes database", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "markz-reactions-migration-"))
    temporaryDirectories.push(directory)
    const databasePath = path.join(directory, "reactions.sqlite")
    const legacyDatabase = new DatabaseSync(databasePath)
    legacyDatabase.exec(`
      CREATE TABLE reactions (
        site TEXT NOT NULL,
        slug TEXT NOT NULL,
        visitor_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (site, slug, visitor_hash)
      ) STRICT, WITHOUT ROWID;
      INSERT INTO reactions (site, slug, visitor_hash)
      VALUES ('blog', 'blog/legacy', '${"a".repeat(64)}');
    `)
    legacyDatabase.close()

    const { service, baseUrl } = await startService(databasePath)
    try {
      const counts = await requestJson(`${baseUrl}/api/reactions?site=blog&slug=blog%2Flegacy`)
      assert.deepEqual(counts.body, { count: 1, likes: 1, views: 0 })

      const view = await requestJson(`${baseUrl}/api/reactions/view`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site: "blog", slug: "blog/legacy", visitor: visitor(9) }),
      })
      assert.deepEqual(view.body, { likes: 1, views: 1, added: true })
    } finally {
      await service.close()
    }
  })

  test("rejects malformed pages, visitors, methods and oversized payloads", async () => {
    const { service, baseUrl } = await startService()
    try {
      const invalidPage = await requestJson(
        `${baseUrl}/api/reactions?site=blog&slug=${encodeURIComponent("ai/not-a-blog")}`,
      )
      assert.equal(invalidPage.response.status, 400)

      const invalidVisitor = await requestJson(`${baseUrl}/api/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site: "notes", slug: "ai/test", visitor: "visitor" }),
      })
      assert.equal(invalidVisitor.response.status, 400)

      const method = await requestJson(`${baseUrl}/api/reactions`, { method: "DELETE" })
      assert.equal(method.response.status, 405)
      assert.equal(method.response.headers.get("allow"), "GET, POST")

      const viewMethod = await requestJson(`${baseUrl}/api/reactions/view`)
      assert.equal(viewMethod.response.status, 405)
      assert.equal(viewMethod.response.headers.get("allow"), "POST")

      const oversized = await requestJson(`${baseUrl}/api/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(2_100) }),
      })
      assert.equal(oversized.response.status, 413)

      const health = await requestJson(`${baseUrl}/api/reactions/health`)
      assert.equal(health.response.status, 200)
      assert.deepEqual(health.body, { status: "ok" })
    } finally {
      await service.close()
    }
  })
})
