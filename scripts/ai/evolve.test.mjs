import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import {
  rankGaps,
  renderEvolutionMarkdown,
  scoreCapability,
  validateEvolutionProgram,
} from "./evolve.mjs"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..")

test("evolution scoring favors impact, urgency, confidence, and lower effort", () => {
  assert.equal(scoreCapability({ impact: 5, urgency: 5, confidence: 4, effort: 2 }), 50)
  const ranked = rankGaps([
    { id: "small", status: "gap", score: 10, risk: "low" },
    { id: "done", status: "achieved", score: 100, risk: "low" },
    { id: "large", status: "gap", score: 40, risk: "medium" },
  ])
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["large", "small"],
  )
})

test("current evolution program is structurally valid", async () => {
  const program = JSON.parse(await readFile(path.join(root, "ai/evolution.json"), "utf8"))
  assert.deepEqual(validateEvolutionProgram(program), [])
})

test("evolution validation rejects unknown probes and invalid scoring inputs", () => {
  const failures = validateEvolutionProgram({
    version: "1",
    objective: "test",
    guardrails: ["a", "b", "c"],
    selectionPolicy: { formula: "magic" },
    capabilities: Array.from({ length: 5 }, (_, index) => ({
      id: `candidate-${index}`,
      check: "unknown",
      impact: 6,
      urgency: 1,
      confidence: 1,
      effort: 1,
      risk: "medium",
      nextAction: "act",
      validation: ["test"],
    })),
  })
  assert.ok(failures.some((failure) => failure.includes("semantic versioning")))
  assert.ok(failures.some((failure) => failure.includes("unsupported")))
  assert.ok(failures.some((failure) => failure.includes("unknown check")))
  assert.ok(failures.some((failure) => failure.includes("impact")))
})

test("evolution report exposes current evidence and the next action", () => {
  const capability = {
    id: "reader-continuity",
    name: "文章继续阅读",
    description: "Keep readers moving.",
    score: 50,
    risk: "medium",
    nextAction: "Add related posts.",
    validation: ["npm test"],
    evidence: { summary: "Missing.", evidence: ["related-reading is missing"] },
  }
  const markdown = renderEvolutionMarkdown({
    generatedAt: "2026-07-14T00:00:00.000Z",
    objective: "Mature the site.",
    summary: { achieved: 1, total: 2, gaps: 1, evalsPassed: 6, evalsTotal: 6, decisions: 12 },
    next: capability,
    gaps: [capability],
    achieved: [
      {
        name: "SEO",
        evidence: { summary: "Canonical metadata is governed." },
      },
    ],
    guardrails: ["No destructive automation."],
  })
  assert.match(markdown, /下一项/)
  assert.match(markdown, /文章继续阅读/)
  assert.match(markdown, /实时评测：6\/6/)
  assert.match(markdown, /Add related posts/)
})
