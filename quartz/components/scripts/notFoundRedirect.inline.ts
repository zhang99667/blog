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

    // The content index stores decoded slugs ("blog/agent-hook-完全指南") while
    // location.pathname is percent-encoded, so compare the decoded form and only
    // lowercase literal characters (encoded octets keep their uppercase hex).
    let decoded = pathname
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      // Malformed escape sequence: keep the raw pathname.
    }
    const lowered = decoded.replace(/%[0-9A-Fa-f]{2}|[^%]/g, (chunk) =>
      chunk.startsWith("%") ? chunk.toUpperCase() : chunk.toLowerCase(),
    )
    if (lowered !== decoded && index[lowered] != null) {
      const prefix = hasBasePrefix ? basePath : ""
      const target = prefix + (prefix.endsWith("/") ? "" : "/") + encodeURI(lowered)
      window.location.replace(target)
    }
  })
}
