export interface CommentVisibilityInput {
  baseUrl?: unknown
  slug?: unknown
  relativePath?: unknown
  comments?: unknown
}

const blogHost = "markz.fun"
const notesHost = "note.markz.fun"

function isMarkdown(relativePath: string): boolean {
  return (
    /\.md$/i.test(relativePath) &&
    !/(?:^|\/)index\.md$/i.test(relativePath) &&
    !/\.(?:canvas|base)(?:\.md)?$/i.test(relativePath) &&
    !/\.excalidraw\.md$/i.test(relativePath)
  )
}

function isDocumentSlug(slug: string): boolean {
  return (
    slug !== "404" &&
    slug !== "index" &&
    slug !== "all-tags" &&
    !slug.endsWith("/index") &&
    !slug.startsWith("tags/")
  )
}

export function shouldRenderComments({
  baseUrl,
  slug,
  relativePath,
  comments,
}: CommentVisibilityInput): boolean {
  if (comments === false || comments === "false") return false
  if (typeof baseUrl !== "string" || typeof slug !== "string") return false
  if (typeof relativePath !== "string" || !isMarkdown(relativePath)) return false
  if (!isDocumentSlug(slug)) return false

  if (baseUrl === blogHost) {
    return slug.startsWith("blog/") && slug !== "blog/index"
  }

  return baseUrl === notesHost
}
