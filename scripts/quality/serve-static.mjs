import { createServer } from "node:http"
import path from "node:path"
import handler from "serve-handler"

const [rootArg, portArg] = process.argv.slice(2)
if (!rootArg || !portArg || !Number.isInteger(Number(portArg))) {
  console.error("Usage: node scripts/quality/serve-static.mjs <root> <port>")
  process.exit(1)
}

const publicDir = path.resolve(rootArg)
const port = Number(portArg)
const server = createServer((request, response) =>
  handler(request, response, { public: publicDir, cleanUrls: true }),
)

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${publicDir} at http://127.0.0.1:${port}`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
