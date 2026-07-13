import type { QuartzComponent, QuartzComponentConstructor } from "./types"
import style from "./styles/imageLightbox.scss"
// @ts-ignore - inline script import handled by the Quartz bundler
import script from "./scripts/imageLightbox.inline"

export const ImageLightbox = (() => {
  const Lightbox: QuartzComponent = () => (
    <dialog id="image-lightbox" class="image-lightbox" aria-label="图片预览">
      <div class="image-lightbox__viewport">
        <div class="image-lightbox__canvas">
          <img class="image-lightbox__preview" alt="" draggable={false} />
        </div>
      </div>
      <div class="image-lightbox__toolbar" role="toolbar" aria-label="图片预览工具">
        <button type="button" data-image-action="zoom-out" aria-label="缩小" title="缩小">
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          class="image-lightbox__scale"
          data-image-action="reset"
          aria-label="恢复适合屏幕"
          title="恢复适合屏幕"
        >
          100%
        </button>
        <button type="button" data-image-action="zoom-in" aria-label="放大" title="放大">
          <span aria-hidden="true">+</span>
        </button>
        <button
          type="button"
          class="image-lightbox__close"
          data-image-action="close"
          aria-label="关闭图片预览"
          title="关闭"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </dialog>
  )

  Lightbox.displayName = "ImageLightbox"
  Lightbox.css = style
  Lightbox.afterDOMLoaded = script
  return Lightbox
}) satisfies QuartzComponentConstructor
