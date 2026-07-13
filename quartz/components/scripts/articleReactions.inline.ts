type ReactionSite = "blog" | "notes"

interface PageIdentity {
  site: ReactionSite
  slug: string
  article: HTMLElement
}

interface ReactionPayload {
  count: number
  liked?: boolean
}

const visitorStorageKey = "markz.reactions.visitor.v1"
const apiPath = "/api/reactions"
const visitorPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let volatileVisitor: string | undefined
let activeController: AbortController | undefined
let activeRoot: HTMLElement | undefined

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The current page can still react once when storage is unavailable.
  }
}

function visitorId(): string {
  const stored = readStorage(visitorStorageKey)
  if (stored && visitorPattern.test(stored)) return stored
  if (!volatileVisitor) volatileVisitor = crypto.randomUUID()
  writeStorage(visitorStorageKey, volatileVisitor)
  return volatileVisitor
}

function pageIdentity(): PageIdentity | undefined {
  const page = document.querySelector<HTMLElement>(".page[data-frame]")
  const article = page?.querySelector<HTMLElement>("main.center > article.popover-hint")
  const slug = document.body.dataset.slug?.normalize("NFC")
  if (!page || !article || !slug || article.querySelector(".page-listing")) return

  const frame = page.dataset.frame
  if (frame === "blog" && slug.startsWith("blog/") && slug !== "blog/index") {
    return { site: "blog", slug, article }
  }
  if (frame === "default" && slug !== "index") {
    return { site: "notes", slug, article }
  }
}

function likedStorageKey({ site, slug }: PageIdentity): string {
  return `markz.reactions.liked.v1:${site}:${slug}`
}

function validPayload(value: unknown): value is ReactionPayload {
  if (!value || typeof value !== "object") return false
  const count = (value as { count?: unknown }).count
  return Number.isSafeInteger(count) && Number(count) >= 0
}

async function parseResponse(response: Response): Promise<ReactionPayload> {
  const value: unknown = await response.json()
  if (!response.ok || !validPayload(value)) throw new Error("Invalid reactions response")
  return value
}

function reactionUrl(identity: PageIdentity): URL {
  const url = new URL(apiPath, window.location.origin)
  url.searchParams.set("site", identity.site)
  url.searchParams.set("slug", identity.slug)
  return url
}

function createReactionRoot() {
  const root = document.createElement("div")
  root.className = "article-reaction"
  root.dataset.articleReaction = ""
  root.setAttribute("role", "group")
  root.setAttribute("aria-label", "文章点赞")
  root.setAttribute("aria-busy", "true")

  const button = document.createElement("button")
  button.className = "article-reaction__button"
  button.type = "button"
  button.disabled = true
  button.dataset.state = "loading"
  button.setAttribute("aria-pressed", "false")
  button.setAttribute("aria-label", "正在读取点赞数")

  const label = document.createElement("span")
  label.dataset.reactionLabel = ""
  label.textContent = "赞"
  const separator = document.createElement("span")
  separator.className = "article-reaction__separator"
  separator.setAttribute("aria-hidden", "true")
  separator.textContent = "·"
  const count = document.createElement("span")
  count.dataset.reactionCount = ""
  count.textContent = "--"

  const message = document.createElement("span")
  message.className = "article-reaction__message"
  message.dataset.reactionMessage = ""
  message.setAttribute("role", "status")
  message.setAttribute("aria-live", "polite")

  button.append(label, separator, count)
  root.append(button, message)
  return { root, button, label, count, message }
}

function unmountReactions() {
  activeController?.abort()
  activeController = undefined
  activeRoot?.remove()
  activeRoot = undefined
}

function mountReactions() {
  unmountReactions()
  const identity = pageIdentity()
  if (!identity) return

  const controller = new AbortController()
  const elements = createReactionRoot()
  const likedKey = likedStorageKey(identity)
  activeController = controller
  activeRoot = elements.root
  identity.article.insertAdjacentElement("afterend", elements.root)

  const render = (count: number, liked: boolean) => {
    elements.root.setAttribute("aria-busy", "false")
    elements.button.disabled = false
    elements.button.dataset.state = liked ? "liked" : "ready"
    elements.button.setAttribute("aria-pressed", String(liked))
    elements.button.setAttribute("aria-disabled", String(liked))
    elements.button.setAttribute(
      "aria-label",
      liked ? `已点赞，当前 ${count} 个赞` : `点赞，当前 ${count} 个赞`,
    )
    elements.label.textContent = liked ? "已赞" : "赞"
    elements.count.textContent = String(count)
  }

  const load = async () => {
    try {
      const response = await fetch(reactionUrl(identity), {
        cache: "no-store",
        signal: controller.signal,
      })
      const payload = await parseResponse(response)
      if (controller.signal.aborted) return
      render(payload.count, readStorage(likedKey) === "1")
    } catch {
      if (controller.signal.aborted) return
      elements.root.setAttribute("aria-busy", "false")
      elements.button.disabled = true
      elements.button.dataset.state = "unavailable"
      elements.button.setAttribute("aria-disabled", "true")
      elements.button.setAttribute("aria-label", "点赞暂不可用")
      elements.message.textContent = "暂不可用"
    }
  }

  elements.button.addEventListener(
    "click",
    async () => {
      if (elements.button.dataset.state === "liked") {
        elements.message.textContent = "已经赞过了"
        return
      }

      elements.root.setAttribute("aria-busy", "true")
      elements.button.disabled = true
      elements.button.dataset.state = "loading"
      elements.message.textContent = ""
      try {
        const response = await fetch(apiPath, {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            site: identity.site,
            slug: identity.slug,
            visitor: visitorId(),
          }),
          signal: controller.signal,
        })
        const payload = await parseResponse(response)
        if (controller.signal.aborted) return
        writeStorage(likedKey, "1")
        render(payload.count, true)
        elements.message.textContent = "谢谢"
      } catch {
        if (controller.signal.aborted) return
        elements.root.setAttribute("aria-busy", "false")
        elements.button.disabled = false
        elements.button.dataset.state = "ready"
        elements.message.textContent = "暂时没点上"
      }
    },
    { signal: controller.signal },
  )

  void load()
}

document.addEventListener("prenav", unmountReactions)
document.addEventListener("nav", mountReactions)
mountReactions()
