function syncExplorerAria(explorer: Element) {
  const content = explorer.querySelector<HTMLElement>(".explorer-content")
  const expanded = !explorer.classList.contains("collapsed")

  explorer.removeAttribute("aria-expanded")
  content?.removeAttribute("aria-expanded")

  for (const toggle of explorer.querySelectorAll<HTMLElement>(".explorer-toggle")) {
    const nextExpanded = String(expanded)
    if (toggle.getAttribute("aria-expanded") !== nextExpanded) {
      toggle.setAttribute("aria-expanded", nextExpanded)
    }
    if (content?.id && toggle.getAttribute("aria-controls") !== content.id) {
      toggle.setAttribute("aria-controls", content.id)
    }
  }
}

function enhanceExplorerAccessibility() {
  for (const explorer of document.querySelectorAll(".explorer")) {
    syncExplorerAria(explorer)
  }
}

function enhanceTableOfContentsAccessibility() {
  for (const toc of document.querySelectorAll(".toc")) {
    const button = toc.querySelector<HTMLElement>(".toc-header")
    const content = toc.querySelector<HTMLElement>(".toc-content")
    if (!button || !content?.id) continue
    if (button.getAttribute("aria-controls") !== content.id) {
      button.setAttribute("aria-controls", content.id)
    }
  }
}

let activeTocHeading: string | undefined
let tocFollowFrame = 0
let tocFollowInitialized = false
let tocResizeObserver: ResizeObserver | undefined

function tocHeadings() {
  const article = document.querySelector<HTMLElement>("main.center > article.popover-hint")
  if (!article) return []
  return Array.from(
    article.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]"),
  )
}

function tocLinks() {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>(".toc a[data-for]"))
}

function alignCurrentTocLink(link: HTMLAnchorElement, list: HTMLElement, smooth: boolean) {
  if (list.classList.contains("collapsed")) return
  const listBounds = list.getBoundingClientRect()
  const linkBounds = link.getBoundingClientRect()
  const isVisible = linkBounds.top >= listBounds.top && linkBounds.bottom <= listBounds.bottom
  if (!smooth && isVisible) return

  const targetTop = link.offsetTop - (list.clientHeight - link.offsetHeight) / 2
  const maxTop = Math.max(0, list.scrollHeight - list.clientHeight)
  list.scrollTo({
    top: Math.max(0, Math.min(targetTop, maxTop)),
    behavior:
      smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto",
  })
}

function setCurrentTocHeading(heading: HTMLElement | undefined) {
  const nextHeading = heading?.id
  if (activeTocHeading === nextHeading) {
    if (nextHeading !== undefined) {
      const currentLink = tocLinks().find((link) => link.dataset.for === nextHeading)
      const list = currentLink?.closest<HTMLElement>(".toc-content")
      if (currentLink && list) alignCurrentTocLink(currentLink, list, false)
    }
    return
  }
  const shouldCenter = tocFollowInitialized && nextHeading !== undefined
  activeTocHeading = nextHeading
  tocFollowInitialized = nextHeading !== undefined

  for (const link of tocLinks()) {
    const isCurrent = link.dataset.for === nextHeading
    link.classList.toggle("is-current", isCurrent)
    if (isCurrent) {
      link.setAttribute("aria-current", "location")
      const list = link.closest<HTMLElement>(".toc-content")
      if (list) alignCurrentTocLink(link, list, shouldCenter)
    } else {
      link.removeAttribute("aria-current")
    }
  }
}

function updateCurrentTocHeading() {
  const headings = tocHeadings()
  if (headings.length === 0) {
    setCurrentTocHeading(undefined)
    return
  }

  const readingLine = Math.max(96, Math.min(window.innerHeight * 0.35, 280))
  let current = headings[0]
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top <= readingLine) current = heading
    else break
  }
  setCurrentTocHeading(current)
}

function scheduleCurrentTocHeading() {
  if (tocFollowFrame !== 0) return
  tocFollowFrame = window.requestAnimationFrame(() => {
    tocFollowFrame = 0
    updateCurrentTocHeading()
  })
}

function resetCurrentTocHeading() {
  activeTocHeading = undefined
  tocFollowInitialized = false
  tocResizeObserver?.disconnect()
  tocResizeObserver = undefined
  if (tocFollowFrame !== 0) {
    window.cancelAnimationFrame(tocFollowFrame)
    tocFollowFrame = 0
  }
}

function enhanceComponentAccessibility() {
  enhanceExplorerAccessibility()
  enhanceTableOfContentsAccessibility()
  tocResizeObserver?.disconnect()
  tocResizeObserver = new ResizeObserver(scheduleCurrentTocHeading)
  for (const list of document.querySelectorAll<HTMLElement>(".toc-content")) {
    tocResizeObserver.observe(list)
  }
  scheduleCurrentTocHeading()
}

let preserveInitialDocumentPosition = !location.hash && window.scrollY <= 1

function restoreDocumentPositionAfterExplorerRender(explorer: Element) {
  if (!preserveInitialDocumentPosition || !explorer.querySelector("a.active")) return
  window.scrollTo(0, 0)
  preserveInitialDocumentPosition = false
}

const explorerObserver = new MutationObserver((records) => {
  const explorers = new Set<Element>()
  for (const record of records) {
    const target = record.target
    if (!(target instanceof Element)) continue
    const explorer = target.matches(".explorer") ? target : target.closest(".explorer")
    if (explorer) explorers.add(explorer)
  }
  for (const explorer of explorers) {
    syncExplorerAria(explorer)
    restoreDocumentPositionAfterExplorerRender(explorer)
  }
})

explorerObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ["aria-expanded", "class"],
  childList: true,
  subtree: true,
})
document.addEventListener("nav", () => {
  resetCurrentTocHeading()
  preserveInitialDocumentPosition = !location.hash && window.scrollY <= 1
  enhanceComponentAccessibility()
})
enhanceComponentAccessibility()
window.addEventListener("scroll", scheduleCurrentTocHeading, { passive: true })
window.addEventListener("resize", scheduleCurrentTocHeading, { passive: true })
window.addEventListener("pageshow", scheduleCurrentTocHeading)
