import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import path from "node:path"
import sirv from "sirv"
import { loadContentSecurityPolicy } from "./content-security-policy.mjs"

const [rootArg, portArg] = process.argv.slice(2)
if (!rootArg || !portArg || !Number.isInteger(Number(portArg))) {
  console.error("Usage: node scripts/quality/serve-static.mjs <root> <port>")
  process.exit(1)
}

const publicDir = path.resolve(rootArg)
const port = Number(portArg)
const { value: contentSecurityPolicy } = await loadContentSecurityPolicy()
const serveStatic = sirv(publicDir, {
  dev: true,
  etag: true,
  onNoMatch: async (request, response) => {
    try {
      const html = await readFile(path.join(publicDir, "404.html"))
      response.writeHead(404, {
        "Content-Length": html.byteLength,
        "Content-Type": "text/html; charset=utf-8",
      })
      response.end(request.method === "HEAD" ? undefined : html)
    } catch {
      response.statusCode = 404
      response.end()
    }
  },
})
const server = createServer((request, response) => {
  response.setHeader("Content-Security-Policy", contentSecurityPolicy)
  return serveStatic(request, response)
})

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${publicDir} at http://127.0.0.1:${port}`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
