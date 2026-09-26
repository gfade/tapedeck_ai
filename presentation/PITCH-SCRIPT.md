# TapeDeck: 60-second hackathon pitch

**Six scenes. Exactly 60 seconds. 132 spoken words.** Only the blockquoted narration is spoken; count words by whitespace. `presentation/pitch-plan.json` defines the revised deck and video timeline.

**Evidence lock:** September 26, 2026. The fresh Qwen capture at **19:51 UTC** measures **4 / 0 / 3 / 4** model requests, not the historical 4 / 0 / 3 / 6. The **19:52 UTC** Atlas proof rechecks and reopens an **already-downloaded, different snapshot** offline. The new Qwen upload remains blocked; there is no new cloud transfer.

**Video disclosure, not spoken:** “Actual terminal captures · edited for time · synthetic system narration.” Show this at the opening and in the video description; retain “Terminal capture · synthetic narration” as a small persistent label. Terminal material must be actual captured output or clearly labeled inspection of saved evidence, never a fake product UI or invented command transcript.

## Rubric and timing

| Scene | Time | Seconds | Primary criterion | Spoken words |
| --- | --- | ---: | --- | ---: |
| 1. Save the experiment | 00:00–00:06 | 6 | Creativity — 15% weight | 14 |
| 2. Replay: zero calls | 00:06–00:20 | 14 | Technical Demo — 35% weight | 31 |
| 3. Fork at divergence | 00:20–00:30 | 10 | Implementation Difficulty — 30% weight | 21 |
| 4. MongoDB stores it | 00:30–00:40 | 10 | Implementation Difficulty — 30% weight | 24 |
| 5. Reopen the download | 00:40–00:52 | 12 | Technical Demo — 35% weight | 24 |
| 6. Debug without rerunning | 00:52–01:00 | 8 | Impact Potential — 20% weight | 18 |
| **Total** | **00:00–01:00** | **60** | **46 seconds of proof/engineering** | **132** |

The rubric weights are judging weights, not required screen-time percentages. Technical Demo receives 26 seconds; Implementation Difficulty receives 20: **46/60 seconds, or 76.7%, directly serve the combined 35% + 30% criteria.** Creativity also appears in the executable-image proof; impact appears in zero-inference replay and offline recovery. Do not double-count that secondary coverage.

## 1. Save the experiment — 00:00–00:06

> A failed agent run needs more than chat logs. TapeDeck saves reopenable, executable experiments.

**On screen:** “Executable agent image” / “MongoDB Atlas + Pharo”.

**Capture direction:** Begin on the genuine sum-function patch or saved-image evidence, with the short MongoDB/Pharo title overlay and disclosure. Failed-agent recovery is the use case, not an invented failure of the passing demo. This is an executable Pharo object graph plus embedded files, not a screenshot, an OS snapshot, or saved model weights. The creative contribution is the experiment-as-image workflow, not a world-first claim.

**Criterion:** Creativity; secondary Impact Potential.

**Evidence/source:** `presentation/demo-capture.json#/localImage`, `#/patch`, and `#/atlas/restored`; `image/src/TapeDeck-Server/TdAgentImage.class.st` — `readArchive:`, `saveAs:`, `startUp:`.

## 2. Replay: zero calls — 00:06–00:20

> Real local Qwen on a coding task: baseline, four calls; replay, zero; fork, three; fresh run, four. Independently counted. All live verifiers passed. Replay returns recorded behavior, not a new verdict.

**On screen:** “Qwen 2B · model calls” / “Baseline 4 · Replay 0” / “Fork 3 · Fresh 4”.

**Capture direction:** Give roughly ten seconds to actual captured comparison/replay completion and readable replay-result inspection, including a result hold; use four seconds for the fresh request-count summary. Show `replayVerified: true`, four replayed steps, zero live steps, and zero tokens. The captured command is `local-demo`, not a separately filmed standalone replay command. Detailed counts come from its results and independent gateway log; label formatted projections as recorded evidence.

**Criterion:** Technical Demo; secondary Impact Potential.

**Evidence/source:** `agent-exports/video-build/recorded-run.json#/events`; `agent-exports/judges-video-demo/results.json#/results/0`; `agent-exports/judges-video-demo/provider-requests.jsonl`; `runner/src/local-demo.ts` — `replayVerified`; `runner/src/local-gateway.ts` — `startLocalGateway`.

**Judge note:** Qwen3.5 2B, one coding fixture. Baseline, live fork, and fresh run passed. Replay has `pass: null`: matching recorded behavior is not a new verifier pass or proof that inference itself is deterministic.

## 3. Fork at divergence — 00:20–00:30

> We intercept requests, record tool outcomes, and checkpoint Git. Divergence stops replay; an explicit fork restores the checkpoint before continuing live.

**On screen:** “Requests + tool outcomes” / “Git checkpoints” / “Fork: 1 replayed + 3 live”.

**Capture direction:** Give about four seconds to actual read/edit/bash tool calls and the patch from `return a - b` to `return a + b`, with brief source context; use six seconds for the fresh fork report. Hold `forkAt: 2`, `kind: forced`, the recorded `restoredSnapshot`, and `action: live`. The provider checks normalized requests; matching wrapped tools return recorded outcomes, including errors, rather than executing again. Git checkpoints provide the workspace restore point.

**Criterion:** Implementation Difficulty; secondary Technical Demo.

**Evidence/source:** `presentation/demo-capture.json#/toolCalls`, `#/patch`, and `#/checkpoints`; `agent-exports/judges-video-demo/results.json#/results/0/fork`; `agent-exports/judges-video-demo/restored-store/runs/20260926-195118-t01-rule-taskrunner-fork-e8b0/tape-report.json`; `pi-tape/extensions/tape.ts` — provider registration; `pi-tape/extensions/tape/controller.ts` — `checkRequest`, `runTool`, `stubResult`, `diverge`; `pi-tape/src/git.ts` — `snapshot`, `restore`.

**Judge note:** This controlled fork reuses one recorded step, explicitly permits the changed system prompt with `lenient: ["system"]`, then continues live for three steps. Do not describe it as strict replay under an unchanged harness.

## 4. MongoDB stores it — 00:30–00:40

> MongoDB GridFS stores checksummed images and their companions in file and chunk collections. Our manifest collection publishes a snapshot only after every upload succeeds.

**On screen:** “GridFS: files + chunks” / “SHA-256 per companion” / “Manifest: publish last”.

**Capture direction:** Spend the full ten seconds inspecting the prior snapshot's saved manifest and the real MongoDB implementation in a terminal. `agent_snapshots.files` holds file metadata, `agent_snapshots.chunks` holds binary chunks, and `agent_snapshots_manifests` links companion IDs, sizes, and SHA-256 hashes. Show the upload loop completing before `putManifest`. These are source-backed architecture and saved cloud evidence, not a live Atlas query.

**Criterion:** Implementation Difficulty; secondary Technical Demo.

**Evidence/source:** `agent-exports/video-build/recorded-atlas-proof.json#/manifest`; `docs/demo-evidence.json#/atlas` for the configured database/bucket and prior cloud verification; `runner/src/atlas.ts` — `GridFSBucket`, `publish`, `putManifest`, `restore`; `runner/test/atlas.test.ts` — publication-order and corrupt-download cases (source references, not newly executed tests).

**Judge note:** TapeDeck computes per-companion checksums while streaming uploads. Download validates size and SHA-256 before publishing the restored directory. This is not a claim that GridFS alone supplies the application checksum protocol or that the multi-file upload is a database transaction.

## 5. Reopen the download — 00:40–00:52

> Pharo preserves objects and files. This earlier Atlas download reopens with four companion hashes verified. Today’s Qwen image is local; its upload remains blocked.

**On screen:** “Prior Atlas · offline reopen” / “32 runs · 491 files · 6 bundles” / “Qwen local: 4 · 76 · 1”. The Qwen shorthand uses the same runs/files/bundles order.

**Capture direction:** Give roughly four seconds to actual companion-hash matches and eight seconds to the recorded reopen and payload-verification results. Hold “IMAGE REOPENED” and “PAYLOADS VERIFIED — 491 file hashes + 6 Git bundle hashes”. Keep “New Atlas upload blocked” visible as a separate status label. The 19:52 UTC capture reports four companion hashes matching the saved manifest and 497 verified embedded payloads.

**Criterion:** Technical Demo; secondary Creativity and Impact Potential.

**Evidence/source:** `agent-exports/video-build/recorded-atlas-proof.json` — `sourceSnapshot`, `liveCloudTransfer: false`, `hashes`, `restored`, `events`; `presentation/demo-capture.json#/localImage`; `agent-exports/judges-video-demo/results.json#/archive`; `image/src/TapeDeck-Server/TdAgentImage.class.st` — `decodedBytes:`, `restoreFilesTo:`, `resume`.

**Judge note:** Prior Atlas snapshot `b185069cbeefb5e464e4523d` is **32/491/6**, not the current Qwen **4/76/1** image. The current Qwen image is independently reopened and verified in `presentation/demo-capture.json`: 77 checked payloads and `uploadedToAtlas: false`. No new upload, download, or cloud connectivity is claimed.

## 6. Debug without rerunning — 00:52–01:00

> Recover, review, and debug failures without repeating inference during replay. Bring one failing run; test a live alternative.

**On screen:** “Recover · review · debug” / “Replay: no new inference” / “Bring one failing run”.

**Capture direction:** Hold genuine replay or restored-image output beneath the closing ask. The use case is developers investigating failed agent experiments; the measured live runs in this video passed. Do not invent a failure, saved dollars, productivity percentage, or ROI. Live alternatives still require inference.

**Criterion:** Impact Potential; secondary Creativity.

**Evidence/source:** `agent-exports/judges-video-demo/results.json#/results/0/replay` and `#/limitations`; `pi-tape/extensions/tape/controller.ts` — `stubResult`, `isLive`; `image/src/TapeDeck-Server/TdAgentImage.class.st` — `resume`, `compareRun:variant:model:`.

## Capture handoff

`presentation/demo-capture.json`, captured at **19:54:59 UTC on September 26, 2026**, is the current capture index, including the actual patch, tools, request timings, checkpoints, current local image, and prior Atlas proof. It identifies the synthetic voice as **macOS Samantha, not a cloned person**. The raw capture paths above remain available. Keep `docs/demo-evidence.json` unchanged as historical evidence. Do not replace real terminal outcomes with anticipated success lines; preserve the explicit separation between the fresh local experiment and the freshly rechecked, previously downloaded Atlas snapshot.
