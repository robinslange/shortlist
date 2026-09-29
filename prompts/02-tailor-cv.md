# Tailor the CV

Run this after `shortlist tailor init` and `shortlist voice pack`, against one
application folder.

## Input

In the application folder:

- `meta.json`: `cv_source` names the CV file in this folder.
- That CV file: a copy of the master CV. You edit this copy. The master stays
  where `shortlist.yaml` says and is never touched.
- `jd-snapshot.md`: the posting as fetched.
- `voice.md`: the voice rules.

## Output

The same CV file, edited in place, in the format it already uses (Typst, LaTeX,
Markdown, plain text). Keep every structural element the build depends on:
variable names, imports, section markers. Write nothing else, and add no
commentary to the file.

What you may change:

- Reorder bullets and sections so the most relevant work leads.
- Reword a bullet slightly so it reads well next to its new neighbours.
- Drop bullets that do not help this application, if the format has a length
  limit.
- Swap the headline or summary only if the posting clearly calls for a
  different framing that is also true of the candidate. The default is to keep
  it.

Any reworded line follows `voice.md`.

## The rule you must not break

Every claim in the tailored CV comes from the master, verbatim or as a minor
rewording. Never add a skill, tool, metric, date or responsibility the master
does not state. If the posting asks for something the master does not claim,
leave it out of the CV; the cover letter handles gaps.

The trap is keyword back-projection: taking a word from the posting and
attaching it to work that is adjacent but different. If a posting keyword does
not already appear in the master's description of that work, do not add it. A
fresh verifier checks every claim against the master and the candidate's
repositories next, and each overclaim it finds costs a round of fixes.
