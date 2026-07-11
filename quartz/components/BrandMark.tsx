import { brandIdentity } from "../brand.generated"
import { pathToRoot } from "../util/path"
import type { QuartzComponent, QuartzComponentConstructor } from "./types"

interface BrandMarkProps {
  href: string
  className?: string
  ariaLabel?: string
}

export function BrandMark({ href, className, ariaLabel }: BrandMarkProps) {
  const classes = ["brand-mark", className].filter(Boolean).join(" ")
  return (
    <a
      class={classes}
      href={href}
      aria-label={ariaLabel ?? `${brandIdentity.name} 首页`}
      data-brand-version={brandIdentity.version}
    >
      {brandIdentity.name}
      <span class="brand-dot" aria-hidden="true" />
    </a>
  )
}

export const BrandPageTitle = (() => {
  const PageTitle: QuartzComponent = ({ fileData, displayClass }) => {
    const classes = [displayClass, "page-title"].filter(Boolean).join(" ")
    return (
      <h2 class={classes}>
        <BrandMark href={pathToRoot(fileData.slug!)} />
      </h2>
    )
  }

  return PageTitle
}) satisfies QuartzComponentConstructor
