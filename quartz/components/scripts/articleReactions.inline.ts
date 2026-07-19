import { ArrowUp, Eye, ThumbsUp, type IconNode } from "lucide"
import { readVisitorStorage, visitorId, writeVisitorStorage } from "./visitorIdentity"

type ReactionSite = "blog" | "notes"

interface PageIdentity {
  site: ReactionSite
  slug: string
  article: HTMLElement
}

interface ReactionPayload {
  likes: number
  views?: number
  liked?: boolean
}

const apiPath = "/api/reactions"
const viewApiPath = "/api/reactions/view"

let activeController: AbortController | undefined
let activeRoot: HTMLElement | undefined
let activePageKey: string | undefined

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

function countValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function normalizePayload(value: unknown): ReactionPayload | undefined {
  if (!value || typeof value !== "object") return
  const payload = value as { count?: unknown; likes?: unknown; views?: unknown; liked?: unknown }
  const likes = countValue(payload.likes) ?? countValue(payload.count)
  const views = payload.views === undefined ? undefined : countValue(payload.views)
  if (likes === undefined || (payload.views !== undefined && views === undefined)) return
  const liked = typeof payload.liked === "boolean" ? payload.liked : undefined
  return { likes, views, liked }
}

async function parseResponse(response: Response): Promise<ReactionPayload> {
  const value: unknown = await response.json()
  const payload = normalizePayload(value)
  if (!response.ok || !payload) throw new Error("Invalid reactions response")
  return payload
}

function reactionUrl(identity: PageIdentity): URL {
  const url = new URL(apiPath, window.location.origin)
  url.searchParams.set("site", identity.site)
  url.searchParams.set("slug", identity.slug)
  return url
}

function icon(name: "arrow-up" | "eye" | "thumbs-up", node: IconNode) {
  const namespace = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(namespace, "svg")
  const attributes = {
    class: "article-reaction__icon",
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "data-lucide": name,
    "aria-hidden": "true",
    focusable: "false",
  }
  for (const [attribute, value] of Object.entries(attributes)) {
    svg.setAttribute(attribute, value)
  }
  for (const [tag, childAttributes] of node) {
    const child = document.createElementNS(namespace, tag)
    for (const [attribute, value] of Object.entries(childAttributes)) {
      child.setAttribute(attribute, String(value))
    }
    svg.append(child)
  }
  return svg
}

function createReactionRoot() {
  const root = document.createElement("div")
  root.className = "article-reaction"
  root.dataset.articleReaction = ""
  root.setAttribute("role", "group")
  root.setAttribute("aria-label", "文章阅读工具")
  root.setAttribute("aria-busy", "true")

  const scrollTop = document.createElement("button")
  scrollTop.className = "article-reaction__scroll-top"
  scrollTop.type = "button"
  scrollTop.hidden = true
  scrollTop.tabIndex = -1
  scrollTop.dataset.scrollToTop = ""
  scrollTop.title = "回到顶部"
  scrollTop.setAttribute("aria-label", "回到文章顶部")
  scrollTop.setAttribute("aria-hidden", "true")
  scrollTop.append(icon("arrow-up", ArrowUp))

  const panel = document.createElement("div")
  panel.className = "article-reaction__panel"
  panel.dataset.reactionPanel = ""
  panel.setAttribute("role", "group")
  panel.setAttribute("aria-label", "文章数据")

  const views = document.createElement("span")
  views.className = "article-reaction__metric"
  views.dataset.reactionViews = ""
  views.title = "浏览量"
  views.setAttribute("aria-label", "正在读取浏览量")
  const viewCount = document.createElement("span")
  viewCount.className = "article-reaction__count"
  viewCount.dataset.viewCount = ""
  viewCount.textContent = "--"
  views.append(icon("eye", Eye), viewCount)

  const button = document.createElement("button")
  button.className = "article-reaction__button"
  button.type = "button"
  button.disabled = true
  button.dataset.state = "loading"
  button.dataset.reactionLike = ""
  button.title = "点赞"
  button.setAttribute("aria-pressed", "false")
  button.setAttribute("aria-label", "正在读取点赞数")
  const likeCount = document.createElement("span")
  likeCount.className = "article-reaction__count"
  likeCount.dataset.reactionCount = ""
  likeCount.textContent = "--"
  button.append(icon("thumbs-up", ThumbsUp), likeCount)

  const status = document.createElement("span")
  status.className = "article-reaction__status"
  status.dataset.reactionStatus = ""
  status.setAttribute("role", "status")
  status.setAttribute("aria-live", "polite")

  panel.append(views, button)
  root.append(scrollTop, panel, status)
  return { root, scrollTop, views, viewCount, button, likeCount, status }
}

function positionReaction(root: HTMLElement, article: HTMLElement) {
  root.style.removeProperty("left")
  root.style.removeProperty("right")
  root.style.removeProperty("top")
  root.style.removeProperty("bottom")

  const edge = Number.parseFloat(getComputedStyle(root).right)
  const safeEdge = Number.isFinite(edge) ? edge : 16
  const articleBounds = article.getBoundingClientRect()
  const reactionBounds = root.getBoundingClientRect()
  const preferredStartLeft = articleBounds.left - reactionBounds.width - safeEdge
  const preferredLeft = articleBounds.right + safeEdge
  const viewportLeft = window.innerWidth - reactionBounds.width - safeEdge
  const readingRail = document.querySelector<HTMLElement>(".blog-article-toc")
  const hasSideReadingRail = readingRail && getComputedStyle(readingRail).position === "sticky"
  const anchorsToArticleEnd = !hasSideReadingRail && preferredLeft <= viewportLeft

  if (hasSideReadingRail) {
    const centeredTop = Math.max(safeEdge, (window.innerHeight - reactionBounds.height) / 2)
    root.style.left = `${Math.max(safeEdge, preferredStartLeft)}px`
    root.style.right = "auto"
    root.style.top = `${centeredTop}px`
    root.style.bottom = "auto"
    root.dataset.anchor = "article"
    root.dataset.side = "start"
    return
  }

  const left = Math.max(safeEdge, anchorsToArticleEnd ? preferredLeft : viewportLeft)

  root.style.left = `${left}px`
  root.style.right = "auto"
  root.dataset.anchor = anchorsToArticleEnd ? "article" : "viewport"
  root.dataset.side = "end"
}

function trackReactionPosition(root: HTMLElement, article: HTMLElement, signal: AbortSignal) {
  let frame = 0
  const schedule = () => {
    if (frame !== 0) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      positionReaction(root, article)
    })
  }
  const observer = new ResizeObserver(schedule)
  observer.observe(root)
  observer.observe(article)
  window.addEventListener("resize", schedule, { signal })
  signal.addEventListener(
    "abort",
    () => {
      observer.disconnect()
      if (frame !== 0) window.cancelAnimationFrame(frame)
    },
    { once: true },
  )
  positionReaction(root, article)
}

function setScrollTopVisibility(button: HTMLButtonElement, visible: boolean) {
  button.hidden = !visible
  button.tabIndex = visible ? 0 : -1
  button.setAttribute("aria-hidden", String(!visible))
}

function updateScrollTop(button: HTMLButtonElement, article: HTMLElement) {
  const threshold = Math.max(360, Math.min(640, window.innerHeight * 0.65))
  const articleTop = window.scrollY + article.getBoundingClientRect().top
  const isLongArticle = article.scrollHeight - window.innerHeight >= threshold
  setScrollTopVisibility(button, isLongArticle && window.scrollY >= articleTop + threshold)
}

function trackScrollTop(button: HTMLButtonElement, article: HTMLElement, signal: AbortSignal) {
  let frame = 0
  const schedule = () => {
    if (frame !== 0) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      updateScrollTop(button, article)
    })
  }
  const observer = new ResizeObserver(schedule)
  observer.observe(article)
  window.addEventListener("scroll", schedule, { passive: true, signal })
  window.addEventListener("resize", schedule, { signal })
  signal.addEventListener(
    "abort",
    () => {
      observer.disconnect()
      if (frame !== 0) window.cancelAnimationFrame(frame)
    },
    { once: true },
  )
  updateScrollTop(button, article)
}

function focusReadingStart(article: HTMLElement) {
  const main = article.closest<HTMLElement>("main.center")
  if (!main) return

  const hadTabIndex = main.hasAttribute("tabindex")
  if (!hadTabIndex) main.tabIndex = -1
  main.focus({ preventScroll: true })
  if (!hadTabIndex) {
    main.addEventListener("blur", () => main.removeAttribute("tabindex"), { once: true })
  }
}

function unmountReactions() {
  activeController?.abort()
  activeController = undefined
  activeRoot?.remove()
  activeRoot = undefined
  activePageKey = undefined
}

function mountReactions() {
  const identity = pageIdentity()
  const pageKey = identity ? `${identity.site}:${identity.slug}` : undefined
  if (pageKey && pageKey === activePageKey && activeRoot?.isConnected) return
  unmountReactions()
  if (!identity) return

  const controller = new AbortController()
  const elements = createReactionRoot()
  const likedKey = likedStorageKey(identity)
  let currentViews = 0
  activeController = controller
  activeRoot = elements.root
  activePageKey = pageKey
  identity.article.insertAdjacentElement("afterend", elements.root)
  trackReactionPosition(elements.root, identity.article, controller.signal)
  trackScrollTop(elements.scrollTop, identity.article, controller.signal)

  elements.scrollTop.addEventListener(
    "click",
    () => {
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      })
      focusReadingStart(identity.article)
    },
    { signal: controller.signal },
  )

  const render = (likes: number, views: number | undefined, liked: boolean) => {
    if (views !== undefined) currentViews = views
    elements.root.setAttribute("aria-busy", "false")
    elements.views.setAttribute("aria-label", `${currentViews} 次浏览`)
    elements.viewCount.textContent = String(currentViews)
    elements.button.disabled = false
    elements.button.dataset.state = liked ? "liked" : "ready"
    elements.button.title = liked ? "已点赞" : "点赞"
    elements.button.setAttribute("aria-pressed", String(liked))
    elements.button.setAttribute("aria-disabled", String(liked))
    elements.button.setAttribute(
      "aria-label",
      liked ? `已点赞，当前 ${likes} 个赞` : `点赞，当前 ${likes} 个赞`,
    )
    elements.likeCount.textContent = String(likes)
  }

  const requestBody = () =>
    JSON.stringify({ site: identity.site, slug: identity.slug, visitor: visitorId() })

  const load = async () => {
    let payload: ReactionPayload
    try {
      const response = await fetch(viewApiPath, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: requestBody(),
        signal: controller.signal,
      })
      payload = await parseResponse(response)
    } catch {
      if (controller.signal.aborted) return
      try {
        const response = await fetch(reactionUrl(identity), {
          cache: "no-store",
          signal: controller.signal,
        })
        payload = await parseResponse(response)
      } catch {
        if (controller.signal.aborted) return
        elements.root.setAttribute("aria-busy", "false")
        elements.views.setAttribute("aria-label", "浏览量暂不可用")
        elements.button.disabled = true
        elements.button.dataset.state = "unavailable"
        elements.button.setAttribute("aria-disabled", "true")
        elements.button.setAttribute("aria-label", "点赞暂不可用")
        elements.status.textContent = "文章数据暂不可用"
        return
      }
    }

    if (controller.signal.aborted) return
    render(payload.likes, payload.views, payload.liked ?? readVisitorStorage(likedKey) === "1")
  }

  elements.button.addEventListener(
    "click",
    async () => {
      if (elements.button.dataset.state === "liked") {
        elements.status.textContent = "已经点过赞"
        return
      }

      elements.root.setAttribute("aria-busy", "true")
      elements.button.disabled = true
      elements.button.dataset.state = "loading"
      elements.status.textContent = ""
      try {
        const response = await fetch(apiPath, {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: requestBody(),
          signal: controller.signal,
        })
        const payload = await parseResponse(response)
        if (controller.signal.aborted) return
        writeVisitorStorage(likedKey, "1")
        render(payload.likes, payload.views, true)
        elements.status.textContent = "点赞成功"
      } catch {
        if (controller.signal.aborted) return
        elements.root.setAttribute("aria-busy", "false")
        elements.button.disabled = false
        elements.button.dataset.state = "ready"
        elements.status.textContent = "点赞失败，请稍后重试"
      }
    },
    { signal: controller.signal },
  )

  void load()
}

document.addEventListener("prenav", unmountReactions)
document.addEventListener("nav", mountReactions)
mountReactions()
