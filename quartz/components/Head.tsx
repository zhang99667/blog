import { i18n } from "../i18n"
import { FullSlug, getFileExtension, joinSegments, pathToRoot } from "../util/path"
import { CSSResourceToStyleElement, JSResourceToScriptElement } from "../util/resources"
import { googleFontHref, googleFontSubsetHref } from "../util/theme"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { unescapeHTML } from "../util/escape"
import { CustomOgImagesEmitterName } from "../../.quartz/plugins"
import { brandIdentity } from "../brand.generated"
import {
  canonicalPageUrl,
  canonicalSiteRootUrl,
  createStructuredData,
  isEditorialArticle,
  isNotesFallback,
  rssFeedUrl,
  serializeStructuredData,
} from "./seo"
// @ts-ignore - inline script import handled by the Quartz bundler
import accessibilityScript from "./scripts/accessibility.inline"
export default (() => {
  const Head: QuartzComponent = ({
    cfg,
    fileData,
    externalResources,
    ctx,
  }: QuartzComponentProps) => {
    const titleSuffix = cfg.pageTitleSuffix ?? ""
    const pageTitle = fileData.frontmatter?.title ?? i18n(cfg.locale).propertyDefaults.title
    const title = pageTitle + titleSuffix
    const description =
      fileData.frontmatter?.socialDescription ??
      fileData.frontmatter?.description ??
      unescapeHTML(fileData.description?.trim() ?? i18n(cfg.locale).propertyDefaults.description)

    const { css, js, additionalHead } = externalResources

    const url = new URL(`https://${cfg.baseUrl ?? "example.com"}`)
    const path = url.pathname as FullSlug
    const baseDir = fileData.slug === "404" ? path : pathToRoot(fileData.slug!)
    const iconPath = joinSegments(baseDir, `static/${brandIdentity.assets.icon}`)

    const slug = String(fileData.slug ?? "")
    const isNotFound = slug === "404"
    const canonicalUrl = isNotFound
      ? url.toString()
      : canonicalPageUrl(cfg.baseUrl ?? "example.com", slug, String(fileData.filePath ?? ""))
    const feedUrl = rssFeedUrl(cfg.baseUrl ?? "example.com")
    const isArticle = isEditorialArticle(cfg.baseUrl ?? "", slug)
    const noIndex = isNotFound || isNotesFallback(cfg.baseUrl ?? "")
    const tags = Array.isArray(fileData.frontmatter?.tags)
      ? fileData.frontmatter.tags.filter((tag): tag is string => typeof tag === "string")
      : []

    const usesCustomOgImage = ctx.cfg.plugins.emitters.some(
      (e) => e.name === CustomOgImagesEmitterName,
    )
    const ogImageDefaultPath = new URL(
      `static/${brandIdentity.assets.socialCard}`,
      canonicalSiteRootUrl(cfg.baseUrl ?? "example.com"),
    ).toString()
    const ogImageExtension = getFileExtension(ogImageDefaultPath)?.replace(/^\./, "") ?? "png"
    const publishedAt = fileData.dates?.created?.toISOString()
    const modifiedAt = fileData.dates?.modified?.toISOString()
    const structuredData = createStructuredData({
      canonicalUrl,
      title: pageTitle,
      description,
      imageUrl: ogImageDefaultPath,
      isArticle,
      publishedAt,
      modifiedAt,
      tags,
    })

    const coreStylesheet = css[0]?.content
    const coreScript = js.find(
      (r) => r.loadTime === "beforeDOMReady" && r.contentType === "external",
    )

    return (
      <head>
        <title>{title}</title>
        <meta charSet="utf-8" />
        {coreStylesheet && <link rel="preload" href={coreStylesheet} as="style" />}
        {coreScript && coreScript.contentType === "external" && (
          <link rel="preload" href={coreScript.src} as="script" />
        )}
        {cfg.theme.cdnCaching && cfg.theme.fontOrigin === "googleFonts" && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" />
            <link rel="stylesheet" href={googleFontHref(cfg.theme)} />
            {cfg.theme.typography.title && (
              <link rel="stylesheet" href={googleFontSubsetHref(cfg.theme, cfg.pageTitle)} />
            )}
          </>
        )}
        {fileData.hasMermaidDiagram && (
          <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossOrigin="anonymous" />
        )}
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="author" content={brandIdentity.name} />
        {noIndex && <meta name="robots" content="noindex, follow" />}
        {!isNotFound && <link rel="canonical" href={canonicalUrl} />}
        {!isNotFound && (
          <link
            rel="alternate"
            type="application/rss+xml"
            title={`${cfg.pageTitle} RSS`}
            href={feedUrl}
          />
        )}

        <meta property="og:site_name" content={cfg.pageTitle}></meta>
        <meta property="og:locale" content="zh_CN" />
        <meta property="og:title" content={title} />
        <meta property="og:type" content={isArticle ? "article" : "website"} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta property="og:description" content={description} />
        <meta property="og:image:alt" content={description} />

        {!usesCustomOgImage && (
          <>
            <meta property="og:image" content={ogImageDefaultPath} />
            <meta property="og:image:url" content={ogImageDefaultPath} />
            <meta name="twitter:image" content={ogImageDefaultPath} />
            <meta property="og:image:type" content={`image/${ogImageExtension}`} />
            <meta property="og:image:width" content="1200" />
            <meta property="og:image:height" content="630" />
          </>
        )}

        {isArticle && publishedAt && (
          <meta property="article:published_time" content={publishedAt} />
        )}
        {isArticle && modifiedAt && <meta property="article:modified_time" content={modifiedAt} />}
        {isArticle && tags.map((tag) => <meta property="article:tag" content={tag} />)}

        {cfg.baseUrl && (
          <>
            <meta property="twitter:domain" content={new URL(canonicalUrl).hostname}></meta>
            <meta property="og:url" content={canonicalUrl}></meta>
            <meta property="twitter:url" content={canonicalUrl}></meta>
          </>
        )}

        <link rel="icon" href={iconPath} />
        <meta name="description" content={description} />
        <meta name="generator" content="Quartz" />

        {css.map((resource) => CSSResourceToStyleElement(resource, true))}
        {js
          .filter((resource) => resource.loadTime === "beforeDOMReady")
          .map((res) => JSResourceToScriptElement(res, true))}
        {additionalHead.map((resource) => {
          if (typeof resource === "function") {
            return resource(fileData)
          } else {
            return resource
          }
        })}
        {!isNotFound && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeStructuredData(structuredData) }}
          />
        )}
      </head>
    )
  }

  Head.afterDOMLoaded = accessibilityScript
  return Head
}) satisfies QuartzComponentConstructor
