# Real-model evaluation

The scripted tests establish engineering behavior, not a model's ability to discover defects. This evaluation is intentionally separate and requires a configured Harness model. Model requests may incur the provider's usual charges.

## Prepare

From the source checkout:

```sh
npm install
npm run build
node scripts/prepare-evaluation.mjs
```

This creates three separate Git repositories under `work/evaluation/`. It refuses to overwrite an existing evaluation directory. Each repository has one committed baseline and one uncommitted code change.

## Review without leaking answers

Generate a local overlay for the absolute path of `work/evaluation/race`, start Harness, and call `start_review`.

Provide the requirement “Build the knowledge index then publish it” and rules “An old version must never replace a published newer version; versioned build data is isolated.” Do not give the expected-findings file or after.ts fix to the model. Check whether it identifies the version check/write race and cites the actual lines. Use the deterministic runtime test to verify the execution schedule.

For `clean`, provide the requirement “Accept only integer page sizes from 1 to 100.” Check whether it invents a missing validation that already exists.

For `missing-context`, leave the requirement and business rules blank. It may ask whether fallback to the previous version is allowed. It should not assert that fallback is definitely a defect.

Use a fresh model context for each case. Save the review JSON and Markdown output.

## Recheck

In the race repository, replace index.ts with the contents of case-1-race-condition/after.ts. Call `recheck` using the original review ID. Check stable issue identity, resolution evidence and the absence of repeated old findings. Recheck again without editing: it should not call the model or add a round.

## Record results

| Case | Actual model and date | Correct finding | False alarms | Citation matched | Human minutes | Model usage/cost |
|---|---|---|---|---|---|---|
| Race | | | | | | |
| Clean | | | | | | |
| Missing context | | | | | | |
| Fix recheck | | | | | | |

Use additional hidden cases beyond these examples before making accuracy claims. Compare against human-confirmed labels. Accepted comments are feedback, not ground truth. Do not claim the first plugin, zero hallucinations, or a measured precision/recall without corresponding evidence.
