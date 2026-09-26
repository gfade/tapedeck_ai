# TapeDeck interfaces

This file is the contract between the three parts of TapeDeck. Anything that crosses a
boundary (a file, an environment variable, an HTTP call) is defined here. If code and this
file disagree, fix one of them in the same change.

```
 pi + pi-tape (TypeScript, runs inside pi)      runner (Node, TypeScript)         image (Pharo)
 ───────────────────────────────────────       ───────────────────────────       ─────────────────────
 records sessions as tapes (tape.* entries) ──▶ store/runs/<id>/session.jsonl ──▶ imports runs as objects
 replays a tape against a patched harness  ◀── spawns pi with PI_TAPE_* env   ◀── POST /api/forks etc.
 fetches tapes over HTTP (PI_TAPE_SOURCE)  ◀──────────────────────────────────── GET /tapes/<id>
```

Pinned versions: pi `@earendil-works/pi-coding-agent@0.87.1`, Node ≥ 22.18 (runs `.ts`
directly), Pharo 13 (also loads in Glamorous Toolkit, which is Pharo 12 based).

TypeScript rules for every `.ts` file in this repo, so both pi (jiti) and plain Node (type
stripping) can load it: erasable syntax only (no `enum`, no `namespace`, no parameter
properties), relative imports with an explicit `.ts` extension, `import type` for types.
Code under `pi-tape/src/` must not import pi packages at runtime (types only), so the runner
can import it without loading pi.

## 1. Vocabulary

- **Run**: one pi process working on one task with one harness variant.
- **Step**: one model request and its response. Step numbers start at 1. A step's tools are
  the tool calls in that response and their results.
- **Tape**: a run's recorded steps: normalized request, response, tool results and git
  snapshots. A session file with `tape.*` entries is a tape; so is the JSON form in §4.
- **Variant**: a harness configuration (extra prompt rules, a tool policy, extensions).
  `vanilla` is pi unchanged.
- **Replay** (tier 1, zero tokens): run pi with a variant against a tape. Recorded responses
  are played back, built-in tools return recorded results, nothing touches the model. Stops
  at the first divergence.
- **Fork** (tier 2): like replay, but at the divergence point the workspace is restored to
  the matching git snapshot and the run continues live on the real model.
- **Full rerun** (tier 3): an ordinary recorded run of the variant from scratch.
- **Divergence**: the first observable difference between the replay and the tape.

## 2. pi-tape (the pi package)

Entry point `pi-tape/extensions/tape.ts` (declared in `pi-tape/package.json` under `pi`).
The offline model lives in `pi-tape/extensions/scripted.ts` and is loaded separately with
`-e` when needed.

### 2.1 The `tape` provider

pi-tape registers provider `tape` with one model, `tape/main`. Every request to it goes
through pi-tape, which either plays back the tape or delegates to the real ("upstream")
model through `ctx.modelRegistry.streamSimple(upstreamModel, context, options)` (strip
`options.apiKey` so the registry resolves the upstream's own key). The recorded assistant
message is the upstream's message unchanged, so `provider`/`model` in the session are the
upstream's. pi-tape only works when `tape/main` is the selected model; with any other model
it stays inert and prints one notice.

`tape/main` mirrors the upstream model's metadata (context window, max tokens, reasoning,
input types, cost) when pi-ai's built-in catalog knows it (`getModel(provider, id)` from
`@earendil-works/pi-ai`), otherwise uses: contextWindow 200000, maxTokens 32000,
reasoning false, input text+image, cost 0.

### 2.2 Environment

| Variable | Values | Meaning |
|---|---|---|
| `PI_TAPE_MODE` | `record` (default), `replay`, `fork`, `off` | What pi-tape does |
| `PI_TAPE_UPSTREAM` | `provider/modelId`, e.g. `openrouter/anthropic/claude-sonnet-4.5`, `scripted/toy` | The real model. Split at the first `/`. Required for `record` and `fork` |
| `PI_TAPE_SOURCE` | path to a session `.jsonl`, a tape `.json`, or an `http(s)://` URL returning tape JSON | The tape to replay. Required for `replay` and `fork` |
| `PI_TAPE_FORK_AT` | integer ≥ 1 | Force the fork to go live at this step even if nothing diverged earlier |
| `PI_TAPE_LENIENT` | comma list; only `system` is defined | Before the fork point, ignore differences in system messages (prompt sections and tool declarations) when comparing requests |
| `PI_TAPE_REPORT` | file path | Write the report (§2.7) there when the run settles |
| `PI_TAPE_SNAPSHOTS` | `git` (default), `off` | Take git snapshots |
| `PI_TAPE_RESTORE` | `git` (default), `off` | Restore the workspace from snapshots in replay/fork |
| `PI_TAPE_LABEL` | text | Stored in the header, e.g. the variant name |

The scripted model reads `PI_SCRIPTED_MODEL` (§6).

### 2.3 Tool wrapping

pi-tape overrides the built-in tools that are active (by default `read`, `bash`, `edit`,
`write`; also `grep`, `find`, `ls` when active) by registering tools with the same name
built from pi's own definitions (`createBashToolDefinition(cwd)` etc., spread, with a
wrapped `execute`). The model must see byte-identical tool declarations and prompt sections
with and without pi-tape (except the `cwd` section): this is tested.

- **record**: execute the real tool, then take a snapshot, then record args and result.
- **replay/fork before divergence**: return the recorded result for this tool-call id
  (throw `new Error(text)` when the recorded result was an error: pi turns that into the
  same `{content:[{type:"text",text}], details:{}, isError:true}`), no side effects.
- **after divergence (fork)**: execute for real, snapshot, record.

Tools pi-tape cannot wrap (tools registered by other extensions) would run for real during
replay. pi-tape treats a call to such a tool as a divergence (`tool-unwrapped`) in its
`tool_call` handler, before it executes: in fork mode it restores the workspace and goes
live; in replay mode it blocks the call.

Other extensions must not override the built-in tools; guards use `tool_call` hooks. The
runner loads pi-tape last (`-e` order) so its tool registrations win.

### 2.4 Normalization

Requests are compared and stored in a normalized form. Input: `TranscriptContext.messages`
as the provider receives them.

1. Substitute, in every string at any depth: the session's working directory → `<cwd>`,
   and pi's package directory (`getPackageDir()`) → `<pi>`. Longest source first.
2. Map each message:
   - `system` → `{role, content: <text>, sections?: [[name, value|null], ...] (order kept),
     toolsAdded?: [{name, description, parameters, constrainedSampling?}] (a JSON round-trip,
     which drops `undefined` and symbol keys, as pi-ai's `toToolDeclaration` does),
     toolsRemoved?: [name], replace?: true}`
   - `user` → `{role, content: [block]}`; a string becomes `[{type:"text",text}]`; an image
     becomes `{type:"image", mimeType, sha256}`
   - `assistant` → `{role, content: [block]}` with blocks `{type:"text",text}`,
     `{type:"thinking",thinking}` (plus `redacted:true` if set), and
     `{type:"toolCall",id,name,arguments}`. Signatures, usage, ids, timestamps are dropped.
   - `toolResult` → `{role, toolCallId, toolName, isError, content: [block]}`
   - anything else → `{role, content: <text>}`
3. Canonical JSON: object keys sorted, arrays in order, no whitespace, `JSON.stringify`
   numbers. `requestHash` = lowercase hex SHA-256 of the canonical JSON of the whole list.

When pi-tape emits recorded data into a live run (responses, stubbed tool results) it
rewrites the recorded cwd to the live cwd in every string, so a forked model never sees the
old worktree's paths.

### 2.5 Session entries written by pi-tape

pi-tape writes pi `custom` entries (they never reach the model). Exact field names:

**`tape.header`** — exactly one, before the first `tape.step`.

```json
{"type":"custom","customType":"tape.header","data":{
  "v":1, "mode":"record", "label":"vanilla", "cwd":"/abs/work/dir", "piVersion":"0.87.1",
  "upstream":{"provider":"scripted","model":"toy"},
  "snapshotBase":"<commit sha|null>", "refPrefix":"refs/tapes/<sessionId>",
  "source":null, "forkAt":null, "lenient":[]
}, "id":"…", "parentId":"…", "timestamp":"…"}
```

In replay/fork, `source` is `{"kind":"session"|"tape"|"url", "location":"…", "tapeId":"…|null", "steps":<n>}`.

**`tape.step`** — one per completed model response, written at that turn's `turn_end`
(as a boundary entry), so it follows the turn's tool results.

```json
{"type":"custom","customType":"tape.step","data":{
  "v":1, "step":3, "live":true,
  "responseEntryId":"fc585adf",
  "request":{"keep":4, "append":[ <normalized message>, … ]},
  "requestHash":"<sha256 hex>",
  "tools":[
    {"id":"toy_3_0", "name":"bash", "args":{"command":"npm test"}, "exec":"real",
     "resultEntryId":"a7aa1fd2", "isError":true, "snapshot":"<commit sha|null>"}
  ],
  "snapshotAfter":"<commit sha|null>",
  "usage":{ <the response's usage object> }
}}
```

- `request` is a delta: step k's full request = step k-1's full request, first `keep`
  messages, then `append`. Step 1 has `keep: 0`.
- `live`: the response came from the upstream model (always true in record mode).
- `exec`: `real` (the wrapper executed it), `stub` (recorded result returned), `none` (pi
  answered without executing: blocked by a `tool_call` hook, unknown tool, invalid args).
- `args`: the arguments the tool actually ran with (after `tool_call` mutations); for
  `exec: none`, the model's arguments.
- `snapshot`: workspace after this tool; `snapshotAfter`: after the whole step.
- Failed responses (`stopReason` `error`/`aborted`) are not steps.

**`tape.divergence`** — at most one, when replay/fork diverges.

```json
{"type":"custom","customType":"tape.divergence","data":{
  "v":1, "step":4, "kind":"context", "toolId":null, "at":"request",
  "detail":{"index":7, "path":"content[0].text", "recorded":"…", "live":"…"},
  "restoredSnapshot":"<sha|null>", "action":"live"
}}
```

`kind`: `context` (request differs), `tool-args` (a tool ran with different args),
`tool-blocked` (recorded as executed, now answered without executing), `tool-unblocked`
(recorded `exec: none`, now executed), `tool-unknown` (tool call not on the tape),
`tool-unwrapped` (a tool pi-tape cannot stub), `forced` (`PI_TAPE_FORK_AT` reached),
`tape-end` (pi asked for more steps than the tape has), `early-end` (the run ended before
the tape did). `at`: `request`, `tool`, or `turn`. `action`: `live` (fork) or `stop`
(replay). `recorded`/`live` strings are truncated to 500 characters.

**`tape.report`** — the report of §2.7, written at `agent_before_settle` (last one wins).

### 2.6 Git snapshots

A snapshot is a commit of the whole working tree (tracked + untracked, not ignored files)
made through a temporary index, so it never touches `HEAD`, the real index, or any branch:

```
GIT_INDEX_FILE=<tmp copy of the index> git add -A
tree=$(GIT_INDEX_FILE=<tmp> git write-tree)
commit=$(git commit-tree $tree -p <previous snapshot> -m "tape <sessionId> step 3 tool 1")
git update-ref refs/tapes/<sessionId>/s3-t1 $commit
```

Use a fixed author/committer (`tapedeck <tapedeck@localhost>`) and the `GIT_*_DATE` of the
event so commits are reproducible enough. Refs: `…/base` (before any tool runs, taken at
the first request), `…/s<step>-t<n>` (after tool n, 1-based), `…/s<step>` (after the step).
If the working directory is not a git repository, snapshots are `null` and fork mode
reports an error instead of restoring.

Restore (replay/fork, in a disposable worktree):

```
git read-tree --reset -u <commit>
git clean -fdq
```

Ignored files are neither saved nor restored. Keep task repos free of ignored state that
matters.

### 2.7 Replay and fork semantics

State: `i` = the next tape step. For each model request while not diverged:

1. If `i` > tape length → divergence `tape-end`.
2. If `PI_TAPE_FORK_AT` = `i` → divergence `forced`.
3. Compare the live normalized request with the tape's request for step `i` (with
   `PI_TAPE_LENIENT=system`, drop system messages from both first). First difference →
   divergence `context`, with the index and the path of the first differing field.
4. Otherwise emit the tape's response for step `i` (cwd rewritten, cost fields set to 0,
   token counts kept so pi's compaction thresholds behave as recorded), `live: false`.

Tool events are checked as they happen: a wrapper call whose id is on the tape with equal
normalized args returns the recorded result; different args → `tool-args`; id not on the
tape → `tool-unknown`; recorded `exec: none` → `tool-unblocked`. A `tool_execution_end`
for a tool the wrapper never saw, which the tape recorded as `exec: real` → `tool-blocked`
(pi runs every `tool_call` hook of a batch before executing any of it, so this is known
before later tools of the batch execute).

On divergence:

- **fork**: restore the workspace to the snapshot after the last tool that matched the tape
  (the base snapshot if none), write `tape.divergence`, then go live: the current request is
  delegated upstream, the current tool executes for real, and every later request and tool
  is live. Steps after this point are recorded like record mode.
- **replay**: write `tape.divergence`; a pending tool call returns the error
  `[tape] replay stopped at divergence`; the next request is answered with a final text
  message `[tape] diverged at step N (kind): …` (`stopReason: "stop"`, zero usage) so pi
  settles. That synthetic message is not a step.

In replay and fork, replayed steps are written as `tape.step` entries too (`live: false`,
tools `exec: "stub"`, snapshots copied from the tape), so every session pi-tape writes is
itself a complete tape that can be replayed or forked again.

When a replay or fork ends without diverging and the tape has no more steps, pi-tape
restores the tape's final `snapshotAfter`, so the workspace matches the recording's end
state and the verifier sees the same thing. If it ends early → `early-end`.

**Report** (`PI_TAPE_REPORT` file and `tape.report` entry):

```json
{
  "format":"tapedeck.report/v1", "mode":"fork", "label":"rule-taskrunner",
  "sessionId":"…", "sessionFile":"/abs/….jsonl",
  "source":{"kind":"session","location":"…","tapeId":null,"steps":6},
  "forkAt":4, "lenient":["system"],
  "steps":{"replayed":3, "live":2, "total":5},
  "divergence":{ <same object as tape.divergence data> } | null,
  "usage":{
    "live":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":0},
    "replayed":{ <recorded usage of the replayed steps: tokens not spent again> }
  },
  "snapshots":{"base":"<sha|null>", "final":"<sha|null>"},
  "finalRestore":"<sha|null>",
  "errors":[]
}
```

`usage.*.cost` is the dollar total (`usage.cost.total` summed).

## 3. Session files

A pi session file (JSONL, pi's v3 format) with the entries of §2.5. The runner stores it as
`store/runs/<runId>/session.jsonl`. Readers take the active branch: start from the last
entry in the file and follow `parentId` to the root. Useful pi entry types: `session`
(header line, no id), `message` (roles `system`, `user`, `assistant`, `toolResult`),
`model_change`, `thinking_level_change`, `custom`, `custom_message`, `compaction`,
`context_edit`, `label`, `session_info`. System messages carry `sections`, `toolsAdded`,
`toolsRemoved`; replaying them in order gives the harness state at any point.

## 4. Tape JSON (`tapedeck.tape/v1`)

The self-contained, editable form. pi-tape reads it (file or URL); the runner derives it
from a session (`GET /api/runs/<id>/tape`); the image edits and serves it.

```json
{
  "format":"tapedeck.tape/v1",
  "id":"<runId or any string>",
  "sessionId":"…|null", "sourceSession":"<path|null>",
  "cwd":"/abs/recorded/cwd",
  "upstream":{"provider":"…","model":"…"} | null,
  "snapshotBase":"<sha|null>",
  "steps":[
    {
      "step":1, "live":true,
      "request":[ <normalized message>, … ],
      "requestHash":"<sha256 hex>",
      "response":{ <assistant message as recorded, including usage> },
      "tools":[
        {"id":"toy_1_0","name":"bash","args":{"command":"ls"},"exec":"real",
         "result":{"content":[{"type":"text","text":"…"}],"details":null,"isError":false},
         "snapshot":"<sha|null>"}
      ],
      "snapshotAfter":"<sha|null>"
    }
  ],
  "edits":[{"step":3,"toolId":"toy_3_0","field":"args","note":"…"}]
}
```

`request` is the full normalized request (not a delta). `requestHash` may be stale after an
edit; pi-tape compares `request` arrays, never hashes. An edit that changes a tool call must
change both `response.content[…].arguments` and `tools[…].args`.

## 5. Runner

TypeScript run directly by Node (`node runner/src/cli.ts …`, bin `tapedeck`).

### 5.1 Store layout (`TAPEDECK_HOME`, default `<repo>/store`)

```
store/
  repos/<taskId>.git           bare repo per task; its first commit is the task base
  work/<runId>/                disposable worktree of that repo (deleted unless --keep)
  runs/<runId>/
    run.json                   summary (§5.2)
    session.jsonl              pi session (a tape)
    events.jsonl               pi --mode json stdout
    stderr.log
    tape-report.json           pi-tape report
    verify.json                {"exitCode":0,"pass":true,"output":"<tail>","durationMs":12}
    agent/                     isolated PI_CODING_AGENT_DIR
  tapes/<id>.json              tapes posted inline for replay
  reports/<name>.json          gate reports (§5.4)
```

Snapshots are commits in `repos/<taskId>.git`, shared by every worktree of the task, so a
fork can restore any snapshot of any earlier run of the same task.

### 5.2 `run.json` (`tapedeck.run/v1`)

```json
{
  "format":"tapedeck.run/v1",
  "id":"20260926-153012-t01-vanilla-run-a1b2",
  "kind":"run" | "fork" | "replay",
  "task":"t01", "split":"held-in" | "held-out",
  "variant":"vanilla", "model":"scripted/toy",
  "parent":null | "<runId>", "forkAt":null | 4, "lenient":[], "tapeSource":null | "<path or URL>",
  "status":"running" | "done" | "error", "error":null | "…",
  "startedAt":"ISO-8601", "finishedAt":"ISO-8601", "durationMs":1234,
  "pass":true | false | null,
  "verify":{ …verify.json… } | null,
  "steps":{"total":5, "replayed":3, "live":2},
  "usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":0},
  "savedUsage":{ …same shape: recorded usage of replayed steps… },
  "divergence":null | { …tape.divergence data… },
  "snapshotBase":"<sha>", "snapshotFinal":"<sha|null>",
  "sessionFile":"runs/<id>/session.jsonl",
  "reportFile":"runs/<id>/tape-report.json",
  "repo":"repos/t01.git"
}
```

`usage` counts only what this run spent live. `pass` is `null` for replays (no verdict).
Paths are relative to the store. IDs sort by time.

### 5.3 How the runner starts pi

```
cwd:   store/work/<runId>            (git worktree of repos/<task>.git at the task base)
stdin: /dev/null                     (pi waits on an open stdin pipe)
env:   PI_CODING_AGENT_DIR=store/runs/<runId>/agent  PI_OFFLINE=1  PI_SKIP_VERSION_CHECK=1
       PI_TELEMETRY=0  PI_TAPE_*  TAPEDECK_TASK=<taskId>  TAPEDECK_VARIANT=<abs variant.json>
       PI_SCRIPTED_MODEL=<abs runner/bench/toy-model.mjs> (scripted model only)
       plus provider keys from the runner's environment (OPENROUTER_API_KEY, …)
argv:  node <pi cli> --mode json --no-extensions --no-skills --no-prompt-templates
       --no-themes --session-dir store/runs/<runId>/pi-sessions --model tape/main
       [-e pi-tape/extensions/scripted.ts]  -e runner/harness/variant.ts  -e pi-tape/extensions/tape.ts
       "<task prompt>"
```

After pi exits, the runner moves the session file to `runs/<runId>/session.jsonl`, runs the
verifier (outside pi, cwd = worktree, 60 s timeout), and writes `run.json`.

### 5.4 Gate report (`tapedeck.gate/v1`)

```json
{
  "format":"tapedeck.gate/v1", "name":"rule-taskrunner-vs-vanilla",
  "candidate":"rule-taskrunner", "baseline":"vanilla", "model":"scripted/toy",
  "createdAt":"ISO-8601",
  "rows":[{
    "task":"t01", "split":"held-in",
    "baselineRun":"<id>", "baselinePass":false,
    "forkRun":"<id>", "forkPass":true, "forkAt":4, "divergence":{…}|null,
    "forkUsage":{…}, "savedUsage":{…},
    "rerunRuns":["<id>","<id>"], "rerunPass":[true,true], "rerunUsage":{…summed…},
    "agree":true
  }],
  "summary":{
    "n":6, "agreement":0.83,
    "forkTokens":1200, "rerunTokens":5400, "forkCost":0.01, "rerunCost":0.05, "tokenSavings":0.78,
    "baselinePassRate":{"held-in":0.0,"held-out":0.33},
    "candidateForkPassRate":{"held-in":1.0,"held-out":0.67},
    "candidateRerunPassRate":{"held-in":1.0,"held-out":0.67}
  }
}
```

`agree` is true when the fork's verdict equals the majority verdict of the reruns.

### 5.5 HTTP API (default `http://127.0.0.1:4777`, JSON unless noted)

| Method | Path | Body / result |
|---|---|---|
| GET | `/api/health` | `{"ok":true,"version":"0.1.0","pi":"0.87.1","store":"/abs/store"}` |
| GET | `/api/tasks` | `[{"id","title","split","quirk","prompt"}]` |
| GET | `/api/variants` | `[{…variant.json…}]` |
| GET | `/api/runs` | `[run.json…]`, newest first; `?task=&variant=&kind=` filters |
| GET | `/api/runs/:id` | run.json plus `"report"` (tape report) |
| GET | `/api/runs/:id/session` | the session JSONL (`application/x-ndjson`) |
| GET | `/api/runs/:id/tape` | tape JSON (§4) |
| POST | `/api/runs` | `{"task","variant","model"?,"async"?}` → run.json (or `{"id","status":"running"}` when async) |
| POST | `/api/forks` | `{"from":runId,"variant","forkAt"?,"lenient"?,"auto"?,"tape"?,"tapeUrl"?,"async"?}` → run.json. `auto: true` computes `forkAt` from the variant's fork rule |
| POST | `/api/replays` | `{"from":runId,"variant","tape"?,"tapeUrl"?}` → run.json of the replay (kind `replay`) |
| POST | `/api/gate` | `{"baseline","candidate","repeat"?,"tasks"?,"async"?}` → gate report |
| GET | `/api/reports` | list of gate report names; `/api/reports/:name` → report |
| GET | `/` | dashboard (static HTML) |

`tape` is an inline tape JSON object; `tapeUrl` is passed through to pi-tape as
`PI_TAPE_SOURCE`. Errors: HTTP 4xx/5xx with `{"error":"…"}`.

### 5.6 Variants (`runner/bench/variants/<name>/variant.json`)

```json
{
  "name":"rule-taskrunner",
  "description":"Prompt rule: run tests with the repo's task runner, never npm test.",
  "rules":["Run tests with the repository's task runner (./tasks test). Never run npm test."],
  "policy":{"denyCommands":["^npm (test|run test)"], "denyPaths":["(^|/)\\.env$"]},
  "fork":{"lenient":["system"], "at":{"tool":"bash","argMatches":{"command":"^npm "}}}
}
```

`rules` become one prompt section named `tapedeck-rules`; `policy` becomes a `tool_call`
gate (blocked calls return `Blocked by tapedeck policy: <rule>`). Both are applied by
`runner/harness/variant.ts`, which reads `TAPEDECK_VARIANT`. `fork` says how to fork a
baseline tape for this variant: the fork goes live at the first step whose response has a
tool call matching `at` (`argMatches` values are regexes against the stringified argument);
if nothing matches, the fork relies on natural divergence only.

## 6. Scripted model

`pi-tape/extensions/scripted.ts` registers `scripted/toy`. `PI_SCRIPTED_MODEL` names a JS
module whose default export is:

```ts
(req: {
  step: number;               // assistant messages in the request + 1
  systemPrompt: string;       // rendered current system prompt
  tools: string[];            // current tool names
  messages: (
    | { role: "user"; text: string }
    | { role: "assistant"; text: string; toolCalls: { id: string; name: string; arguments: object }[] }
    | { role: "toolResult"; toolCallId: string; toolName: string; text: string; isError: boolean }
  )[];
  cwd: string;
  env: Record<string, string | undefined>;
}) => { text?: string; thinking?: string; toolCalls?: { name: string; arguments: object; id?: string }[] }
```

Tool-call ids default to `toy_<step>_<n>`. Usage is estimated at 4 characters per token
(cwd replaced by `<cwd>` first, so it is the same in every worktree) and priced at the
model's rates ($3 / $15 per million input / output tokens).

## 7. Image (Pharo)

Package prefix `Td`, baseline `BaselineOfTapeDeck`, Tonel sources in `image/src`.

- Imports a runner store from disk (`TdStore fromDirectory: '/abs/store'`) or over HTTP
  (`TdRunnerClient new baseUrl: 'http://127.0.0.1:4777'`), parsing `run.json`,
  `session.jsonl` and `tape-report.json`.
- Talks to the runner only through §5.5.
- Serves JSON on `http://127.0.0.1:4778`:

| Method | Path | Result |
|---|---|---|
| GET | `/health` | `{"ok":true,"runs":<n>}` |
| GET | `/runs` | `[{"id","task","variant","kind","pass","steps","tokens","cost"}]` |
| GET | `/runs/<id>/timeline` | `[{"step","live","tools":[{"name","summary","exec","isError"}],"tokens","cost"}]` |
| GET | `/tapes/<id>` | tape JSON (§4), including edits made in the image |
| GET | `/comparisons` | the image's comparison table as a gate report (§5.4 shape: `rows` and `summary`); by default one row per fork held in the image |
