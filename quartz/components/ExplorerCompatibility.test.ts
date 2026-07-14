import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { patchExplorerRuntime, sanitizeExplorerOptions } from "./ExplorerCompatibility"

describe("Explorer CSP compatibility", () => {
  test("uses the plugin's built-in safe defaults without serialized callbacks", () => {
    assert.deepEqual(sanitizeExplorerOptions({ folderDefaultState: "collapsed" }), {
      folderDefaultState: "collapsed",
      sortFn: undefined,
      filterFn: undefined,
      mapFn: undefined,
    })
  })

  test("rejects executable callback configuration", () => {
    assert.throws(() => sanitizeExplorerOptions({ sortFn: () => 0 }), {
      message: /Custom Explorer sortFn requires a declarative CSP-safe implementation/,
    })
  })

  test("removes the upstream executable callback parser", () => {
    const source =
      'let t=P,n=O,d=null;if(u)try{let E=JSON.parse(u);E.sortFn&&(t=new Function("a","b","return ("+E.sortFn+")(a, b)")),E.filterFn&&(n=new Function("node","return ("+E.filterFn+")(node)")),E.mapFn&&(d=new Function("node","("+E.mapFn+")(node)"))}catch(E){console.error("Error parsing data functions:",E)}return j(r,t,n,d)'
    const patched = patchExplorerRuntime(source)

    assert.equal(typeof patched, "string")
    assert.doesNotMatch(patched as string, /new Function/)
    assert.match(patched as string, /let t=P,n=O,d=null;return j\(r,t,n,d\)/)
  })

  test("rejects upstream runtime drift", () => {
    assert.throws(() => patchExplorerRuntime("const explorer = true"), {
      message: "Expected one Explorer executable-options block, found 0",
    })
  })
})
