# TapeDeck: judge walkthrough

## What judges should see

TapeDeck makes an agent experiment **reopenable and executable**, not just readable as a chat log. It intercepts model requests, records tool outcomes and Git checkpoints, supports strict replay and explicit live forks, and persists Pharo objects plus embedded files. MongoDB Atlas provides GridFS storage and a separate snapshot manifest collection.

The video uses **actual terminal captures edited for time, with synthetic system narration disclosed**. It does not simulate a product UI, pretend a saved report is a live cloud console, or suggest the whole experiment runs in 60 seconds. Current Atlas retries time out; offline proof is the honest demo path.

Authoritative pitch assets: `presentation/pitch-plan.json` and `presentation/PITCH-SCRIPT.md`. Both specify **six scenes, 60 seconds, 132 spoken words**, matching the revised deck and video. `presentation/demo-capture.json`, captured at 19:54:59 UTC, is the current evidence index.

## Evidence: keep the experiments separate

All times below are **September 26, 2026, UTC**.

| Evidence | Verified result | Boundary |
| --- | --- | --- |
| Fresh Qwen experiment, 19:51:07–19:51:32 | Model requests **4 / 0 / 3 / 4**; all three live verifiers PASS; `replayVerified: true` | This supplies the video's baseline/replay/fork/fresh counts |
| Fresh experiment archive | **4 runs / 76 files / 1 Git bundle** restored | Local archive evidence, not an Atlas publication |
| Current Qwen image, in the 19:54:59 capture index | Reopened with **4 runs / 76 files / 1 bundle** and **77 payload checksums** verified | Fresh local image has its own SHA-256 identity; `uploadedToAtlas: false` |
| Prior Atlas snapshot, cloud-verified 19:06:14 | **32 runs / 491 files / 6 bundles**; four companions matched source and manifest | Different snapshot: `b185069cbeefb5e464e4523d` |
| Fresh offline Atlas recheck, 19:52:11 | Four companion hashes match the saved manifest; downloaded image reopens; **491 file + 6 bundle hashes** pass | `liveCloudTransfer: false`; new local verification of an old cloud download, not a new upload/download |
| Current Atlas retry | Network timeouts on all replica servers during the recorded preparation | Do not imply current cloud connectivity or a Qwen upload |

**Current raw references:**

- `presentation/demo-capture.json`: consolidated current evidence, actual patch/tool calls, provider timings, Git IDs, local image verification, and prior Atlas proof.
- `agent-exports/video-build/recorded-run.json`: captured command, timestamps, raw stdout events, exit code 0. The command is `node runner/src/local-demo.ts --destination agent-exports/judges-video-demo`.
- `agent-exports/judges-video-demo/results.json`: fresh outcomes, provider request counts, replay equality, and restored-archive counts.
- `agent-exports/judges-video-demo/provider-requests.jsonl`: independent gateway request records by phase.
- `agent-exports/video-build/recorded-atlas-proof.json`: saved manifest, four hash results, reopen events, restored counts, and 497 verified payloads.
- `presentation/demo-capture.json#/localImage`: current Qwen image SHA-256 `7758fa597665afb7a9c3a8b08ce13ab40eeed3eeda9a3dbd5415fca5f71473a4`, 63,114,064 bytes, 77 verified payloads, and no upload.
- `docs/demo-evidence.json`: **historical** 4 / 0 / 3 / 6 experiment and earlier local/cloud verification. Retain it; do not silently rewrite it or use its old fresh-run count in the video.

### Fresh Qwen run identities

| Mode | Run ID | Model requests | Verifier |
| --- | --- | ---: | --- |
| Baseline | `20260926-195107-t01-vanilla-run-7c7b` | 4 | PASS |
| Strict replay | `20260926-195117-t01-vanilla-replay-7510` | 0 | No new verdict |
| Live fork | `20260926-195118-t01-rule-taskrunner-fork-e8b0` | 3 | PASS |
| Fresh rerun | `20260926-195124-t01-rule-taskrunner-run-de41` | 4 | PASS |

The model is `qwen3.5:2b`, running locally on the single `t01` coding fixture. Replay has four replayed steps, zero live steps, and zero tokens. The fork has one replayed step and three live steps. These are observed results, not a model ranking, a guarantee for other tasks, or an ROI calculation.

## Six-scene cut and rubric

| Time | Title | Show actual proof | Primary criterion |
| --- | --- | --- | --- |
| 00:00–00:06 | Save the experiment | Failure-recovery pain; real patch/image evidence; MongoDB + Pharo label | Creativity, 15% weight |
| 00:06–00:20 | Replay: zero calls | Fresh captured replay-completion/result evidence, then 4/0/3/4 request summary | Technical Demo, 35% weight |
| 00:20–00:30 | Fork at divergence | Request/tool recording source, real fork boundary, Git restore hash | Implementation Difficulty, 30% weight |
| 00:30–00:40 | MongoDB stores it | Saved manifest, GridFS file/chunk collections, upload loop before publication | Implementation Difficulty, 30% weight |
| 00:40–00:52 | Reopen the download | Actual offline companion hashes, image reopen, 491 + 6 payload checks | Technical Demo, 35% weight |
| 00:52–01:00 | Debug without rerunning | Hold real proof under the developer-focused ask | Impact Potential, 20% weight |

**46 seconds (76.7%) are direct proof/engineering:** 26 Technical Demo + 20 Implementation Difficulty. This deliberately exceeds the rubric's combined 35% + 30% emphasis. Judging weights need not equal screen-time shares. Creativity also appears in reopening the executable image; impact appears in zero-inference replay and recoverable state.

## What the engineering proves

### 1. Request interception and recorded tool outcomes

`pi-tape/extensions/tape.ts` registers a `tape` provider whose stream reaches `TapeController`. In `pi-tape/extensions/tape/controller.ts`, `checkRequest` compares normalized recorded requests with the current request. Matching replay steps return the recorded model response. `runTool` checks tool identity and arguments; `stubResult` returns the recorded result or recorded error instead of running a matched wrapped tool again.

This is replay of recorded behavior, **not another deterministic inference attempt**. The measuring gateway in `runner/src/local-gateway.ts` counts actual provider requests; `runner/src/local-demo.ts` sets `replayVerified` only when replay completes with zero provider requests, zero tokens, zero live steps, and equal recorded behavior.

**Terminal proof:** hold the real `replayVerified: true` completion event, then inspect the matching replay result and gateway phase summary. Raw captured stdout does not contain every detailed count; a readable JSON projection must be labeled as evidence inspection, not fabricated stdout.

For visible task substance, `presentation/demo-capture.json` also supplies the actual read/edit/bash tool calls and the patch changing `return a - b` to `return a + b`. Its verifier output includes `hidden checks passed`. These are genuine captured coding-task results, not a made-up agent failure sequence.

### 2. Git checkpoints, divergence, and explicit forks

`pi-tape/src/git.ts` creates checkpoint commits and restores workspace state. The controller records per-tool/step checkpoint references. A mismatch produces an explicit divergence: strict replay stops; fork mode restores the last matching checkpoint before it continues live.

The fresh fork report is `agent-exports/judges-video-demo/restored-store/runs/20260926-195118-t01-rule-taskrunner-fork-e8b0/tape-report.json`. Show its actual fields:

- `forkAt: 2`, `kind: "forced"`, `action: "live"`.
- `steps: { replayed: 1, live: 3, total: 4 }`.
- `restoredSnapshot: "34a9bbfed18f0640dc113ad20533978e38367e76"`.
- `lenient: ["system"]`: the fork explicitly permits the changed system prompt; it is not identical-harness strict replay.

These fields are saved evidence from the fresh experiment, not a new live fork during video playback. Test references: `pi-tape/test/replay.test.ts` and `pi-tape/test/fork.test.ts`; this documentation task does not execute those tests.

### 3. MongoDB: GridFS plus publish-after-upload manifest

For the **prior verified snapshot**, the database is `tapedeck` and the configured bucket is `agent_snapshots`:

| Collection | Role |
| --- | --- |
| `agent_snapshots.files` | GridFS file metadata |
| `agent_snapshots.chunks` | Binary chunks for the image/archive/companions |
| `agent_snapshots_manifests` | Snapshot identity and companion file IDs, names, sizes, SHA-256 hashes |

`runner/src/atlas.ts` streams each companion into GridFS while computing its size and SHA-256. `publish` awaits every upload before calling `putManifest`. A failed publication attempts cleanup and reports incomplete cleanup explicitly. This is an application publication protocol, not a claim of a multi-file database transaction.

`restore` downloads to staging, validates sizes and hashes, validates/restores the archive, and only then commits the restored directory. Large binary data stays in GridFS rather than one oversized BSON manifest. No vector-search feature is claimed.

**Terminal proof:** inspect `agent-exports/video-build/recorded-atlas-proof.json#/manifest`, then the `GridFSBucket`, collection construction, upload loop, and `putManifest` source in `runner/src/atlas.ts`. Show collection roles with short overlays, not fabricated collection query results or invented chunk counts. The configured bucket above differs from the code's default; use the snapshot's actual name. `runner/test/atlas.test.ts` contains publication-order and corrupt/truncated-download cases; cite them as source, not as a new test run.

### 4. Pharo object and file persistence; actual offline reopening

`image/src/TapeDeck-Server/TdAgentImage.class.st` rebuilds parsed run/session objects from the archive (`readArchive:`), retains that object graph when saving (`saveAs:`), and restores embedded bytes on startup (`startUp:`, `resume`, `restoreFilesTo:`). `decodedBytes:` checks size and SHA-256. The image carries live experiment objects and embedded file/Git-bundle data, not model weights, the Node/Pharo executables, live sockets, or a general OS snapshot.

The freshly captured offline proof identifies prior snapshot `b185069cbeefb5e464e4523d` and explicitly sets `liveCloudTransfer: false`. Its genuine terminal events show:

- Four matching companion hashes: `Agent.image`, `archive.json`, `Agent.changes`, and `Pharo13.1-64bit-d7c6f76.sources`.
- Reopening a copy of the already-downloaded `Agent.image` yields **32 runs / 491 files / 6 Git bundles**.
- **491 embedded file hashes + 6 Git bundle hashes** pass, totaling 497 verified payloads.

The published archive hash covers its published canonical JSON bytes; it is not interchangeable with an arbitrarily reformatted archive file. Reopening uses a copy so original downloaded evidence remains intact. The new proof verifies companion hashes against the saved manifest; the older cloud proof separately establishes source-byte matches. Do not collapse those into a new cloud round trip.

## Capture and rendering rules

1. Use `start`/`end` numeric seconds from `presentation/pitch-plan.json`; no gaps or overlapping scenes. Titles, captions, and source notes are not spoken. The narration totals 132 whitespace-delimited words.
2. Show the full opening/video-description disclosure: **Actual terminal captures · edited for time · synthetic system narration**. Retain the short persistent label. The index identifies macOS Samantha, not a cloned person. Synthetic narration is editorial audio, not a purported model/tool response.
3. Give the replay terminal a genuine result hold, then the MongoDB architecture ten seconds, then the offline reopen/hash proof twelve seconds. Prefer one readable proof block to a fast montage. Use short labels and large text; put long run IDs/hashes in the terminal or supporting notes.
4. Use the actual `recorded-run.json` command/events; do not invent a standalone replay invocation. Preserve result values, ordering, errors, and source IDs. A formatted saved-JSON view is permitted as clearly labeled evidence inspection, not counterfeit stdout or a fake product UI.
5. Keep **Prior Atlas · offline reopen** visible during the cloud-snapshot proof. Keep **Qwen local: 4 · 76 · 1** separately labeled, in runs/files/bundles order. Say **New Atlas upload blocked**; never imply the new Qwen image is in Atlas.
6. Capture source excerpts and saved manifests instead of attempting new cloud queries during the pitch. Use only genuine captured outputs for pass/fail claims. If a later capture fails, retain the failure or explicitly fall back to dated verified evidence.
7. Keep credentials, connection strings, and personal paths off screen. Redaction may protect secrets but must not change evidence. Update the evidence index and narration together if a later run produces different outcomes.

## Judge questions: short answers

**Why is this creative?** The unit of collaboration is a reopenable, executable agent experiment: trace objects plus files and checkpoints. It combines established mechanisms into a concrete recovery workflow; no world-first claim is needed.

**Why MongoDB rather than a generic file upload?** GridFS stores the binary companions; the manifest collection makes the complete snapshot addressable with companion IDs and integrity metadata. The hard boundary is publish after all uploads, then verify before restoring.

**Did you upload the new Qwen experiment?** No. Atlas retries still time out. We show fresh local Qwen results and a fresh offline recheck of a separately identified, previously downloaded Atlas snapshot.

**Does replay prove the task passed again?** No. Baseline, live fork, and fresh rerun have passing verifiers. Strict replay has no new verdict; it reproduces recorded behavior without inference and can faithfully reproduce failure.

**What is the impact?** Developers can recover, review, and debug a saved failure without repeated inference during replay, then deliberately spend inference on a live alternative. The zero-request observation is measured; financial savings, general productivity gains, and ROI are not.

**What are the limits?** One coding fixture, not a general benchmark. Live continuation still needs the runner and a model endpoint. Git worktrees isolate history, not OS privileges. Open only trusted executable images; this is not a secure execution sandbox.
