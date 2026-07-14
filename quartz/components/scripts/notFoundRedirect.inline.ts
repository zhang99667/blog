// @ts-nocheck
if (typeof fetchData !== "undefined") {
  fetchData.then(function (index) {
    let basePath = document.body.dataset.basepath || ""
    if (basePath.length > 1 && basePath.endsWith("/")) {
      basePath = basePath.slice(0, -1)
    }

    let pathname = window.location.pathname
    const hasBasePrefix = basePath.length > 1 && pathname.startsWith(basePath)
    if (hasBasePrefix) pathname = pathname.slice(basePath.length)
    if (pathname.startsWith("/")) pathname = pathname.slice(1)
    if (pathname.endsWith("/")) pathname = pathname.slice(0, -1)
    if (pathname.endsWith(".html")) pathname = pathname.slice(0, -5)
    if (pathname.endsWith("/index")) pathname = pathname.slice(0, -6)

    const lowered = pathname.toLowerCase()
    if (lowered !== pathname && index[lowered] != null) {
      const prefix = hasBasePrefix ? basePath : ""
      const target = prefix + (prefix.endsWith("/") ? "" : "/") + lowered
      window.location.replace(target)
    }
  })
}
