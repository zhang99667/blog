import type { QuartzComponent, QuartzComponentConstructor } from "./types"
import style from "./styles/imageLightbox.scss"
// @ts-ignore - inline script import handled by the Quartz bundler
import script from "./scripts/imageLightbox.inline"

export const ImageLightbox = (() => {
  const Lightbox: QuartzComponent = () => null

  Lightbox.displayName = "ImageLightbox"
  Lightbox.css = style
  Lightbox.afterDOMLoaded = script
  return Lightbox
}) satisfies QuartzComponentConstructor
