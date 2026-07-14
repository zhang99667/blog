import assert from "node:assert/strict"
import { test } from "node:test"
import {
  loadContentSecurityPolicy,
  parseContentSecurityPolicy,
  parseNginxContentSecurityPolicy,
} from "./content-security-policy.mjs"

test("loads one host-scoped editorial policy from Nginx", async () => {
  const policy = await loadContentSecurityPolicy()
  assert.deepEqual(policy.directives.get("script-src"), ["'self'"])
  assert.deepEqual(policy.directives.get("script-src-attr"), ["'none'"])
  assert.equal(policy.value.includes("'unsafe-eval'"), false)
})

test("rejects duplicate directives and policy scope drift", () => {
  assert.throws(() => parseContentSecurityPolicy("script-src 'self'; script-src 'none'"), {
    message: "Duplicate CSP directive: script-src",
  })
  assert.throws(
    () =>
      parseNginxContentSecurityPolicy(`
        map $host $markz_content_security_policy {
          default "default-src 'self'";
          markz.fun "default-src 'self'";
        }
      `),
    { message: "Non-editorial hosts must default to an empty CSP" },
  )
})
