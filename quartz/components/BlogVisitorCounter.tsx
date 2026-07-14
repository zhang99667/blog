import type { QuartzComponent, QuartzComponentConstructor } from "./types"
// @ts-ignore - inline script import handled by the Quartz bundler
import script from "./scripts/blogVisitorCounter.inline"

export const BlogVisitorCounter = (() => {
  const Counter: QuartzComponent = () => null

  Counter.displayName = "BlogVisitorCounter"
  Counter.afterDOMLoaded = script
  return Counter
}) satisfies QuartzComponentConstructor
