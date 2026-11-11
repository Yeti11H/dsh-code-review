# Continue development of dsh-code-review

This is a native DeepSeek Harness 0.2.2-rc.1 plugin. Read README.md and docs/design.md before editing it. Preserve the implemented public tools and their canonical outputs unless a versioned migration is supplied.

## Invariants

1. Use the real `name` / `inject` / `apply` module contract and dsh-tools `defineTool` DSL. Do not introduce the illustrative `definePlugin` or `ctx.model.complete` API.
2. Source reads are bounded, frozen snapshots. Never use arbitrary shell interpolation for Git refs or filenames. Branch reviews use committed sources, not the dirty working tree.
3. Keep exact request/response audit records. Honor cancellation and surface incomplete/error states.
4. Every confirmed finding needs exact matching line references plus a trigger, path and impact. Citation matching does not prove semantic correctness.
5. Model analysis cannot claim executed tests. Configured tests require explicit user request and Harness approval. Do not execute model-supplied shell commands.
6. Preserve stable issue IDs, distinguish false positives, accepted risks, optional suggestions and unresolved risks. Do not close issues simply because their line moved.
7. Rechecks focus on new changes and affected prior issues. Three nonconvergent distinct source rounds require human attention. No-change calls do not erase escalation.
8. Never label a report as approval to merge. Report coverage and missing evidence explicitly.
9. Keep runtime dependencies limited to official Harness peer packages and Node built-ins. Reassess actual published package exports before upgrading.
10. Do not publish packages, send external comments or modify a user's source automatically.

## Verification

Run `npm run typecheck` and `npm test`. Integration tests use real Git and an official Cordis/tools/LLM assembly with a deterministic local adapter. Do not describe those tests as measuring a real model's recall or precision. Add real-model evaluation evidence separately.

When changing snapshot scope, issue matching, persistence or convergence, add a regression test that exercises the behavioral consequence. See examples/live-evaluation.md for manual model-quality evaluation.
