const imageSelector = "article img:not([data-no-lightbox])"
const minimumScale = 1
const maximumScale = 4
const scaleStep = 0.5

let sourceImage: HTMLImageElement | null = null
let scale = minimumScale
let fittedWidth = 0
let fittedHeight = 0
let preferredWidth = 0
let preferredAspectRatio = 0
let restoreSourceFocus = true

interface LightboxElements {
  dialog: HTMLDialogElement
  viewport: HTMLElement
  canvas: HTMLElement
  preview: HTMLImageElement
  zoomOut: HTMLButtonElement
  reset: HTMLButtonElement
  zoomIn: HTMLButtonElement
  close: HTMLButtonElement
}

function getElements(): LightboxElements | undefined {
  const dialog = document.querySelector<HTMLDialogElement>("#image-lightbox")
  const viewport = dialog?.querySelector<HTMLElement>(".image-lightbox__viewport")
  const canvas = dialog?.querySelector<HTMLElement>(".image-lightbox__canvas")
  const preview = dialog?.querySelector<HTMLImageElement>(".image-lightbox__preview")
  const zoomOut = dialog?.querySelector<HTMLButtonElement>('[data-image-action="zoom-out"]')
  const reset = dialog?.querySelector<HTMLButtonElement>('[data-image-action="reset"]')
  const zoomIn = dialog?.querySelector<HTMLButtonElement>('[data-image-action="zoom-in"]')
  const close = dialog?.querySelector<HTMLButtonElement>('[data-image-action="close"]')

  if (!dialog || !viewport || !canvas || !preview || !zoomOut || !reset || !zoomIn || !close) {
    return
  }

  return { dialog, viewport, canvas, preview, zoomOut, reset, zoomIn, close }
}

function isEligibleImage(image: HTMLImageElement): boolean {
  if (!image.closest("article")) return false
  if (image.closest("a, button, [data-no-lightbox]")) return false
  if (
    image.closest(
      ".image-lightbox, .popover, .graph, .mermaid, .canvas-container, .excalidraw, .bases-view",
    )
  ) {
    return false
  }
  return Boolean(image.currentSrc || image.src)
}

function enhanceImages() {
  bindLightbox()

  for (const image of document.querySelectorAll<HTMLImageElement>(imageSelector)) {
    if (!isEligibleImage(image)) continue
    image.dataset.imageLightbox = ""
    image.tabIndex = 0
    image.setAttribute("role", "button")
    image.setAttribute("aria-haspopup", "dialog")
    image.setAttribute("aria-controls", "image-lightbox")
    const description = image.alt.trim()
    image.setAttribute("aria-label", description ? `查看大图：${description}` : "查看大图")
  }
}

function canvasGap(elements: LightboxElements): number {
  const value = getComputedStyle(elements.canvas).paddingRight
  return Number.parseFloat(value) || 16
}

function updateControls(elements: LightboxElements) {
  const percentage = `${Math.round(scale * 100)}%`
  elements.reset.textContent = percentage
  elements.reset.setAttribute("aria-label", `恢复适合屏幕，当前 ${percentage}`)
  elements.zoomOut.disabled = scale <= minimumScale
  elements.zoomIn.disabled = scale >= maximumScale
  elements.preview.dataset.zoomed = String(scale > minimumScale)
}

function centerPreview(elements: LightboxElements) {
  elements.viewport.scrollLeft = Math.max(
    0,
    (elements.canvas.scrollWidth - elements.viewport.clientWidth) / 2,
  )
  elements.viewport.scrollTop = Math.max(
    0,
    (elements.canvas.scrollHeight - elements.viewport.clientHeight) / 2,
  )
}

function renderScale(elements: LightboxElements, preserveCenter: boolean) {
  if (!fittedWidth || !fittedHeight) return

  const oldWidth = Math.max(elements.canvas.scrollWidth, 1)
  const oldHeight = Math.max(elements.canvas.scrollHeight, 1)
  const centerRatioX = (elements.viewport.scrollLeft + elements.viewport.clientWidth / 2) / oldWidth
  const centerRatioY =
    (elements.viewport.scrollTop + elements.viewport.clientHeight / 2) / oldHeight
  const gap = canvasGap(elements)
  const toolbarClearance = elements.close.offsetHeight + gap * 2
  const imageWidth = fittedWidth * scale
  const imageHeight = fittedHeight * scale

  elements.preview.style.width = `${imageWidth}px`
  elements.preview.style.height = `${imageHeight}px`
  elements.canvas.style.width = `${Math.max(elements.viewport.clientWidth, imageWidth + gap * 2)}px`
  elements.canvas.style.height = `${Math.max(
    elements.viewport.clientHeight,
    imageHeight + toolbarClearance + gap,
  )}px`
  updateControls(elements)

  requestAnimationFrame(() => {
    if (preserveCenter) {
      elements.viewport.scrollLeft = Math.max(
        0,
        centerRatioX * elements.canvas.scrollWidth - elements.viewport.clientWidth / 2,
      )
      elements.viewport.scrollTop = Math.max(
        0,
        centerRatioY * elements.canvas.scrollHeight - elements.viewport.clientHeight / 2,
      )
    } else {
      centerPreview(elements)
    }
  })
}

function fitPreview(elements: LightboxElements) {
  if (!elements.preview.naturalWidth || !elements.preview.naturalHeight) return

  const naturalAspectRatio = elements.preview.naturalWidth / elements.preview.naturalHeight
  const sourceWidth = Math.max(elements.preview.naturalWidth, preferredWidth)
  const sourceHeight = sourceWidth / (preferredAspectRatio || naturalAspectRatio)
  const gap = canvasGap(elements)
  const toolbarClearance = elements.close.offsetHeight + gap * 2
  const availableWidth = Math.max(1, elements.viewport.clientWidth - gap * 2)
  const availableHeight = Math.max(1, elements.viewport.clientHeight - toolbarClearance - gap)
  const fitScale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight, 1)

  fittedWidth = sourceWidth * fitScale
  fittedHeight = sourceHeight * fitScale
  scale = minimumScale
  renderScale(elements, false)
  elements.dialog.dataset.ready = "true"
}

function setScale(elements: LightboxElements, nextScale: number, preserveCenter = true) {
  scale = Math.min(maximumScale, Math.max(minimumScale, nextScale))
  renderScale(elements, preserveCenter)
}

function closeLightbox(restoreFocus = true) {
  const elements = getElements()
  if (!elements?.dialog.open) return
  restoreSourceFocus = restoreFocus
  elements.dialog.close()
}

function openLightbox(image: HTMLImageElement) {
  const elements = getElements()
  if (!elements) return

  sourceImage = image
  restoreSourceFocus = true
  scale = minimumScale
  fittedWidth = 0
  fittedHeight = 0
  const sourceBounds = image.getBoundingClientRect()
  const widthHint = Number.parseFloat(image.getAttribute("width") ?? "") || 0
  const heightHint = Number.parseFloat(image.getAttribute("height") ?? "") || 0
  preferredWidth = Math.max(image.naturalWidth, widthHint, sourceBounds.width)
  preferredAspectRatio =
    widthHint > 0 && heightHint > 0
      ? widthHint / heightHint
      : sourceBounds.width > 0 && sourceBounds.height > 0
        ? sourceBounds.width / sourceBounds.height
        : 0
  elements.dialog.dataset.ready = "false"
  elements.preview.alt = image.alt
  const source = image.currentSrc || image.src
  const pathname = new URL(source, window.location.href).pathname
  elements.preview.dataset.vector = String(pathname.toLowerCase().endsWith(".svg"))
  let loadHandled = false
  const fitLoadedPreview = async () => {
    if (loadHandled) return
    loadHandled = true
    await elements.preview.decode().catch(() => undefined)
    requestAnimationFrame(() => requestAnimationFrame(() => fitPreview(elements)))
  }
  elements.preview.onload = fitLoadedPreview
  elements.preview.onerror = () => closeLightbox()
  elements.preview.src = source

  if (!elements.dialog.open) elements.dialog.showModal()
  elements.close.focus({ preventScroll: true })

  if (elements.preview.complete && elements.preview.naturalWidth > 0) fitLoadedPreview()
}

function handleToolbarClick(event: Event, elements: LightboxElements) {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button")
  const action = button?.dataset.imageAction
  if (!action) return

  if (action === "zoom-out") setScale(elements, scale - scaleStep)
  if (action === "reset") setScale(elements, minimumScale, false)
  if (action === "zoom-in") setScale(elements, scale + scaleStep)
  if (action === "close") closeLightbox()
}

function bindLightbox() {
  const elements = getElements()
  if (!elements || "imageLightboxBound" in elements.dialog.dataset) return
  elements.dialog.dataset.imageLightboxBound = ""

  elements.dialog.addEventListener("close", () => {
    elements.dialog.dataset.ready = "false"
    elements.preview.onload = null
    elements.preview.onerror = null
    elements.preview.removeAttribute("src")
    elements.preview.style.removeProperty("width")
    elements.preview.style.removeProperty("height")
    elements.canvas.style.removeProperty("width")
    elements.canvas.style.removeProperty("height")
    preferredWidth = 0
    preferredAspectRatio = 0
    if (restoreSourceFocus && sourceImage?.isConnected) {
      sourceImage.focus({ preventScroll: true })
    }
    sourceImage = null
  })

  elements.viewport.addEventListener("click", (event) => {
    if (event.target === elements.viewport || event.target === elements.canvas) closeLightbox()
  })
  elements.preview.addEventListener("click", () => {
    setScale(elements, scale === minimumScale ? minimumScale + scaleStep : minimumScale, false)
  })
  elements.dialog.addEventListener("click", (event) => handleToolbarClick(event, elements))
}

document.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof HTMLImageElement) || !("imageLightbox" in target.dataset)) return
  event.preventDefault()
  openLightbox(target)
})

document.addEventListener("keydown", (event) => {
  const target = event.target
  if (target instanceof HTMLImageElement && "imageLightbox" in target.dataset) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      openLightbox(target)
    }
    return
  }

  const elements = getElements()
  if (!elements?.dialog.open) return
  if (event.key === "+" || event.key === "=" || event.key === "Add") {
    event.preventDefault()
    setScale(elements, scale + scaleStep)
  } else if (event.key === "-" || event.key === "Subtract") {
    event.preventDefault()
    setScale(elements, scale - scaleStep)
  } else if (event.key === "0") {
    event.preventDefault()
    setScale(elements, minimumScale, false)
  }
})

window.addEventListener("resize", () => {
  const elements = getElements()
  if (elements?.dialog.open) fitPreview(elements)
})

document.addEventListener("prenav", () => closeLightbox(false))
document.addEventListener("nav", enhanceImages)
enhanceImages()
