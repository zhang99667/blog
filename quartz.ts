import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import type { QuartzLayoutOverrides } from "./quartz/plugins/loader/config-loader"
import { brandIdentity, brandTheme } from "./quartz/brand.generated"
import { BrandPageTitle, componentRegistry } from "./quartz/components"
import {
  finalizeGraphCompatibilityOverride,
  registerGraphCompatibilityOverride,
} from "./quartz/components/GraphCompatibility"

const site = process.env.QUARTZ_SITE ?? "blog"
const isNotes = site === "notes" || site === "notes-fallback"

const layoutOverrides: QuartzLayoutOverrides | undefined =
  site === "blog"
    ? {
        byPageType: {
          content: { frame: "blog", left: [], right: [] },
          folder: { frame: "blog", left: [], right: [] },
          tag: { frame: "blog", left: [], right: [] },
        },
      }
    : undefined

componentRegistry.replace("PageTitle", BrandPageTitle, "local:markz-design-system")
componentRegistry.replace("page-title", BrandPageTitle, "local:markz-design-system")
registerGraphCompatibilityOverride()

const config = await loadQuartzConfig(
  {
    pageTitle: brandIdentity.name,
    pageTitleSuffix: isNotes ? " · 公开笔记" : " · 个人博客",
    theme: brandTheme,
    baseUrl:
      site === "notes"
        ? "note.markz.fun"
        : site === "notes-fallback"
          ? "markz.fun/notes"
          : "markz.fun",
  },
  layoutOverrides,
)
finalizeGraphCompatibilityOverride()
export default config
export const layout = await loadQuartzLayout(layoutOverrides)
