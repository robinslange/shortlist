---
name: shortlist-hunt
description: Use when the user asks to find new job openings or runs /shortlist-hunt. Runs the shortlist sourcing pipeline in their shortlist workspace and writes a dated digest. Never applies to anything.
---

# shortlist: hunt

Run every command from the user's shortlist workspace, the directory holding
`shortlist.yaml`. If you do not know where it is, ask.

1. `shortlist source`. Relay its one-line summary. Source errors do not stop
   the run; they are printed in the digest footer.
2. `shortlist score`. If it reports 0 survivors, skip to step 4.
3. Follow `prompts/01-score.md` in the workspace. It reads `survivors.json` and
   `profile.yaml` and writes `scores.json`.
4. `shortlist digest`. It prints the digest path.
5. Tell the user the digest path and how many roles are in each section. Tell
   them to tick `- [ ] tailor` on the roles they want and run
   `shortlist mark <digest>`.

Do not edit `profile.yaml` or `companies.yaml` yourself (`shortlist source`
writes detected `ats` and `slug` values on its own). If the scores look wrong,
say which profile field looks responsible and let the user change it.
