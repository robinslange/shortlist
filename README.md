# shortlist

Find roles at the companies you want to work for, tailor a CV and cover letter
to one of them, and have a second agent check every claim before you send
anything.

shortlist is a command-line tool plus four prompt files. The tool does
everything that does not need a language model: reading job boards, filtering,
deduplicating, building folders. The prompts are the four steps that do, and
any agent can run them: Claude Code, Codex, Cursor, Aider, or a chat window you
paste into.

It works for you, not for employers. There is no account and no telemetry, and
it never submits an application. Everything it writes stays on your disk.

## Why it exists

**Most companies publish their jobs as JSON.** Ashby, Lever, Greenhouse,
Workable, BambooHR, Teamtailor, Recruitee, SmartRecruiters, Personio and
Workday all serve public job listings. Point shortlist at a list of companies
and it reads their boards directly instead of waiting for a job board to carry
the role.

**Filtering is free; judging is not.** A deterministic filter built from your
profile rejects most roles before a model sees them, so model cost scales with
the shortlist, not the longlist.

**The drafter cannot check its own work.** An agent that has read a job posting
is under pressure to make your experience sound like what the posting asks for.
It reaches for the posting's keywords and attaches them to work that is
adjacent but different, and it cannot see this in its own draft because it
already believes the framing. So a second agent, in a fresh context, checks
every claim in the letter and the CV against your master CV and the
repositories you name, and returns READY, NEEDS-FIXES or BLOCKED.

## Install

You need Node 20 or later and a POSIX shell (macOS, Linux, or WSL on Windows).

```sh
git clone https://github.com/robinslange/shortlist.git
cd shortlist
npm install && npm run build && npm link
shortlist init ~/job-search
cd ~/job-search
```

`init` copies a working example into the folder: a config, a profile, a
company list, a sample CV, the four prompts and the default voice rules. It
never overwrites a file, so it is safe to run again after an upgrade to pick up
new prompts. The example runs as it is, so you can try the whole pipeline
before changing anything.

Then make it yours:

- `profile.yaml`: who you are, the kinds of role you want, and what rules a
  role out. The comments at the top explain how terms match.
- `companies.yaml`: the companies you want to work for. Give each a
  `careers_url`; with a fetcher configured, `shortlist source` works out which
  ATS it uses and writes that back.
- `cv/cv.md`: replace the sample with your own CV, in any text format.
- `shortlist.yaml`: where your CV is, and optionally how to build it.

## The pipeline

Every step reads files and writes files, so you can stop anywhere, look at or
edit what it wrote, and carry on.

```
shortlist source                        -> candidates.json, sources.json
shortlist score                         -> survivors.json
  agent: prompts/01-score.md            -> scores.json
shortlist digest                        -> digests/YYYY-MM-DD.md
  you tick the roles you want
shortlist mark <digest>

shortlist tailor init <url|key|--last>  -> applications/<date>-<company>-<role>/
shortlist voice pack > <folder>/voice.md
  agent: prompts/02-tailor-cv.md        -> the tailored CV
shortlist cv build <folder>             -> your built CV
  agent: prompts/03-cover-letter.md     -> cover-letter.md
shortlist evidence bundle <folder>      -> <folder>/evidence/
  fresh agent: prompts/04-verify.md     -> verification.md
shortlist set <key> tailored
```

`shortlist <command> --help` explains each command, and `source` and `score`
print a line per company and page as they go.

Each digest carries only roles the model has not scored before, so running the
pipeline daily gives you the new roles, not the same list again. A role the
model scores below 5 is skipped for 30 days, then comes back in case it has
changed. `tailor init --last` picks the most recently ticked role that has no
application folder yet.

## Hooking up your agent

- **Claude Code:** copy the two folders in `adapters/claude-code/` into
  `~/.claude/skills/`. They run the verifier as a subagent with a clean
  context.
- **Anything that reads `AGENTS.md`** (Codex, Cursor and others): copy
  `adapters/agents-md/AGENTS.md` into your workspace. Where the harness cannot
  start a fresh context, it asks you to open a new session for the verifier.
- **A plain chat window:** run the commands yourself and paste each prompt with
  the files it names.

## Configuration

`shortlist.yaml` holds three escape hatches, all shell commands or paths:

- `fetch`: a command that prints the page at `$URL`. The example uses `curl`.
  Use a browser-based fetcher if a site blocks it. Each page gets 60 seconds. Without `fetch`, the ATS
  APIs still work; ATS detection, Seek and `tailor init` report that no
  fetcher is configured.
- `cv.source` and `cv.build`: your master CV, and a command run inside each
  application folder with `$SOURCE` and `$FOLDER` set. Typst, LaTeX, pandoc,
  anything. Without `cv.build`, the tailored source file is the deliverable.
- `evidence.repos`: directories the verifier may read as ground truth.

Values are passed to your commands as environment variables, never pasted into
the command text, so a URL from a job board cannot run shell code.

`profile.yaml` drives the free filter that runs before any model sees a role.
Every term matches whole words and their common endings, ignoring case:
`engineer` matches "engineers" and "engineering", while `api` does not match
"capital" and a red flag of `java` does not reject JavaScript roles. End a term
with `*` to match any word that starts with it: `dev*` matches "developer" and
"devops". `locations.accept` keeps only roles whose location names one of
your places; `locations.reject` drops any role that mentions one of its terms.

`voice/default/` holds six rules for prose that does not read as
machine-written. Put your own in `voice/yours/`.

## Seek

The Seek adapter reads Seek's public search and job pages. Seek's terms of
service restrict automated access. The adapter is here for one person looking
for their own next job at a human pace: one request every 750 to 1000
milliseconds, one run when you ask for it. That delay is a constant in the
code, not a setting. Whether to use the adapter is your call; leave
`boards.seek` empty in `profile.yaml` and it never runs.

## Privacy

The shortlist CLI sends nothing anywhere except requests to the job boards and
the fetch command you configure. Your agent is a different matter: when it
runs a prompt, your CV, your profile and your voice rules go to whichever model
the agent uses, under that provider's terms.

## License

Apache 2.0. See `LICENSE`.
