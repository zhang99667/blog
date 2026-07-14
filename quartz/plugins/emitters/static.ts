import { FilePath, QUARTZ, joinSegments } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import fs from "fs"
import { glob } from "../../util/glob"
import { dirname, resolve } from "path"
import { photoSwipeAssetFile, photoSwipeSourcePath } from "../../components/imageLightboxAssets"
import {
  bundleGraphRuntimeAsset,
  graphRuntimeAssets,
  isGraphRuntimeSite,
} from "../../components/graphRuntimeAssets"

export const Static: QuartzEmitterPlugin = () => ({
  name: "Static",
  async *emit({ argv, cfg }) {
    const staticPath = joinSegments(QUARTZ, "static")
    const fps = await glob("**", staticPath, cfg.configuration.ignorePatterns)
    const outputStaticPath = joinSegments(argv.output, "static")
    await fs.promises.mkdir(outputStaticPath, { recursive: true })
    for (const fp of fps) {
      const src = joinSegments(staticPath, fp) as FilePath
      const dest = joinSegments(outputStaticPath, fp) as FilePath
      await fs.promises.mkdir(dirname(dest), { recursive: true })
      await fs.promises.copyFile(src, dest)
      yield dest
    }

    const photoSwipeSource = resolve(QUARTZ, "..", photoSwipeSourcePath)
    const photoSwipeDestination = joinSegments(outputStaticPath, photoSwipeAssetFile) as FilePath
    await fs.promises.mkdir(dirname(photoSwipeDestination), { recursive: true })
    await fs.promises.copyFile(photoSwipeSource, photoSwipeDestination)
    yield photoSwipeDestination

    if (isGraphRuntimeSite()) {
      const projectRoot = resolve(QUARTZ, "..")
      for (const asset of graphRuntimeAssets) {
        const destination = joinSegments(outputStaticPath, asset.file) as FilePath
        const content = await bundleGraphRuntimeAsset(asset, projectRoot)
        await fs.promises.mkdir(dirname(destination), { recursive: true })
        await fs.promises.writeFile(destination, content)
        yield destination
      }
    }

    if ((process.env.QUARTZ_SITE ?? "blog") === "blog") {
      const socialImageRoot = resolve(QUARTZ, "..", ".cache", "social-images")
      await fs.promises.access(socialImageRoot)
      const socialImageFiles = await glob("**", socialImageRoot, cfg.configuration.ignorePatterns)
      for (const fp of socialImageFiles) {
        const source = joinSegments(socialImageRoot, fp) as FilePath
        const destination = joinSegments(outputStaticPath, fp) as FilePath
        await fs.promises.mkdir(dirname(destination), { recursive: true })
        await fs.promises.copyFile(source, destination)
        yield destination
      }
    }
  },
  async *partialEmit() {},
})
