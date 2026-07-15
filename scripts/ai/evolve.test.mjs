import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import {
  auditEvolution,
  classifyCapability,
  rankGaps,
  renderEvolutionMarkdown,
  scoreCapability,
  validateRuntimeBackupActivation,
  validateEvolutionProgram,
} from "./evolve.mjs"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..")

test("evolution scoring favors impact, urgency, confidence, and lower effort", () => {
  assert.equal(scoreCapability({ impact: 5, urgency: 5, confidence: 4, effort: 2 }), 50)
  const ranked = rankGaps([
    { id: "small", status: "gap", score: 10, risk: "low" },
    { id: "done", status: "achieved", score: 100, risk: "low" },
    { id: "declined", status: "declined", score: 200, risk: "critical" },
    { id: "large", status: "gap", score: 40, risk: "medium" },
  ])
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["large", "small"],
  )
})

test("an explicit decline takes precedence over passing evidence", () => {
  assert.equal(
    classifyCapability({ disposition: { status: "declined" } }, { passed: true }),
    "declined",
  )
  assert.equal(classifyCapability({}, { passed: true }), "achieved")
  assert.equal(classifyCapability({}, { passed: false }), "gap")
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
      disposition: {
        status: "declined",
        decidedAt: "not-a-date",
        decision: "not-a-decision",
        reason: "",
      },
      nextAction: "act",
      validation: ["test"],
    })),
  })
  assert.ok(failures.some((failure) => failure.includes("semantic versioning")))
  assert.ok(failures.some((failure) => failure.includes("unsupported")))
  assert.ok(failures.some((failure) => failure.includes("unknown check")))
  assert.ok(failures.some((failure) => failure.includes("impact")))
  assert.ok(failures.some((failure) => failure.includes("invalid disposition")))
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
    summary: {
      achieved: 1,
      total: 2,
      gaps: 1,
      declined: 0,
      evalsPassed: 6,
      evalsTotal: 6,
      decisions: 12,
    },
    next: capability,
    gaps: [capability],
    achieved: [
      {
        name: "SEO",
        evidence: { summary: "Canonical metadata is governed." },
      },
    ],
    declined: [],
    guardrails: ["No destructive automation."],
  })
  assert.match(markdown, /下一项/)
  assert.match(markdown, /文章继续阅读/)
  assert.match(markdown, /实时评测：6\/6/)
  assert.match(markdown, /Add related posts/)
})

test("a declined capability stays visibly unachieved and leaves the automatic queue", async () => {
  const report = await auditEvolution(root)
  const runtimeBackup = report.declined.find((capability) => capability.id === "runtime-backup")

  assert.ok(runtimeBackup)
  assert.equal(runtimeBackup.evidence.passed, false)
  assert.equal(runtimeBackup.score, 31.25)
  assert.equal(runtimeBackup.disposition.decision, "D-022")
  assert.equal(
    report.gaps.some((capability) => capability.id === "runtime-backup"),
    false,
  )
  assert.equal(report.next, null)
  assert.equal(
    report.summary.achieved + report.summary.gaps + report.summary.declined,
    report.summary.total,
  )

  const markdown = renderEvolutionMarkdown(report)
  assert.match(markdown, /已明确不采纳/)
  assert.match(markdown, /D-022/)
  assert.match(markdown, /不计入已达成，现有探针保持原判定/)
})

test("runtime backup activation evidence is bound to its public recipient and recovery run", () => {
  const recipient = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq\n"
  const activation = {
    version: "1.0.0",
    activatedAt: "2026-07-14T14:00:00.000Z",
    workflowRunId: 123,
    artifactId: 456,
    artifactName: "markz-runtime-backup-123",
    artifactDigest: `sha256:${"a".repeat(64)}`,
    sourceCommit: "b".repeat(40),
    recipientSha256: createHash("sha256").update(recipient).digest("hex"),
    retentionDays: 90,
    restoreDrill: "passed",
  }

  assert.deepEqual(validateRuntimeBackupActivation(activation, recipient), [])
  assert.match(validateRuntimeBackupActivation(activation, `${recipient}age1changed\n`)[0], /stale/)
  assert.match(
    validateRuntimeBackupActivation({ ...activation, restoreDrill: "skipped" }, recipient)[0],
    /invalid/,
  )
})
