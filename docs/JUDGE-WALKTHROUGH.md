# MongoDB hackathon judge walkthrough

## The pitch

TapeDeck makes a coding-agent experiment recoverable. It saves recorded behavior and file state inside a Pharo image, persists the image in MongoDB Atlas, and lets a developer compare a live alternative against the recorded run.

The distinction to demonstrate is **strict replay versus a live fork**. Replay uses recorded responses without inference. A fork reuses a chosen prefix and then asks a real model to continue. Neither operation turns a probabilistic model into a deterministic model.

Use `presentation/TapeDeck-MongoDB-Hackathon.pptx` for the five-slide, 60-second pitch and `presentation/PITCH-SCRIPT.md` for the timed speaker notes. `docs/demo-evidence.json` contains measured results and links each result to its run ID.

## Before going on stage

1. Download Qwen3.5 2B and run `npm run demo:local` in advance. A full experiment includes several real agent runs; the 60-second pitch presents their measured results instead of waiting on stage.
2. Keep the generated `results.json`, runner store, saved `Agent.image`, and Atlas verification report available locally.
3. Check `ollama list` and the Node version. Use Node 22.19+.
4. Confirm Atlas allows the current client IP. A network/VPN change can interrupt a transfer.
5. Keep `.env` and any credential displays off the projector. Never put credentials into slides, screenshots, or source Git.
6. Keep a second terminal ready for the short replay command. Preload the relevant model if you plan an optional live fork.

## 60-second narrative

| Time | What to show | What it proves |
| --- | --- | --- |
| 0:00–0:10 | The recovery problem | A transcript alone leaves file and checkpoint recovery work |
| 0:10–0:25 | Real Qwen3.5 2B outcomes | Live tool use and zero model requests during strict replay |
| 0:25–0:40 | MongoDB Atlas architecture | GridFS stores image companions with a checksummed manifest |
| 0:40–0:52 | Atlas round-trip evidence | Downloaded hashes match and the saved image reopens |
| 0:52–1:00 | The ask | Try a recoverable experiment with your agent |

## Optional live terminal demonstration

Set `DEMO` to a completed real-model demo directory. Use its recorded baseline ID:

```sh
DEMO=agent-exports/judge-demo-2b
BASELINE=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).results[0].baseline.id' "$DEMO/results.json")
TAPEDECK_MODELS_FILE="$PWD/config/models.ollama.json" \
  node runner/src/cli.ts replay "$BASELINE" --variant vanilla \
  --home "$DEMO/store" --json
```

Show the replay's live steps and new token usage, both zero. The measured demo's independent `provider-requests.jsonl` also contains no requests in its replay phase. A replay's `pass` field is `null`: TapeDeck does not claim a fresh test-verifier verdict.

Show a recorded comparison instead of waiting for a new experiment:

```sh
node -e 'const result=JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); for(const row of result.results) console.log(JSON.stringify({model:row.model,baseline:row.baseline.pass,fork:row.fork.pass,rerun:row.rerun.pass,replayCalls:row.replay.providerRequests,comparison:row.comparisonId},null,2))' "$DEMO/results.json"
```

Inspect the saved image:

```sh
image/pharo/pharo "$DEMO/Agent.image" eval \
  "{ TdAgentImage current store size. TdAgentImage current fileNames size. TdAgentImage current lastError }"
```

The final value should be `nil` for a successful materialization. If someone edited the already-restored files, use a new `TAPEDECK_RESTORE_DIRECTORY` instead of overwriting their changes.

## Atlas proof

In Atlas Data Explorer, open database `tapedeck` and inspect:

- `agent_snapshots_manifests`: snapshot identity and each companion's SHA-256 and byte size.
- `agent_snapshots.files`: image, archive, changes, and source companion metadata.
- `agent_snapshots.chunks`: the actual GridFS payload chunks.

Use the snapshot ID in `docs/demo-evidence.json`. The recorded cloud proof includes a download into a new destination, independent checksum comparisons, reopening a copy of the downloaded image, and checksum comparisons for every materialized file and Git bundle.

**Keep the two proofs separate:** the Qwen image contains 4 runs, 76 embedded files, and 1 Git bundle and is verified locally. The earlier Atlas snapshot contains 32 runs, 491 files, and 6 Git bundles. The new Qwen image upload was blocked by an Atlas connection failure. Slide 4 labels the prior snapshot explicitly; do not imply it contains the new Qwen runs. After Atlas connectivity is restored, use the README upload/download commands with `agent-exports/judge-demo-2b/Agent.image` and verify the new snapshot before updating this claim.

The MongoDB contribution is durable snapshot storage and integrity-checked recovery. Vector search, cross-run semantic search, and richer metadata queries are possible future extensions, not implemented features to claim on stage.

## Questions judges may ask

**Are these real model runs?** Yes when the evidence lists the Qwen model digests, local Ollama version, and measured requests. `npm run demo` is a separate scripted fallback and must be described as such.

**Does replay spend inference tokens?** Strict replay does not call the model provider. It still consumes local compute, reads files, and reconstructs the recorded session.

**Do forks always save time or tokens?** No. They reuse a recorded prefix, but live behavior may diverge and take more work. The reports contain the actual costs and durations for each run.

**What does the image contain?** Parsed Pharo trace objects and embedded file/Git archive bytes. It does not contain the model weights or a complete operating-system snapshot.

**Can a saved image call a live API?** After an explicit runner/model reconnection. Opening the image alone makes no model call and performs no cloud upload or Git push.

**Is this a sandbox?** No. Git worktrees isolate history, not OS privileges. The current demo uses controlled fixtures. Production evaluation needs stronger execution isolation.

**Why GridFS?** The implementation streams large image and archive files instead of embedding each one into a single MongoDB document. A separate manifest links the companions and their integrity metadata.

**Do the model results generalize?** This demo uses one coding fixture and one configured seed. It demonstrates the workflow rather than establishing a model ranking.

## Fallback if the network is unavailable

Present the saved real-model traces and the completed cloud-verification evidence. Opening a saved image and inspecting the captured results does not need Atlas. If you run the scripted fallback, state explicitly that it checks the recording/recovery machinery and is not new Qwen inference.
