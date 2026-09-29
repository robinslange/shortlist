# Score the survivors

Run this after `shortlist score`, in the workspace.

## Input

- `survivors.json`: the roles that passed the cheap filter. Each has `key`,
  `title`, `company`, `location`, `jd_text`, maybe `comp_text`, and
  `cheap_score` with `matched_shapes`.
- `profile.yaml`: read `candidate` (name, location, summary, comp_floor) and
  `red_flags`.

## Output

Write `scores.json`: an array with one object per role.

```json
[
  {
    "key": "greenhouse:examplecorp:4001",
    "score": 8,
    "rationale": "Senior platform role on a Go and Kubernetes stack, hybrid in Wellington, pay not stated.",
    "red_flags_spotted": []
  }
]
```

- `key`: copied exactly from the survivor. Never invent one.
- `score`: an integer from 1 to 10.
- `rationale`: one sentence that points at something in `jd_text`.
- `red_flags_spotted`: short strings; an empty array if none.

Do not rewrite `survivors.json` and do not copy job text into `scores.json`.

## How to score

- 9-10: the candidate would apply today. Level, stack, location and pay (when
  stated) all fit the summary.
- 7-8: a good fit with no serious problem. Worth tailoring.
- 5-6: borderline. One real mismatch: level, a narrow stack, unclear scope.
- 3-4: weak. A major mismatch, but still eligible.
- 1-2: should not have passed the cheap filter. Name the red flag the profile
  is missing in the rationale, so the candidate can add it.

Compare pay with `comp_floor` only when the posting states pay. Unstated pay is
not a red flag.

## The rule you must not break

Score from the posting in front of you. A rationale may only cite what
`jd_text` says: never infer a salary, a location or a stack the text does not
state.

Rationales are read by the candidate: plain words, one sentence, no em or en
dashes.
