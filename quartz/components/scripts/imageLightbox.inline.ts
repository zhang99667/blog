import type PhotoSwipe from "photoswipe"
import type { SlideData } from "photoswipe"
import { photoSwipeAssetPath } from "../imageLightboxAssets"

const imageSelector = "article img:not([data-no-lightbox])"

type PhotoSwipeConstructor = typeof PhotoSwipe
type PhotoSwipeInstance = InstanceType<PhotoSwipeConstructor>

let activePhotoSwipe: PhotoSwipeInstance | undefined
let photoSwipeConstructor: Promise<PhotoSwipeConstructor> | undefined
let openRequest = 0

function loadPhotoSwipe(): Promise<PhotoSwipeConstructor> {
  if (!photoSwipeConstructor) {
    const basePath = document.body.dataset.basepath ?? ""
    const assetUrl = new URL(`${basePath}/${photoSwipeAssetPath}`, window.location.origin).href
    photoSwipeConstructor = import(assetUrl)
      .then((module) => (module as { default: PhotoSwipeConstructor }).default)
      .catch((error) => {
        photoSwipeConstructor = undefined
        throw error
      })
  }
  return photoSwipeConstructor
}

function isEligibleImage(image: HTMLImageElement): boolean {
  if (!image.closest("article")) return false
  if (image.closest("a, button, [data-no-lightbox]")) return false
  if (
    image.closest(".pswp, .popover, .graph, .mermaid, .canvas-container, .excalidraw, .bases-view")
  ) {
    return false
  }
  return Boolean(image.currentSrc || image.src)
}

function articleImages(article: HTMLElement): HTMLImageElement[] {
  return [...article.querySelectorAll<HTMLImageElement>(imageSelector)].filter(isEligibleImage)
}

function enhanceImages() {
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

function cssNumericValue(property: string, fallback: number): number {
  const rootStyle = getComputedStyle(document.documentElement)
  const value = rootStyle.getPropertyValue(property).trim()
  const numericValue = Number.parseFloat(value)
  if (!Number.isFinite(numericValue)) return fallback
  if (value.endsWith("rem")) {
    return numericValue * (Number.parseFloat(rootStyle.fontSize) || 16)
  }
  return numericValue
}

function imageDimensions(image: HTMLImageElement) {
  const bounds = image.getBoundingClientRect()
  const widthHint = Number.parseFloat(image.getAttribute("width") ?? "") || 0
  const heightHint = Number.parseFloat(image.getAttribute("height") ?? "") || 0
  const aspectRatio =
    widthHint > 0 && heightHint > 0
      ? widthHint / heightHint
      : image.naturalWidth > 0 && image.naturalHeight > 0
        ? image.naturalWidth / image.naturalHeight
        : bounds.width > 0 && bounds.height > 0
          ? bounds.width / bounds.height
          : 1
  const width = Math.max(image.naturalWidth, widthHint, bounds.width, 1)

  return {
    width: Math.round(width),
    height: Math.max(1, Math.round(width / aspectRatio)),
  }
}

function toSlideData(image: HTMLImageElement): SlideData {
  const source = image.currentSrc || image.src
  const { width, height } = imageDimensions(image)
  const isVector = new URL(source, window.location.href).pathname.toLowerCase().endsWith(".svg")

  return {
    src: source,
    srcset: image.srcset || undefined,
    width,
    height,
    alt: image.alt,
    element: image,
    isVector,
  }
}

async function openLightbox(image: HTMLImageElement) {
  const request = ++openRequest
  const constructorPromise = loadPhotoSwipe()

  if (!image.complete || image.naturalWidth === 0) {
    await image.decode().catch(() => undefined)
  }

  const article = image.closest<HTMLElement>("article")
  if (!article || !image.isConnected) return

  const images = articleImages(article)
  const index = images.indexOf(image)
  if (index < 0) return

  const PhotoSwipeConstructor = await constructorPromise
  if (request !== openRequest || !image.isConnected) return

  activePhotoSwipe?.destroy()
  image.focus({ preventScroll: true })

  const gap = cssNumericValue("--brand-space-4", 16)
  const controlTarget = cssNumericValue("--brand-target-comfortable", 44)
  const motionDuration = cssNumericValue("--brand-motion-fast", 160)
  const photoSwipe = new PhotoSwipeConstructor({
    dataSource: images.map(toSlideData),
    index,
    mainClass: "markz-image-lightbox",
    bgOpacity: 0.9,
    padding: {
      top: controlTarget + gap * 2,
      right: gap,
      bottom: gap,
      left: gap,
    },
    loop: false,
    wheelToZoom: true,
    clickToCloseNonZoomable: false,
    secondaryZoomLevel: ({ fit }) => Math.min(2, Math.max(1, fit * 2)),
    imageClickAction: "zoom",
    bgClickAction: "close",
    tapAction: "toggle-controls",
    doubleTapAction: "zoom",
    trapFocus: true,
    returnFocus: true,
    showHideAnimationType: "fade",
    showAnimationDuration: 0,
    hideAnimationDuration: motionDuration,
    zoomAnimationDuration: motionDuration,
    indexIndicatorSep: " / ",
    closeTitle: "关闭图片预览",
    zoomTitle: "缩放图片",
    arrowPrevTitle: "上一张图片",
    arrowNextTitle: "下一张图片",
    errorMsg: "图片无法加载",
  })

  activePhotoSwipe = photoSwipe
  photoSwipe.on("contentAppendImage", ({ content }) => {
    if (content.data.isVector && content.element instanceof HTMLImageElement) {
      content.element.dataset.vector = "true"
    }
  })
  photoSwipe.on("afterInit", () => {
    photoSwipe.element?.setAttribute("id", "image-lightbox")
    photoSwipe.element?.setAttribute("aria-label", "图片预览")
  })
  photoSwipe.on("destroy", () => {
    if (activePhotoSwipe === photoSwipe) activePhotoSwipe = undefined
  })
  photoSwipe.init()
}

function requestLightbox(image: HTMLImageElement) {
  void openLightbox(image).catch((error) => {
    console.error("Unable to open image preview", error)
  })
}

document.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof HTMLImageElement) || !("imageLightbox" in target.dataset)) return

  event.preventDefault()
  requestLightbox(target)
})

document.addEventListener("keydown", (event) => {
  const target = event.target
  if (!(target instanceof HTMLImageElement) || !("imageLightbox" in target.dataset)) return
  if (event.key !== "Enter" && event.key !== " ") return

  event.preventDefault()
  requestLightbox(target)
})

document.addEventListener("prenav", () => {
  openRequest += 1
  activePhotoSwipe?.destroy()
})
document.addEventListener("nav", enhanceImages)
enhanceImages()
