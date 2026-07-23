import assert from "node:assert/strict"
import { test } from "node:test"
import {
  validateAiManifest,
  collectAiInfraFailures,
  validateDecisionLog,
  validateEvalCases,
  validateEvolutionWorkflow,
  validateSkill,
} from "./check-ai-infra.mjs"

test("project skill contract accepts a complete skill", () => {
  const source = `---
name: markz-site-maintainer
description: Maintain the site.
---
## Required reading
## Workflow
## Command map
## Boundaries
`
  assert.deepEqual(validateSkill(source), [])
})

test("project skill contract rejects template residue and missing sections", () => {
  const source = `---
name: markz-site-maintainer
description: [TODO: fill this]
version: 1.0.0
---
## Workflow
`
  assert.deepEqual(validateSkill(source), [
    "skill contains template text",
    "skill frontmatter has unsupported keys: version",
    "skill is missing ## Required reading",
    "skill is missing ## Command map",
    "skill is missing ## Boundaries",
  ])
})

test("AI eval corpus requires unique, executable cases", () => {
  const payload = {
    version: "1.0.0",
    cases: [
      {
        id: "one",
        risk: "low",
        prompt: "one",
        mustRead: ["AGENTS.md"],
        invariants: ["a"],
        validation: ["npm test"],
        automatedChecks: ["ai-contract"],
      },
      {
        id: "two",
        risk: "medium",
        prompt: "two",
        mustRead: ["AGENTS.md"],
        invariants: ["b"],
        validation: ["npm test"],
        automatedChecks: ["ai-contract"],
      },
      {
        id: "three",
        risk: "high",
        prompt: "three",
        mustRead: ["AGENTS.md"],
        invariants: ["c"],
        validation: ["npm test"],
        automatedChecks: ["ai-contract"],
      },
    ],
  }
  assert.deepEqual(validateEvalCases(payload), [])

  payload.cases[2].id = "two"
  payload.cases[1].validation = []
  assert.deepEqual(validateEvalCases(payload), [
    "two.validation must be a non-empty array",
    "invalid or duplicate eval id: two",
  ])
})

test("AI manifest requires authorities, instruction layers, workflows, and eval suites", () => {
  const payload = {
    version: "1.0.0",
    authorities: Array.from({ length: 5 }, (_, index) => ({
      id: `authority-${index}`,
      path: `docs/${index}.md`,
      kind: "source",
    })),
    instructionLayers: Array.from({ length: 4 }, (_, index) => ({
      scope: `scope-${index}`,
      path: `instructions/${index}.md`,
    })),
    workflows: {
      visual: {
        risk: "medium",
        prompt: "prompt.md",
        requiredCommands: ["npm test"],
        requiredEvidence: ["tests"],
      },
    },
    evalSuites: [
      { id: "one", path: "one.json", runner: "npm test" },
      { id: "two", path: "two.json", runner: "npm test" },
    ],
  }
  assert.deepEqual(validateAiManifest(payload), [])

  payload.version = "latest"
  payload.authorities[4].id = "authority-3"
  payload.workflows.visual.requiredEvidence = []
  assert.deepEqual(validateAiManifest(payload), [
    "AI manifest version must use semantic versioning",
    "invalid or duplicate AI authority: authority-3",
    "AI workflows require risk, prompt, commands, and evidence",
  ])
})

test("decision log contract checks every contiguous entry and required field", () => {
  const entry = (id, overrides = {}) => `## D-${id} Decision

- 日期：${overrides.date ?? "2026-07-14"}
- 触发：${overrides.trigger ?? "A reusable correction."}
- 决策：${overrides.decision ?? "Govern it."}
- 反例：${overrides.counterexample ?? "One-off edits."}
- 边界：${overrides.boundary ?? "Keep product boundaries."}
- 锁定证据：${overrides.evidence ?? "npm test"}
`
  assert.deepEqual(validateDecisionLog(`${entry("001")}\n${entry("002")}`), [])

  const failures = validateDecisionLog(
    `${entry("001")}\n${entry("003", { evidence: "" }).replace("- 决策：Govern it.", "- 决策：")}`,
  )
  assert.ok(failures.some((failure) => failure.includes("expected D-002")))
  assert.ok(failures.some((failure) => failure.includes("requires a non-empty 决策")))
  assert.ok(failures.some((failure) => failure.includes("requires a non-empty 锁定证据")))
})

test("evolution workflow audits every main push and cannot narrow itself to AI paths", () => {
  const workflow = `on:
  push:
    branches:
      - main
  schedule:
    - cron: "41 2 * * 1"
permissions:
  issues: write
steps:
  - run: npm run evolve:check
  - run: npm run evals:check
  - run: npm run evolve:report
  - run: gh issue edit
  - uses: actions/upload-artifact@v4
    with:
      include-hidden-files: true
`
  assert.deepEqual(validateEvolutionWorkflow(workflow), [])
  assert.ok(
    validateEvolutionWorkflow(
      workflow.replace("  schedule:", '    paths:\n      - "ai/**"\n  schedule:'),
    ).includes("evolution workflow must audit every main push without a path filter"),
  )
})

test("repository workflow requires the governed six-hour publish cadence", async () => {
  const failures = await collectAiInfraFailures()
  assert.ok(!failures.some((failure) => failure.includes("17 */6 * * *")))
})
