import { PageFrame, PageFrameProps } from "./types"
import { BrandMark } from "../BrandMark"
import { brandIdentity } from "../../brand.generated"

function isBlogSection(slug: string): boolean {
  return slug === "blog/index" || slug.startsWith("blog/")
}

export const BlogFrame: PageFrame = {
  name: "blog",
  render({ componentData, beforeBody, pageBody: Content, afterBody }: PageFrameProps) {
    const slug = String(componentData.fileData.slug ?? "")

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

          <main class="center blog-main">
            <div class="page-header">
              <div class="popover-hint">
                {beforeBody.map((BodyComponent) => (
                  <BodyComponent {...componentData} />
                ))}
              </div>
            </div>
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
            <a href="/index.xml">RSS</a>
            <a href="https://note.markz.fun/">笔记</a>
            <a href="https://github.com/zhang99667">GitHub</a>
          </nav>
        </footer>
      </>
    )
  },
}
