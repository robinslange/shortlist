---
name: shortlist-tailor
description: Use when the user wants to apply to a specific role, passes a job URL, or runs /shortlist-tailor. Builds an application folder with a tailored CV and cover letter, then has a fresh subagent verify every claim. Never submits anything.
---

# shortlist: tailor

Run every command from the user's shortlist workspace. The target is a job URL,
a key from a digest (the `<!-- key: ... -->` line), or `--last` for the most
recently shortlisted role.

1. `shortlist tailor init <target>`. It prints the application folder. If it
   says the folder already exists, stop and tell the user.
2. `shortlist voice pack > <folder>/voice.md`. Pass on any missing pack it
   names.
3. Follow `prompts/02-tailor-cv.md` against the folder.
4. `shortlist cv build <folder>`. A failed build is not fatal: report it and
   carry on.
5. Follow `prompts/03-cover-letter.md` against the folder.
6. `shortlist evidence bundle <folder>`.
7. Verify in a fresh context. Dispatch a general-purpose subagent with this
   prompt and nothing from this conversation:

   > Read `<workspace>/prompts/04-verify.md` and follow it exactly against
   > `<folder>/evidence/`. Write your report to `<folder>/verification.md`.
   > Do not edit any other file.

8. Read `<folder>/verification.md`.
   - READY: go to step 9.
   - NEEDS-FIXES: apply each proposed rewrite with the smallest edit that
     makes it, then repeat steps 4, 6 and 7. Stop after two rounds and report
     what is still open. Never declare READY yourself.
   - BLOCKED: stop and show the user the blocker.
9. `shortlist set <key> tailored`, with `key` from `<folder>/meta.json`.
10. Tell the user the folder path, whether the build worked, and the verdict.
    They review, edit and submit it themselves.
