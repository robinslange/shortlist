# shortlist

This workspace runs shortlist, a job-search pipeline. The `shortlist` command
does everything deterministic; the files in `prompts/` are the steps that need
you. Run every command from this directory. Never submit an application: the
pipeline stops at files on disk for the user to review.

## Finding roles

1. `shortlist source`
2. `shortlist score`
3. Follow `prompts/01-score.md`. It writes `scores.json`.
4. `shortlist digest`, then tell the user the digest path. They tick
   `- [ ] tailor` on the roles they want and run `shortlist mark <digest>`.

## Tailoring one application

1. `shortlist tailor init <url|key|--last>`. It prints the folder.
2. `shortlist voice pack > <folder>/voice.md`
3. Follow `prompts/02-tailor-cv.md` against the folder.
4. `shortlist cv build <folder>` (a failed build is not fatal).
5. Follow `prompts/03-cover-letter.md` against the folder.
6. `shortlist evidence bundle <folder>`

## Verification needs a fresh context

You drafted the letter, so you cannot verify it: you already believe its
framing. If your harness can start a subagent with an empty context, give it
only this instruction. Otherwise stop here and ask the user to open a new
session in this directory and paste it:

> Follow `prompts/04-verify.md` against `<folder>/evidence/` and write
> `<folder>/verification.md`.

When the report comes back:

- READY: run `shortlist set <key> tailored` with the key from
  `<folder>/meta.json`, and tell the user the folder is ready for their review.
- NEEDS-FIXES: apply the rewrites, repeat steps 4 and 6, and verify again in a
  fresh context. Stop after two rounds and report what is still open.
- BLOCKED: show the user the blocker and stop.
