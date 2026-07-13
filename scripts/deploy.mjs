import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const publicDir = path.join(root, "public")
const publicNotesDir = path.join(root, "public-notes")
const nginxConfig = path.join(root, "deploy/nginx.conf")
const edgeCompose = path.join(root, "deploy/docker-compose.edge.yml")
const reactionsDir = path.join(root, "services/reactions")

const host = process.env.BLOG_SSH_HOST ?? "markz@39.97.237.248"
const key = process.env.BLOG_SSH_KEY ?? path.join(process.env.HOME ?? "", ".ssh/id_ed25519")
const remoteDir = process.env.BLOG_REMOTE_DIR ?? "/home/markz/apps/blog/dist"
const remoteNotesDir = process.env.NOTES_REMOTE_DIR ?? "/home/markz/apps/blog/notes"
const remoteAppDir = process.env.BLOG_REMOTE_APP_DIR ?? "/home/markz/apps/blog"
const remoteAcmeDir = process.env.BLOG_ACME_DIR ?? "/home/markz/apps/blog/acme"
const remoteEdgeDir = process.env.BLOG_EDGE_DIR ?? "/home/markz/apps/markz-edge"
const remoteReactionsDir = process.env.REACTIONS_APP_DIR ?? "/home/markz/apps/blog/reactions"
const remoteReactionsDataDir =
  process.env.REACTIONS_DATA_DIR ?? "/home/markz/apps/blog/reactions-data"
const ssh = ["ssh", "-i", key, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`)
  }
}

if (!existsSync(publicDir)) {
  throw new Error("public/ does not exist. Run `npm run build` before deploy.")
}
if (!existsSync(publicNotesDir)) {
  throw new Error("public-notes/ does not exist. Run `npm run build` before deploy.")
}
if (!existsSync(nginxConfig) || !existsSync(edgeCompose) || !existsSync(reactionsDir)) {
  throw new Error("Edge deployment configuration is missing.")
}

run(ssh[0], [
  ...ssh.slice(1),
  host,
  `mkdir -p ${remoteDir} ${remoteNotesDir} ${remoteAppDir} ${remoteAcmeDir} ${remoteEdgeDir} ${remoteReactionsDir} ${remoteReactionsDataDir} && chmod 700 ${remoteReactionsDataDir}`,
])
run("rsync", ["-az", "--delete", "-e", ssh.join(" "), `${publicDir}/`, `${host}:${remoteDir}/`])
run("rsync", [
  "-az",
  "--delete",
  "-e",
  ssh.join(" "),
  `${publicNotesDir}/`,
  `${host}:${remoteNotesDir}/`,
])
run("rsync", [
  "-az",
  "--delete",
  "-e",
  ssh.join(" "),
  `${reactionsDir}/`,
  `${host}:${remoteReactionsDir}/`,
])
run("rsync", ["-az", "-e", ssh.join(" "), nginxConfig, `${host}:${remoteAppDir}/nginx.conf`])
run("rsync", [
  "-az",
  "-e",
  ssh.join(" "),
  edgeCompose,
  `${host}:${remoteEdgeDir}/docker-compose.yml`,
])
run(ssh[0], [
  ...ssh.slice(1),
  host,
  `cd ${remoteEdgeDir} && docker compose config >/dev/null && docker compose up -d --wait reactions && docker compose run --rm --no-deps edge nginx -t`,
])
run(ssh[0], [
  ...ssh.slice(1),
  host,
  `cd ${remoteEdgeDir} && docker compose up -d --force-recreate edge`,
])

console.log(`Deployed blog, notes, reactions, and edge routing to ${host}.`)
