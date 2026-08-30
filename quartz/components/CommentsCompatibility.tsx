import type { StringResource } from "../util/resources"
import { shouldRenderComments } from "./CommentVisibility"
import { componentRegistry } from "./registry"
import type { QuartzComponent, QuartzComponentConstructor } from "./types"
import style from "./styles/comments.scss"
// @ts-ignore - inline script import handled by the Quartz bundler
import script from "./scripts/comments.inline"

const upstreamCommentsKey = "comments/Comments"
const overrideSource = "local:markz-comments-compatibility"

type CommentsConstructor = QuartzComponentConstructor<Record<string, unknown> | undefined>

let upstreamComments: CommentsConstructor | undefined

function concatenateResources(...resources: StringResource[]): string | string[] | undefined {
  const result = resources.filter((resource) => resource !== undefined).flat()
  return result.length === 0 ? undefined : result
}

function resolveUpstreamComments(): CommentsConstructor {
  if (upstreamComments) return upstreamComments

  const registration = componentRegistry.get(upstreamCommentsKey)
  if (!registration || registration.component === CommentsWithGovernedRuntime) {
    throw new Error("Quartz Comments plugin did not register its component")
  }

  upstreamComments = registration.component as CommentsConstructor
  return upstreamComments
}

const CommentsWithGovernedRuntime: CommentsConstructor = (options) => {
  const original = resolveUpstreamComments()(options)
  const comments = ((props) => {
    if (
      !shouldRenderComments({
        baseUrl: props.cfg.baseUrl,
        slug: props.fileData.slug,
        relativePath: props.fileData.relativePath,
        comments: props.fileData.frontmatter?.comments,
      })
    ) {
      return null
    }

    return (
      <section
        id="comments"
        class="article-comments"
        data-article-comments
        aria-labelledby="comments-title"
      >
        <h2 id="comments-title" class="article-comments__title">
          评论
        </h2>
        {original(props)}
      </section>
    )
  }) as QuartzComponent

  Object.assign(comments, original)
  comments.displayName = "CommentsWithGovernedRuntime"
  comments.css = concatenateResources(original.css, style)
  comments.afterDOMLoaded =
    (process.env.QUARTZ_SITE ?? "blog") === "notes-fallback" ? undefined : script
  return comments
}

export function registerCommentsCompatibilityOverride(): void {
  componentRegistry.replace("Comments", CommentsWithGovernedRuntime, overrideSource)
  componentRegistry.replace("comments", CommentsWithGovernedRuntime, overrideSource)
}

export function finalizeCommentsCompatibilityOverride(): void {
  resolveUpstreamComments()
  componentRegistry.replace(upstreamCommentsKey, CommentsWithGovernedRuntime, overrideSource)
}
