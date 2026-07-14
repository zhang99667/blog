import { visitorId } from "./visitorIdentity"

interface VisitorPayload {
  todayOrdinal: number
  totalVisitors: number
}

const apiPath = "/api/visitors"
const numberFormatter = new Intl.NumberFormat("zh-CN")

let activeRequest: Promise<VisitorPayload | undefined> | undefined

function countValue(value: unknown, minimum = 0): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? value
    : undefined
}

function normalizePayload(value: unknown): VisitorPayload | undefined {
  if (!value || typeof value !== "object") return
  const payload = value as Record<string, unknown>
  const todayOrdinal = countValue(payload.todayOrdinal, 1)
  const totalVisitors = countValue(payload.totalVisitors)
  if (todayOrdinal === undefined || totalVisitors === undefined || todayOrdinal > totalVisitors) {
    return
  }
  return { todayOrdinal, totalVisitors }
}

async function registerVisitor(): Promise<VisitorPayload | undefined> {
  try {
    const response = await fetch(apiPath, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitor: visitorId() }),
    })
    const payload = normalizePayload(await response.json())
    if (!response.ok || !payload) return
    return payload
  } catch {
    return
  }
}

function render(root: HTMLElement, payload: VisitorPayload) {
  const copy = root.querySelector<HTMLElement>("[data-blog-visitor-copy]")
  if (!copy) return

  const ordinal = numberFormatter.format(payload.todayOrdinal)
  const total = numberFormatter.format(payload.totalVisitors)
  copy.textContent = `今天您是第 ${ordinal} 位访客 · 累计 ${total} 位访客`
  root.setAttribute("aria-busy", "false")
  root.hidden = false
}

function mountVisitorCounter() {
  const root = document.querySelector<HTMLElement>("[data-blog-visitors]")
  if (!root) return

  root.hidden = true
  activeRequest ??= registerVisitor()
  void activeRequest.then((payload) => {
    if (!payload) return
    const currentRoot = document.querySelector<HTMLElement>("[data-blog-visitors]")
    if (currentRoot) render(currentRoot, payload)
  })
}

document.addEventListener("nav", mountVisitorCounter)
mountVisitorCounter()
