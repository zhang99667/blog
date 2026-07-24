import { JSX } from "preact"
import { QuartzComponent, QuartzComponentProps } from "../types"
import { BrandMark } from "../BrandMark"
import { brandIdentity } from "../../brand.generated"
import { PageFrame, PageFrameProps } from "./types"

function isBlogSection(slug: string): boolean {
  return slug === "blog/index" || slug.startsWith("blog/")
}

function hasClassName(element: JSX.Element, expected: string): boolean {
  const className = element.props?.class ?? element.props?.className
  return typeof className === "string" && className.split(/\s+/).filter(Boolean).includes(expected)
}

export function renderBlogTableOfContents(
  components: QuartzComponent[],
  componentData: QuartzComponentProps,
): JSX.Element | null {
  for (const Component of components) {
    const rendered = Component(componentData)
    if (rendered && hasClassName(rendered, "toc")) return rendered
  }
  return null
}

export const BlogFrame: PageFrame = {
  name: "blog",
  render({ componentData, beforeBody, pageBody: Content, afterBody, right }: PageFrameProps) {
    const slug = String(componentData.fileData.slug ?? "")
    const isArticle = slug.startsWith("blog/") && slug !== "blog/index"
    const tableOfContents = isArticle ? renderBlogTableOfContents(right, componentData) : null

    return (
      <>
        <div class="blog-shell">
          <header class="blog-site-header">
            <BrandMark className="blog-brand" href="/" />
            <nav class="blog-nav" aria-label="主导航">
              <a href="/blog/" aria-current={isBlogSection(slug) ? "page" : undefined}>
                文章
              </a>
              <a href="https://note.markz.fun/">笔记</a>
              <a href="https://jsonutils.markz.fun/">JSONUtils</a>
              <a href="https://zhangjihao.markz.fun/">装箱单</a>
              <a href="https://github.com/zhang99667">GitHub</a>
            </nav>
          </header>

          <main class="center blog-main" data-has-toc={tableOfContents ? "true" : undefined}>
            <div class="page-header">
              <div class="popover-hint">
                {beforeBody.map((BodyComponent) => (
                  <BodyComponent {...componentData} />
                ))}
              </div>
            </div>
            {tableOfContents && (
              <aside class="blog-article-toc" aria-label="文章目录">
                {tableOfContents}
              </aside>
            )}
            <Content {...componentData} />
            <div class="page-footer">
              {afterBody.map((BodyComponent) => (
                <BodyComponent {...componentData} />
              ))}
            </div>
          </main>
        </div>
        <footer class="blog-site-footer">
          <div class="blog-footer-meta">
            <p>© 2026 {brandIdentity.name}</p>
            <span
              class="blog-visitor-counter"
              data-blog-visitors
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-busy="true"
              hidden
            >
              <span data-blog-visitor-copy />
            </span>
          </div>
          <nav aria-label="页脚导航">
            <a href="/about" rel="author">
              关于
            </a>
            <a href="/index.xml">RSS</a>
            <a href="https://note.markz.fun/">笔记</a>
            <a href="https://github.com/zhang99667">GitHub</a>
          </nav>
        </footer>
      </>
    )
  },
}
