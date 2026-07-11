import assert from "node:assert/strict"
import { test } from "node:test"
import { validateAiManifest, validateEvalCases, validateSkill } from "./check-ai-infra.mjs"

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
