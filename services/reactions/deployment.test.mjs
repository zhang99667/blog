import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const composeSource = readFileSync(path.join(root, "deploy/docker-compose.edge.yml"), "utf8")
const compose = YAML.parse(composeSource)
const nginx = readFileSync(path.join(root, "deploy/nginx.conf"), "utf8")
const deploy = readFileSync(path.join(root, "scripts/deploy.mjs"), "utf8")
const smoke = readFileSync(path.join(root, "scripts/quality/smoke-production.mjs"), "utf8")
const server = readFileSync(path.join(root, "services/reactions/server.mjs"), "utf8")

function serverBlock(serverName) {
  const marker = `server_name ${serverName};`
  const markerIndex = nginx.indexOf(marker)
  assert.notEqual(markerIndex, -1, `missing ${marker}`)
  const start = nginx.lastIndexOf("server {", markerIndex)
  const openingBrace = nginx.indexOf("{", start)
  let depth = 0
  for (let index = openingBrace; index < nginx.length; index += 1) {
    if (nginx[index] === "{") depth += 1
    if (nginx[index] === "}") depth -= 1
    if (depth === 0) return nginx.slice(start, index + 1)
  }
  throw new Error(`unterminated server block for ${serverName}`)
}

describe("reactions deployment boundary", () => {
  test("runs a pinned, hardened service without public ports", () => {
    const reactions = compose.services.reactions
    assert.equal(
      reactions.image,
      "node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd",
    )
    assert.equal(reactions.container_name, "markz-reactions")
    assert.equal(reactions.ports, undefined)
    assert.deepEqual(reactions.networks, ["reactions"])
    assert.equal(reactions.read_only, true)
    assert.deepEqual(reactions.cap_drop, ["ALL"])
    assert.ok(reactions.security_opt.includes("no-new-privileges:true"))
    assert.equal(compose.networks.reactions.internal, true)
    assert.ok(compose.services.edge.networks.includes("reactions"))
    assert.equal(compose.services.edge.depends_on.reactions.condition, "service_healthy")
  })

  test("keeps article metrics on both content hosts and site visitors on the blog only", () => {
    const blog = serverBlock("markz.fun www.markz.fun")
    const notes = serverBlock("note.markz.fun")
    const jsonutils = serverBlock("jsonutils.markz.fun")
    const admin = serverBlock("admin.markz.fun")

    for (const block of [blog, notes]) {
      assert.match(block, /location = \/api\/reactions \{/)
      assert.match(block, /location = \/api\/reactions\/view \{/)
      assert.match(block, /location = \/api\/reactions\/health \{/)
      assert.match(block, /proxy_pass http:\/\/reactions:3000;/)
      assert.match(block, /limit_req zone=markz_reaction_writes/)
    }
    assert.match(blog, /location = \/api\/visitors \{/)
    assert.match(blog, /location = \/api\/visitors \{[\s\S]*?limit_req zone=markz_reaction_writes/)
    assert.doesNotMatch(notes, /\/api\/visitors/)
    for (const block of [jsonutils, admin]) {
      assert.doesNotMatch(block, /\/api\/reactions/)
      assert.doesNotMatch(block, /\/api\/visitors/)
      assert.match(block, /proxy_pass http:\/\/app-backend:8080;/)
    }
    assert.match(nginx, /limit_req_zone \$markz_reaction_write_key/)
    assert.equal(nginx.match(/location = \/api\/reactions \{/g)?.length, 2)
    assert.equal(nginx.match(/location = \/api\/reactions\/view \{/g)?.length, 2)
    assert.equal(nginx.match(/location = \/api\/visitors \{/g)?.length, 1)
  })

  test("deploys and checks reactions before replacing the edge container", () => {
    const startIndex = deploy.indexOf("docker compose up -d --force-recreate --wait reactions")
    const nginxTestIndex = deploy.indexOf("docker compose run --rm --no-deps edge nginx -t")
    const edgeIndex = deploy.indexOf("docker compose up -d --force-recreate edge")
    assert.ok(startIndex > 0)
    assert.ok(nginxTestIndex > startIndex)
    assert.ok(edgeIndex > nginxTestIndex)
    assert.match(deploy, /reactionsDir/)
    assert.match(smoke, /markz-reactions/)
    assert.match(smoke, /blog\/__reaction-smoke__/)
    assert.match(smoke, /\/api\/visitors/)
  })

  test("stores anonymous identifiers as hashes and never consumes forwarded IP data", () => {
    assert.match(server, /createHash\("sha256"\)/)
    assert.match(server, /PRIMARY KEY \(site, slug, visitor_hash\)/)
    assert.match(server, /PRIMARY KEY \(visit_date, visitor_hash\)/)
    assert.doesNotMatch(server, /x-forwarded-for|x-real-ip|remote_addr/i)
  })
})
