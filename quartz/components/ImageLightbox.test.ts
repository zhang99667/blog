import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  photoSwipeAssetFile,
  photoSwipeAssetPath,
  photoSwipeSourcePath,
  photoSwipeVersion,
} from "./imageLightboxAssets"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

describe("ImageLightbox dependency boundary", () => {
  test("pins PhotoSwipe and keeps the site adapter thin", () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
    const adapter = readFileSync(
      path.join(root, "quartz/components/scripts/imageLightbox.inline.ts"),
      "utf8",
    )
    const component = readFileSync(path.join(root, "quartz/components/ImageLightbox.tsx"), "utf8")
    const staticEmitter = readFileSync(path.join(root, "quartz/plugins/emitters/static.ts"), "utf8")

    assert.equal(packageJson.dependencies.photoswipe, photoSwipeVersion)
    assert.equal(photoSwipeAssetFile, "vendor/photoswipe-5.4.4.esm.min.js")
    assert.equal(photoSwipeAssetPath, `static/${photoSwipeAssetFile}`)
    assert.equal(photoSwipeSourcePath, "node_modules/photoswipe/dist/photoswipe.esm.min.js")
    assert.match(adapter, /import type PhotoSwipe from "photoswipe"/)
    assert.match(adapter, /import\(assetUrl\)/)
    assert.match(adapter, /new PhotoSwipeConstructor\(/)
    assert.match(staticEmitter, /photoSwipeSourcePath/)
    assert.match(staticEmitter, /photoSwipeAssetFile/)
    assert.match(component, /QuartzComponent = \(\) => null/)

    for (const customInteractionPrimitive of [
      "showModal",
      "HTMLDialogElement",
      "setPointerCapture",
      "touchmove",
      "renderScale",
      "fittedWidth",
    ]) {
      assert.doesNotMatch(adapter, new RegExp(customInteractionPrimitive))
    }
  })
})
