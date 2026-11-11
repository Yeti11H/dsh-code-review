# dsh-code-review implementation design

The user approved the local native-plugin design and supplied the detailed six-phase plan. This document records its concrete implementation, corrections, and acceptance checks; no additional approval is required for that authorized work.

## Scope and design choices

Build a TypeScript native DeepSeek Harness plugin targeting the published 0.2.2-rc.1 release, plus an independently testable core. Use the official function-module `name`/`inject`/`apply` entry point and `defineTool` from dsh-tools. The plan's `definePlugin`, Zod parameters and `ctx.model.complete` are illustrative, not current interfaces. Declare actual Harness peer dependencies. No third-party runtime libraries are added beyond Harness; TypeScript and Node types are development tools. No claim of being the first plugin or eliminating hallucinations will be made.

Three user tools start reviews, inspect/list sessions, and recheck. A fourth records a user's explicit issue disposition with a reason. Default source access is read-only. Reports and session metadata are written only to the repository's `.dsh-review` folder. Test execution is opt-in, using commands configured by the plugin installer, never arbitrary commands suggested by the model. No publication, external comments, source edits or automatic merges are part of this implementation.

## Git and snapshot

Use `execFile` with argument arrays and no shell. `unstaged` is retained as a compatibility name for all uncommitted changes: staged, unstaged and nonignored untracked files. Branch targets compare merge-base(target, HEAD) to committed HEAD; uncommitted files do not leak into branch reviews. Store the base/head identities, immutable text of the repository's readable source, changed file diffs, explicit omissions, and a SHA256 covering content and omissions. Exclude `.git`, `.dsh-review`, dependencies, binaries, secrets by filename, symlinks and oversized files. Snapshot/read limits are explicit in coverage. Verify source stability before completing a review; later changes mark the report stale. Changes to unchanged context also affect the snapshot hash. Large diffs split below the configured 500 changed-line target, including single large files; additional byte limits bound prompt size.

## Two-pass review

Each batch receives numbered frozen code and explicit business context. First-pass JSON candidates are validated. Second-pass calls receive frozen context and validate the issue's exact quoted lines against the snapshot, not just the presence of a string. Invalid positions, missing business confirmation and unsupported evidence downgrade to needs_check. Runtime test results are recorded separately: the model cannot self-assert executed_test. Model requests contain no tools, so nested calls cannot edit source or execute commands. Exact model requests and outcomes are persisted for audit; timeout/cancellation and provider errors produce an incomplete session, never a clean bill of health.

## Rechecks and convergence

Persist stable issue IDs and explicit history. Compare complete source snapshots and context dependencies. Recheck open issues when their dependencies change; retain unaffected issues. Scan newly changed files/lines, not the whole original diff. A moved or deleted line alone does not resolve an issue. Resolution requires a verifier's reason and evidence from the current source. Accepted risks remain separately visible. After appending the current round, three consecutive rounds with new issues or three nonprogressing open-issue counts trigger needs_human while issues remain. No-change calls preserve needs_human and do not consume another round. Completed means this analysis finished, not approved to merge.

## Validation

Use real temporary Git repositories with a deterministic scripted model to verify mechanics, plus actual Cordis + dsh-tools + dsh-llm registration/dispatch with a local adapter. Cover staged/untracked/branch/rename/deletion/binary/large files, bounded snapshots, citation mismatches, malformed JSON, cancellation, false positives, missing business context, stable IDs, fixes, stale code, three-round escalation, unchanged rechecks, test provenance, storage validation and packaging. Ship the four requested evaluation examples and a live-model evaluation command. Distinguish scripted integration evidence from real model accuracy; no API key means live quality has not been measured. Attempt actual DSH Web startup with a local overlay without using the user's home configuration.
