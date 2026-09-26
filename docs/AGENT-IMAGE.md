# Persistent agent images, Atlas, live APIs, and Git

## What is saved

`TdAgentImage current` is a strong object reference saved inside the Pharo image. It holds:

- `TdStore`, runs, every imported session entry and branch, steps, requests, responses, tool calls/results, usage, errors, and divergence objects.
- The original session JSONL, runner events, stderr/stdout where present, verification results, metadata, reports, comparisons, and tape JSON as embedded file bytes.
- Final workspace files for each recorded run, under `snapshots/<runId>/`, even when the original worktree was deleted.
- Full Git bundles containing the task repository's refs and recorded checkpoints, including intermediate versions retained by Git.
- Archived task definitions, verifier scripts, task sources, and variant definitions under `catalog/`.
- In-image edited tapes. Exporting `agent archive` includes these edits, and saving the image preserves the live tape objects.

Files have byte sizes, SHA-256 hashes, and executable permission metadata. Binary files are retained as bytes, not converted to text. The runner archive defaults to **256 MiB of decoded file/bundle data** and fails rather than silently dropping oversized content. `TAPEDECK_ARCHIVE_MAX_BYTES` changes this limit. The Pharo file materializer currently caps embedded decoded payloads at 512 MiB; larger archives require extending that implementation too.

Transient worktree administration, active runs, symlinks/submodules, authentication stores, provider configuration directories, and known credential files are excluded or rejected. The known benchmark canary `.env` content is permitted; arbitrary `.env` secrets are not. An archive is not a general-purpose disk backup. Tool output can itself contain sensitive information; review traces before sharing them.

The image contains no deliberate credential fields or persistent HTTP clients. The runner reads credentials from its current process environment. Pharo reads its runner bearer token afresh for each request. Atlas credentials are removed from child tool/Git environments. This does not claim to scrub secrets a model or tool explicitly printed into the recorded trace.

## 1. Capture Agent.image

Install and verify the project:

```sh
npm ci
npm run fixtures
npm run typecheck
npm test
npm run test:image
```

The image build downloads Pharo 13 into `image/pharo/`, loads the source packages, saves `TapeDeck.image`, and runs SUnit tests. GT-specific tests skip in plain Pharo. Existing Pharo/GT runtimes can be used through `PHARO_VM` and `TAPEDECK_BASE_IMAGE`.

Start a runner on the store to capture:

```sh
node runner/src/cli.ts run --task t01 --variant vanilla --model scripted/toy
node runner/src/cli.ts serve --home ./store --host 127.0.0.1 --port 4777
```

After experiments finish, in another terminal:

```sh
TAPEDECK_RUNNER_URL=http://127.0.0.1:4777 \
  bash image/scripts/save-agent.sh agent-exports/Agent.image
```

This creates `Agent.image`, `Agent.changes`, and `Agent.archive.json`; the sidecar archive matches the captured image state. Pharo's `.sources` companion is copied when available. The script refuses to replace an existing image, changes file, or archive. Capture rejects running or changing run catalogs.

For an authenticated runner, export the same `TAPEDECK_API_TOKEN` into the runner and Pharo shell environments. Do not put it in an image object's instance variables or in a Git-tracked script.

## 2. Reopen with the original files gone

```sh
image/pharo/pharo agent-exports/Agent.image eval "TdAgentImage current store size"
```

On actual image resume, the registered startup hook writes embedded files to `Agent.files/` beside the image. This works without Atlas, the original store, or an HTTP server. Git bundles appear in `Agent.files/git-bundles/`; decoded run workspaces appear in `Agent.files/snapshots/`.

The loader validates hashes and paths, refuses symbolic-link destinations, and refuses to overwrite different existing contents. Identical files are safe to reopen repeatedly. Use an empty alternate destination if files were edited:

```sh
TAPEDECK_RESTORE_DIRECTORY=/absolute/new/agent-files \
  image/pharo/pharo agent-exports/Agent.image eval "TdAgentImage current lastError"
```

In a playground:

```smalltalk
agent := TdAgentImage current.
agent store runs.
agent store allToolCalls.
agent comparisons.
agent fileNames.
agent fileTextAt: 'snapshots/<runId>/src/sum.js'.
agent fileBytesAt: 'snapshots/<runId>/assets/example.bin'.
agent lastError.
```

Startup restoration performs **no model calls, cloud uploads, Git pushes, or network requests**. It is not a sandbox: a Pharo image is executable software, so open only trusted images.

To restore the complete runner store and Git repositories from the matching sidecar:

```sh
node runner/src/cli.ts restore --archive agent-exports/Agent.archive.json \
  --destination agent-exports/restored-store
node runner/src/cli.ts serve --home agent-exports/restored-store --port 4777
```

The destination must be absent, empty, or an empty runner-store directory structure. Restore stages and validates all data, then publishes the destination. Existing stores are never merged or overwritten. After starting a runner on an empty store, `agent restoreRunner` can alternatively send the embedded archive to that runner's `/api/agent/restore` endpoint; it does not accept an arbitrary destination from the client.

## 3. MongoDB Atlas placeholders

```sh
cp .env.example .env
```

Fill these values locally:

```dotenv
MONGODB_URI=mongodb+srv://REPLACE_USER:REPLACE_PASSWORD@REPLACE_CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DATABASE=tapedeck
TAPEDECK_ATLAS_BUCKET=agent_snapshots
```

Create an Atlas database user with access to the chosen database, allow your client through the project's IP access list or private networking, and use the cluster connection string. Percent-encode special username/password characters as required by MongoDB connection strings. Never commit `.env`. Placeholder or absent credentials fail clearly before a connection is attempted.

Atlas persistence uses the official MongoDB Node driver and **GridFS**, not the Data API. The `.image`, archive JSON, and optional `.changes`/`.sources` are separate streamed GridFS files, so a large image is not forced into one BSON document. A snapshot manifest records their immutable IDs, sizes, and hashes; it is published only after all uploads succeed. Failure triggers best-effort cleanup and never publishes a partial snapshot. A process crash can still leave unpublished blobs requiring administrative cleanup.

Publish a **closed, saved** image and its matching archive:

```sh
node --env-file=.env runner/src/cli.ts atlas-push \
  --image agent-exports/Agent.image --name my-agent
```

The matching `Agent.archive.json` and `Agent.changes` are discovered automatically. Add `--sources /path/to/Pharo.sources` to retain the VM source companion. `--archive FILE` supports an explicit sidecar. Do not upload an image while another VM is saving it.

List and retrieve:

```sh
node --env-file=.env runner/src/cli.ts atlas-ls
node --env-file=.env runner/src/cli.ts atlas-pull SNAPSHOT_ID \
  --destination agent-exports/downloaded
```

The returned JSON identifies the downloaded image under `downloaded/image/` and a ready runner store under `downloaded/store/`. Download validates every blob's size/hash before completing the restore. Start the runner against that store, then open the returned image path. Fill real credentials later; the application does not create an Atlas account, database user, or network rule for you.

Official references: [GridFS driver operations](https://www.mongodb.com/docs/drivers/node/current/crud/gridfs/) and [Atlas connection requirements](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).

## 4. Reconnect and compare live behavior

The Node runner must be installed/running for live provider calls and task execution. Inspecting saved trace objects and recovering embedded files does not require it. Reconnect uses a new HTTP client, never a socket captured in the image.

For built-in pi providers, set the relevant provider API-key environment variable and explicitly choose a `provider/model` identifier. For a compatible custom API:

```sh
cp config/models.example.json config/models.json
```

Replace the endpoint and model ID, leaving `apiKey` as `${LIVE_API_KEY}`. Set:

```dotenv
LIVE_API_KEY=REPLACE_WITH_REAL_KEY
TAPEDECK_MODELS_FILE=./config/models.json
TAPEDECK_LIVE_MODEL=live/REPLACE_MODEL_ID
```

The runner copies the models configuration into each run's isolated pi agent directory; that directory is excluded from archives. `config/models.json` is Git-ignored. Restart the runner after changing `.env`; `--env-file` reads it when the process starts.

```sh
node --env-file=.env runner/src/cli.ts serve --home agent-exports/restored-store
```

From the reopened image (with `TAPEDECK_RUNNER_URL` and optional `TAPEDECK_API_TOKEN` in the VM environment):

```smalltalk
agent := TdAgentImage current.
agent reconnect.
result := agent compareRun: '<baselineRunId>'
  variant: 'rule-taskrunner'
  model: 'live/REPLACE_MODEL_ID'.
agent comparisons.
agent store runs.
agent saveAs: '/absolute/path/ComparedAgent.image'.
```

Or from the CLI:

```sh
node --env-file=.env runner/src/cli.ts compare BASELINE_RUN_ID \
  --home agent-exports/restored-store --variant rule-taskrunner \
  --model live/REPLACE_MODEL_ID
```

A comparison contains three new experiments:

| Mode | Behavior | Calls a model provider? |
|---|---|---|
| Strict replay | Original harness, recorded responses, stubbed tool results | No |
| Fork | Reuses a prefix, then executes the requested model | Yes for a real provider |
| Fresh rerun | Starts the same task from its base using the requested model/variant | Yes for a real provider |

Model selection is required or taken from `TAPEDECK_LIVE_MODEL`; there is no silent fallback to a toy model. Fork defaults to step 1. `--auto` uses the variant's fork rule; if it produces no live continuation, the comparison retains that attempt and makes a forced-step-1 fork. `--at N` and `--lenient system` are explicit controls.

Comparisons store ordered response/tool/result differences, bounded excerpts, verdicts, usage, divergence, all run IDs, and artifact references. Full original traces are retained. The report is written under `comparisons/` and imported into the image after comparison. Partial failures remain inspectable as `status: partial`; reported usage does not necessarily include unsuccessful provider requests. Real comparisons can spend tokens and execute tools; only run them intentionally.

`PI_OFFLINE=1` in the runner disables pi startup network operations, not explicitly requested model inference. A local HTTP fixture test verifies real provider-protocol traffic and credential rotation; replay makes no provider request. `scripted/toy` remains the safe, deterministic offline option.

## 5. Connect checkpoints to Git

Git bundles retain original checkpoint commits and refs across archive/Atlas restore. Inspect them:

```sh
node runner/src/cli.ts git-status --home agent-exports/restored-store --task t01
```

Export a run's final checkpoint into a **new** branch in an existing local Git repository:

```sh
node runner/src/cli.ts git-export RUN_ID --home agent-exports/restored-store \
  --destination /absolute/path/to/repository --branch codex/agent-experiment
```

This transfers the checkpoint's Git history without changing the destination's HEAD, index, or working files. It refuses existing branches and histories containing known sensitive credential paths. Export is not a merge or rebase; review the new branch before integrating it into unrelated history.

To push that newly exported branch in the same operation, explicitly supply `--remote origin --push`. Remote URLs cannot be passed as a remote name; force pushes are not used. A failed push retains the new local branch and reports `push-failed`. Git export isolates global configuration; use an SSH agent or configure a credential helper in the destination repository itself when needed. Credentials are never embedded in the image.

For image-driven export, configure `TAPEDECK_GIT_DESTINATION` and optionally `TAPEDECK_GIT_REMOTE` on the Node runner, then:

```smalltalk
agent gitStatusForTask: 't01'.
agent exportRun: '<runId>' branch: 'codex/agent-experiment' push: false.
```

Images and bulk archives stay out of source Git by default. Store them in Atlas; Git tracks code and the explicit run-checkpoint branches you export.

## Validation and limits

```sh
npm run typecheck
npm test
npm run test:image
npm run test:agent-image
npm run demo
```

The image integration test starts a runner, saves a real `Agent.image`, deletes the original store, reopens the saved image, verifies restored file bytes and Git bundles, restores a separate runner store, reconnects from Pharo, and runs a comparison. The ordinary tests include a local provider-protocol HTTP server and failure/integrity cases for cloud storage.

For a real MongoDB/GridFS test against an explicitly chosen test database:

```sh
TAPEDECK_TEST_MONGODB_URI='mongodb://127.0.0.1:27017' \
  node --test runner/test/atlas.test.ts
```

The test creates a uniquely named GridFS bucket and removes only its own collections. Without this variable, that optional integration test skips. An Atlas deployment still needs its real credentials and network access; mock or local-Mongo tests do not establish access to your future Atlas cluster.

Keep the runner bound to loopback, or secure a remote deployment separately. The API can execute tools, consume model credits, restore files, and explicitly push Git branches. Worktrees isolate history, not operating-system privileges. Avoid capture during active CLI operations; a changed run catalog invalidates a capture. Restored traces use archived file bytes, while live reruns use the currently installed runner/task implementation; archived catalogs allow inspection of the original definitions.
