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
const backup = readFileSync(path.join(root, "services/reactions/backup.mjs"), "utf8")
const offsiteBackup = readFileSync(path.join(root, "services/reactions/offsite-backup.mjs"), "utf8")
const offsitePackage = readFileSync(
  path.join(root, "scripts/runtime-backup/package-encrypted.sh"),
  "utf8",
)
const ageTool = readFileSync(path.join(root, "scripts/runtime-backup/age-tool.sh"), "utf8")
const keyBootstrap = readFileSync(
  path.join(root, "scripts/runtime-backup/bootstrap-key.sh"),
  "utf8",
)
const offsiteRestore = readFileSync(
  path.join(root, "scripts/runtime-backup/restore-encrypted.sh"),
  "utf8",
)
const backupWorkflowSource = readFileSync(
  path.join(root, ".github/workflows/markz-backup.yaml"),
  "utf8",
)
const backupWorkflow = YAML.parse(backupWorkflowSource)
const publishWorkflow = readFileSync(
  path.join(root, ".github/workflows/markz-publish.yaml"),
  "utf8",
)
const knownHosts = readFileSync(path.join(root, "deploy/known_hosts"), "utf8")

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
    assert.equal(reactions.environment.REACTIONS_ALIASES_PATH, "/app/reaction-aliases.json")
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
    const startIndex = deploy.indexOf(
      "docker compose up -d --force-recreate --wait reactions reactions-backup",
    )
    const nginxTestIndex = deploy.indexOf("docker compose run --rm --no-deps edge nginx -t")
    const edgeIndex = deploy.indexOf("docker compose up -d --force-recreate edge")
    const aliasSyncIndex = deploy.lastIndexOf("reaction-aliases.json", startIndex)
    const backupIndex = deploy.indexOf("backup.mjs once")
    assert.ok(startIndex > 0)
    assert.ok(aliasSyncIndex > 0)
    assert.ok(aliasSyncIndex < startIndex)
    assert.ok(backupIndex > aliasSyncIndex)
    assert.ok(backupIndex < startIndex)
    assert.ok(nginxTestIndex > startIndex)
    assert.ok(edgeIndex > nginxTestIndex)
    assert.match(deploy, /reactionsDir/)
    assert.match(deploy, /reactionAliases/)
    assert.match(deploy, /remoteReactionsBackupDir/)
    assert.match(smoke, /markz-reactions/)
    assert.match(smoke, /markz-reactions-backup/)
    assert.match(smoke, /backup\.mjs drill/)
    assert.match(smoke, /blog\/__reaction-smoke__/)
    assert.match(smoke, /blog\/agent-mcp/)
    assert.match(smoke, /same-source reaction metrics diverged/)
    assert.match(smoke, /\/api\/visitors/)
  })

  test("backs up through an isolated sidecar with bounded retention and restore evidence", () => {
    const service = compose.services["reactions-backup"]
    assert.equal(service.container_name, "markz-reactions-backup")
    assert.equal(service.network_mode, "none")
    assert.equal(service.read_only, true)
    assert.deepEqual(service.cap_drop, ["ALL"])
    assert.ok(service.security_opt.includes("no-new-privileges:true"))
    assert.equal(service.depends_on.reactions.condition, "service_healthy")
    assert.ok(service.volumes.some((volume) => volume.endsWith(":/data:ro")))
    assert.ok(service.volumes.some((volume) => volume.endsWith(":/backups")))
    assert.equal(service.environment.BACKUP_INTERVAL_MS, "21600000")
    assert.equal(service.environment.BACKUP_MAX_AGE_MS, "43200000")
    assert.equal(service.environment.BACKUP_RETENTION_COUNT, "32")
    assert.equal(service.environment.BACKUP_RETRY_MS, "60000")
    assert.deepEqual(service.healthcheck.test, ["CMD", "node", "/app/backup.mjs", "health"])
    assert.match(backup, /await backup\(source, temporarySnapshot/)
    assert.match(backup, /PRAGMA integrity_check/)
    assert.match(backup, /PRAGMA foreign_key_check/)
    assert.match(backup, /PRAGMA journal_mode = DELETE/)
    assert.match(backup, /runRestoreDrill/)
  })

  test("keeps encrypted off-site recovery manual and proves recovery before upload", () => {
    assert.equal(backupWorkflow.on.schedule, undefined)
    assert.ok(backupWorkflow.on.workflow_dispatch !== undefined)
    assert.equal(backupWorkflow.permissions.contents, "read")
    assert.equal(backupWorkflow.jobs.backup["timeout-minutes"], 15)
    assert.equal(backupWorkflow.jobs.backup.if, "vars.MARKZ_RUNTIME_BACKUP_ENABLED == 'true'")
    const upload = backupWorkflow.jobs.backup.steps.find((step) =>
      String(step.uses ?? "").startsWith("actions/upload-artifact@"),
    )
    assert.equal(upload.id, "upload")
    assert.equal(upload.with.path, ".cache/runtime-backup-upload")
    assert.equal(upload.with["retention-days"], 90)
    assert.equal(upload.with["compression-level"], 0)
    assert.equal(upload.with["if-no-files-found"], "error")
    assert.match(backupWorkflowSource, /deploy\/runtime-backup-recipient\.txt/)
    assert.match(backupWorkflowSource, /backup\.mjs latest-json/)
    assert.match(backupWorkflowSource, /backup\.mjs drill/)
    assert.match(backupWorkflowSource, /steps\.upload\.outputs\.artifact-digest/)
    assert.match(offsiteBackup, /verifyOffsiteBundle/)
    assert.match(offsiteBackup, /restoreOffsiteBundle/)
    assert.match(ageTool, /MARKZ_AGE_VERSION="1\.3\.1"/)
    assert.match(ageTool, /bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377/)
    assert.match(offsitePackage, /ephemeral_identity/)
    assert.match(offsitePackage, /offsite-backup\.mjs" verify/)
    assert.match(offsitePackage, /offsite-backup\.mjs" restore/)
    assert.match(offsitePackage, /! -name '\*\.age' ! -name '\*\.sha256'/)
    assert.match(keyBootstrap, /--confirm-create-key/)
    assert.match(keyBootstrap, /private backup identity must stay outside the repository/i)
    assert.match(offsiteRestore, /Encrypted artifact checksum does not match/)
    assert.match(offsiteRestore, /Artifact directory contains an unexpected file/)
    assert.match(offsiteRestore, /Restore destination already exists/)
    assert.match(offsiteRestore, /offsite-backup\.mjs" restore/)
    for (const source of [ageTool, keyBootstrap, offsitePackage, offsiteRestore]) {
      assert.doesNotMatch(source, /MARKZ_SSH_PRIVATE_KEY|NOTE_REPO_SSH_KEY/)
    }
  })

  test("pins the production SSH host instead of trusting a live key scan", () => {
    assert.match(
      knownHosts,
      /^39\.97\.237\.248 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDXiOADIv0NtaDAmL6mFoVzvfizewMiQMEyOMrr\+rJkV\n$/,
    )
    assert.match(backupWorkflowSource, /install -m 600 deploy\/known_hosts/)
    assert.match(publishWorkflow, /install -m 600 deploy\/known_hosts/)
    assert.doesNotMatch(backupWorkflowSource, /ssh-keyscan/)
    assert.doesNotMatch(publishWorkflow, /ssh-keyscan/)
  })

  test("stores anonymous identifiers as hashes and never consumes forwarded IP data", () => {
    assert.match(server, /createHash\("sha256"\)/)
    assert.match(server, /PRIMARY KEY \(site, slug, visitor_hash\)/)
    assert.match(server, /migrateReactionAliases/)
    assert.match(server, /PRIMARY KEY \(visit_date, visitor_hash\)/)
    assert.doesNotMatch(server, /x-forwarded-for|x-real-ip|remote_addr/i)
  })
})
