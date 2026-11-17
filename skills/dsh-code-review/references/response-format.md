# Response format

Use the exact `sessionId`, `codeHash`, and `contextHash` returned by prepare. JSON files must be <=2 MB. Do not invent model/API/token usage metadata. Results record host analysis, not API calls.

## Context

```json
{"requirement":"Keep pagination within bounds","businessRules":["Page must be between 1 and totalPages"],"outOfScope":["Page styling"]}
```

## Scan submission

```json
{
  "sessionId":"RV-copy-from-prepare",
  "codeHash":"copy-from-prepare",
  "contextHash":"copy-from-prepare",
  "reviewedFiles":["src/pagination.ts"],
  "omissions":[],
  "findings":[{
    "location":{"file":"src/pagination.ts","lineRange":[12,12],"side":"after"},
    "description":"Next page can exceed totalPages",
    "reasoning":"The last-page transition increments without an upper bound",
    "verification_points":["Check caller guards and disabled-button behavior"],
    "business_dependent":true
  }]
}
```

`findings: []` is legitimate. `reviewedFiles` contains only changed paths read in this review. Any unreviewed changed file becomes an omission. `omissions` is for unread/unavailable code or unexamined candidates; every entry causes manual intervention. Do not add intentionally unexecuted tests here; they are already reported separately. Candidate IDs are assigned by the helper (`FD-1`, etc.); read verify input after scan. At most 20 candidates across the review, not per batch. Before code is available only for original changed files; after code may include related captured files.

## Verification submission

```json
{
  "sessionId":"RV-copy-from-prepare",
  "codeHash":"copy-from-prepare",
  "contextHash":"copy-from-prepare",
  "verifications":[{
    "candidateId":"FD-1",
    "result":{
      "verdict":"confirmed",
      "title":"Next page exceeds upper bound",
      "location":{"file":"src/pagination.ts","lineRange":[12,12],"side":"after"},
      "trigger_condition":"Current page equals totalPages and next() is called",
      "error_process":"next() increments page without checking the bound",
      "actual_impact":"Requests a page outside the required range",
      "code_evidence":[{"file":"src/pagination.ts","lineRange":[12,12],"side":"after","quote":"  return page + 1;"}],
      "verification_method":"Exercise next() on the last page",
      "suggested_fix":"Bound the transition at totalPages",
      "category":"correctness",
      "priority":"medium",
      "optional":false,
      "origin":"introduced",
      "business_dependent":true,
      "rationale":"No guard exists in the captured function or its checked caller"
    }
  }]
}
```

Examples are illustrative, not measured results. Every submitted candidate needs exactly one verification, including false positives. Valid verdicts: `confirmed`, `false_positive`, `needs_check`. Categories: `correctness`, `performance`, `security`, `maintainability`. Priority: `high`, `medium`, `low`. Origin: `introduced`, `pre_existing`, `unknown`. Use `before` for deleted source; quote must exactly match the frozen inclusive line range. Mismatched or missing evidence downgrades to needs_check. Missing requirements/rules downgrades business-dependent judgments. False positives need rationale and counterevidence too.

Do not claim test execution or auto resolution. Test fields are not imported; the offline adapter records no executed tests. A rejected first-review candidate is not proof of a code fix. A zero-candidate scan finishes with `"verifications": []`; it does not establish requirement coverage or correctness.
