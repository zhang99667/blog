import type { QuartzComponent, QuartzComponentConstructor } from "./types"
import style from "./styles/articleReactions.scss"
// @ts-ignore - inline script import handled by the Quartz bundler
import script from "./scripts/articleReactions.inline"

export const ArticleReactions = (() => {
  const Reactions: QuartzComponent = () => null

  Reactions.displayName = "ArticleReactions"
  Reactions.css = style
  Reactions.afterDOMLoaded = script
  return Reactions
}) satisfies QuartzComponentConstructor
