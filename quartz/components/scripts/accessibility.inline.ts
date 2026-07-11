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

function enhanceComponentAccessibility() {
  enhanceExplorerAccessibility()
  enhanceTableOfContentsAccessibility()
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
  preserveInitialDocumentPosition = !location.hash && window.scrollY <= 1
  enhanceComponentAccessibility()
})
enhanceComponentAccessibility()
