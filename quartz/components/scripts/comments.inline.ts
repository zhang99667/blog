const giscusOrigin = "https://giscus.app"
const giscusSessionKey = "giscus-session"

type GiscusContainer = Omit<HTMLElement, "dataset"> & {
  dataset: DOMStringMap & {
    repo: string
    repoId: string
    category: string
    categoryId: string
    themeUrl: string
    lightTheme: string
    darkTheme: string
    mapping: string
    strict: string
    reactionsEnabled: string
    inputPosition: string
    lang: string
  }
}

let activeController: AbortController | undefined
let activeContainer: GiscusContainer | undefined
let activeFrame: HTMLIFrameElement | undefined
let activePageKey: string | undefined

function storedSession(): string {
  try {
    const saved = localStorage.getItem(giscusSessionKey)
    if (!saved) return ""
    const parsed: unknown = JSON.parse(saved)
    if (typeof parsed === "string") return parsed
    localStorage.removeItem(giscusSessionKey)
  } catch {
    try {
      localStorage.removeItem(giscusSessionKey)
    } catch {
      // Storage may be unavailable; comments remain usable without a saved session.
    }
  }
  return ""
}

function removeStoredSession() {
  try {
    localStorage.removeItem(giscusSessionKey)
  } catch {
    // Storage is an optional enhancement.
  }
}

function sessionAndCleanLocation(): { cleanedLocation: string; session: string } {
  const url = new URL(location.href)
  const hasCallback = url.searchParams.has("giscus")
  let session = url.searchParams.get("giscus") ?? ""
  url.searchParams.delete("giscus")
  url.hash = ""
  const cleanedLocation = url.toString()

  if (hasCallback) {
    if (session) {
      try {
        localStorage.setItem(giscusSessionKey, JSON.stringify(session))
      } catch {
        // The current callback can still authenticate this iframe.
      }
    }
    history.replaceState(history.state, document.title, cleanedLocation)
  } else {
    session = storedSession()
  }

  return { cleanedLocation, session }
}

function metaContent(name: string, openGraph = false): string {
  const selector = openGraph
    ? `meta[property="og:${name}"], meta[name="${name}"]`
    : `meta[name="${name}"]`
  return document.querySelector<HTMLMetaElement>(selector)?.content ?? ""
}

function currentTheme(): string {
  return document.documentElement.getAttribute("saved-theme") === "dark" ? "dark" : "light"
}

function themeName(container: GiscusContainer, theme: string): string {
  return theme === "dark" ? container.dataset.darkTheme : container.dataset.lightTheme
}

function themeUrl(container: GiscusContainer, theme: string): string {
  const base = container.dataset.themeUrl.replace(/\/$/, "")
  return `${base}/${themeName(container, theme)}.css`
}

function pathnameTerm(): string {
  return location.pathname.length < 2
    ? "index"
    : location.pathname.substring(1).replace(/\.\w+$/, "")
}

function iframeSource(
  container: GiscusContainer,
  cleanedLocation: string,
  session: string,
): string {
  const section = container.closest<HTMLElement>("[data-article-comments]")
  const origin = section?.id ? `${cleanedLocation}#${section.id}` : cleanedLocation
  const params = new URLSearchParams({
    origin,
    session,
    theme: themeUrl(container, currentTheme()),
    reactionsEnabled: container.dataset.reactionsEnabled || "0",
    emitMetadata: "0",
    inputPosition: container.dataset.inputPosition || "bottom",
    repo: container.dataset.repo,
    repoId: container.dataset.repoId,
    category: container.dataset.category,
    categoryId: container.dataset.categoryId,
    strict: container.dataset.strict || "1",
    description: metaContent("description", true),
    backLink: metaContent("giscus:backlink") || cleanedLocation,
    term: pathnameTerm(),
  })
  const locale = container.dataset.lang ? `/${encodeURIComponent(container.dataset.lang)}` : ""
  return `${giscusOrigin}${locale}/widget?${params}`
}

function createFrame(src: string): HTMLIFrameElement {
  const frame = document.createElement("iframe")
  frame.className = "giscus-frame giscus-frame--loading"
  frame.title = "评论"
  frame.scrolling = "no"
  frame.allow = "clipboard-write"
  frame.loading = "lazy"
  frame.src = src
  return frame
}

function updateTheme(container: GiscusContainer, frame: HTMLIFrameElement, theme: string) {
  frame.contentWindow?.postMessage(
    {
      giscus: {
        setConfig: {
          theme: themeUrl(container, theme),
        },
      },
    },
    giscusOrigin,
  )
}

function unmountComments() {
  activeController?.abort()
  activeController = undefined
  activeFrame?.remove()
  activeContainer?.removeAttribute("aria-busy")
  activeContainer = undefined
  activeFrame = undefined
  activePageKey = undefined
}

function mountComments() {
  const container = document.querySelector<GiscusContainer>("[data-article-comments] .giscus")
  if (!container) {
    unmountComments()
    return
  }

  const { cleanedLocation, session } = sessionAndCleanLocation()
  const pageKey = `${location.pathname}:${container.dataset.repo}:${container.dataset.categoryId}`
  if (pageKey === activePageKey && container === activeContainer && activeFrame?.isConnected) {
    return
  }

  unmountComments()
  const controller = new AbortController()
  const frame = createFrame(iframeSource(container, cleanedLocation, session))
  activeController = controller
  activeContainer = container
  activeFrame = frame
  activePageKey = pageKey
  container.setAttribute("aria-busy", "true")
  container.replaceChildren(frame)

  frame.addEventListener(
    "load",
    () => {
      frame.classList.remove("giscus-frame--loading")
      container.setAttribute("aria-busy", "false")
    },
    { once: true, signal: controller.signal },
  )

  document.addEventListener(
    "themechange",
    (event) => {
      const detail = (event as CustomEvent<{ theme?: string }>).detail
      updateTheme(container, frame, detail?.theme === "dark" ? "dark" : "light")
    },
    { signal: controller.signal },
  )

  window.addEventListener(
    "message",
    (event) => {
      if (event.origin !== giscusOrigin || event.source !== frame.contentWindow) return
      const data = event.data as
        | { giscus?: { resizeHeight?: unknown; signOut?: unknown; error?: unknown } }
        | undefined
      if (!data || typeof data !== "object" || !data.giscus) return

      const height = Number(data.giscus.resizeHeight)
      if (Number.isFinite(height) && height > 0) frame.style.height = `${Math.ceil(height)}px`

      if (data.giscus.signOut) {
        removeStoredSession()
        const src = new URL(frame.src)
        src.searchParams.delete("session")
        frame.src = src.toString()
        return
      }

      if (typeof data.giscus.error !== "string") return
      if (
        data.giscus.error.includes("Bad credentials") ||
        data.giscus.error.includes("Invalid state value") ||
        data.giscus.error.includes("State has expired")
      ) {
        removeStoredSession()
        const src = new URL(frame.src)
        src.searchParams.delete("session")
        frame.src = src.toString()
      }
    },
    { signal: controller.signal },
  )
}

document.addEventListener("prenav", unmountComments)
document.addEventListener("nav", mountComments)
document.addEventListener("render", mountComments)
mountComments()
