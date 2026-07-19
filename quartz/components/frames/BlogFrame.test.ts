import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { h } from "preact"
import { QuartzComponent, QuartzComponentProps } from "../types"
import { renderBlogTableOfContents } from "./BlogFrame"

const componentData = {} as QuartzComponentProps

describe("BlogFrame table of contents", () => {
  test("renders only the mature table-of-contents component from the right layout", () => {
    const graph = (() => h("div", { class: "graph" }, "graph")) as QuartzComponent
    const toc = (() => h("div", { class: "mobile-only toc" }, "toc")) as QuartzComponent
    const backlinks = (() => h("div", { class: "backlinks" }, "backlinks")) as QuartzComponent

    const rendered = renderBlogTableOfContents([graph, toc, backlinks], componentData)

    assert.ok(rendered)
    assert.equal(rendered.props.class, "mobile-only toc")
    assert.equal(rendered.props.children, "toc")
  })

  test("omits the navigation region when an article has no generated outline", () => {
    const graph = (() => h("div", { class: "graph" }, "graph")) as QuartzComponent
    const emptyToc = (() => null) as QuartzComponent

    assert.equal(renderBlogTableOfContents([graph, emptyToc], componentData), null)
  })
})
