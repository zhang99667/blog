import { simplifySlug } from "../util/path"

const BLOG_ORIGIN = "https://markz.fun/"
const NOTES_ORIGIN = "https://note.markz.fun/"
const NOTES_FALLBACK_BASE_URL = "markz.fun/notes"
const BLOG_SITE_NAME = "MarkZ 个人博客"
const NOTES_SITE_NAME = "MarkZ 公开笔记"
const BLOG_DESCRIPTION =
  "MarkZ 的个人博客，记录 AI 开发、软件工具、系统设计与产品实践，以及值得长期保留的技术思考。"
const NOTES_DESCRIPTION = "MarkZ 的公开笔记库。"

export interface StructuredDataInput {
  canonicalUrl: string
  title: string
  description: string
  imageUrl: string
  isArticle: boolean
  publishedAt?: string
  modifiedAt?: string
  tags?: string[]
}

export function canonicalBaseUrl(baseUrl: string): string {
  return baseUrl === NOTES_FALLBACK_BASE_URL ? "note.markz.fun" : baseUrl
}

function siteRoot(baseUrl: string): URL {
  const root = new URL(`https://${canonicalBaseUrl(baseUrl)}`)
  if (!root.pathname.endsWith("/")) root.pathname += "/"
  return root
}

export function canonicalSiteRootUrl(baseUrl: string): string {
  return siteRoot(baseUrl).toString()
}

export function canonicalSiteName(baseUrl: string): string {
  return canonicalBaseUrl(baseUrl) === "note.markz.fun" ? NOTES_SITE_NAME : BLOG_SITE_NAME
}

export function canonicalPageUrl(baseUrl: string, slug: string, filePath = ""): string {
  const root = siteRoot(baseUrl)
  const simpleSlug = simplifySlug(slug)
  const relativePath = simpleSlug === "/" ? "" : simpleSlug
  const page = new URL(relativePath, root)
  if (/index\.md$/i.test(filePath) && !page.pathname.endsWith("/")) page.pathname += "/"
  return page.toString()
}

export function rssFeedUrl(baseUrl: string): string {
  return new URL("index.xml", siteRoot(baseUrl)).toString()
}

export function isEditorialArticle(baseUrl: string, slug: string): boolean {
  return baseUrl === "markz.fun" && slug.startsWith("blog/") && slug !== "blog/index"
}

export function isNotesFallback(baseUrl: string): boolean {
  return baseUrl === NOTES_FALLBACK_BASE_URL
}

export function socialImageUrl(
  baseUrl: string,
  socialImage: unknown,
  fallbackAsset: string,
): string {
  const root = siteRoot(baseUrl)
  if (typeof socialImage !== "string" || socialImage.trim() === "") {
    return new URL(`static/${fallbackAsset}`, root).toString()
  }

  const value = socialImage.trim()
  if (/^https:\/\//i.test(value)) return new URL(value).toString()
  const relativePath = value.replace(/^\/+/, "").replace(/^static\//, "")
  return new URL(`static/${relativePath}`, root).toString()
}

export function createStructuredData({
  canonicalUrl,
  title,
  description,
  imageUrl,
  isArticle,
  publishedAt,
  modifiedAt,
  tags = [],
}: StructuredDataInput): Record<string, unknown> {
  const canonical = new URL(canonicalUrl)
  const isBlog = canonical.origin === new URL(BLOG_ORIGIN).origin
  const websiteUrl = isBlog ? BLOG_ORIGIN : NOTES_ORIGIN
  const websiteId = `${websiteUrl}#website`
  const blogId = `${BLOG_ORIGIN}#blog`
  const personId = `${BLOG_ORIGIN}#person`
  const pageId = `${canonicalUrl}#webpage`
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Person",
      "@id": personId,
      name: "MarkZ",
      url: BLOG_ORIGIN,
    },
    {
      "@type": "WebSite",
      "@id": websiteId,
      url: websiteUrl,
      name: isBlog ? BLOG_SITE_NAME : NOTES_SITE_NAME,
      alternateName: isBlog ? ["MarkZ", "MarkZ Blog"] : "MarkZ 笔记",
      description: isBlog ? BLOG_DESCRIPTION : NOTES_DESCRIPTION,
      inLanguage: "zh-CN",
      publisher: { "@id": personId },
    },
  ]

  if (isBlog) {
    graph.push({
      "@type": "Blog",
      "@id": blogId,
      url: BLOG_ORIGIN,
      name: BLOG_SITE_NAME,
      description: BLOG_DESCRIPTION,
      inLanguage: "zh-CN",
      publisher: { "@id": personId },
      isPartOf: { "@id": websiteId },
    })
  }

  graph.push({
    "@type": "WebPage",
    "@id": pageId,
    url: canonicalUrl,
    name: title,
    description,
    inLanguage: "zh-CN",
    isPartOf: { "@id": websiteId },
  })

  if (isArticle) {
    graph.push({
      "@type": "BlogPosting",
      "@id": `${canonicalUrl}#article`,
      headline: title,
      description,
      image: [imageUrl],
      ...(publishedAt ? { datePublished: publishedAt } : {}),
      ...(modifiedAt ? { dateModified: modifiedAt } : {}),
      ...(tags.length > 0 ? { keywords: tags } : {}),
      inLanguage: "zh-CN",
      mainEntityOfPage: { "@id": pageId },
      author: { "@id": personId },
      isPartOf: { "@id": blogId },
    })
  }

  return { "@context": "https://schema.org", "@graph": graph }
}

export function serializeStructuredData(value: Record<string, unknown>): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}
