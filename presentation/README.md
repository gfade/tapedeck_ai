# TapeDeck: 60-second MongoDB hackathon demo

[![Watch the demo](TapeDeck-60s-Demo-Poster.png)](TapeDeck-60s-Demo.mp4)

## Deliverables

- [Narrated demo video](TapeDeck-60s-Demo.mp4): exactly 60 seconds, 1920 × 1080, 30 fps, H.264 video and AAC audio.
- [Editable six-slide PowerPoint](TapeDeck-MongoDB-Hackathon.pptx) and [PDF slides](TapeDeck-MongoDB-Hackathon.pdf).
- [132-word speaker script](PITCH-SCRIPT.md), [scene plan](pitch-plan.json), and [subtitle file](TapeDeck-60s-Demo.srt).
- [Captured evidence](demo-capture.json) with run IDs, actual code patch, tool calls, request timings, GridFS companion metadata, and checksum results.
- [Judge walkthrough and technical Q&A](../docs/JUDGE-WALKTHROUGH.md).

## How the pitch addresses the rubric

| Criterion | Weight | Proof in the pitch |
| --- | ---: | --- |
| Technical Demo | 35% | Real Qwen3.5 2B tool use fixes a JavaScript bug; all three live verifiers pass; an independent gateway observes zero model calls during replay; a downloaded image reopens with verified payloads. |
| Implementation Difficulty | 30% | Normalized request matching, recorded tool outcomes, divergence boundaries, Git checkpoint restoration, persistent Pharo objects and file bytes, streaming GridFS storage, publish-after-upload manifests, and staged checksum-validated restore. |
| Creativity | 15% | The recoverable unit is an executable agent experiment containing objects, traces, files, and Git history, rather than only a chat transcript. No world-first claim is made. |
| Impact Potential | 20% | Developers can inspect failures, evaluation teams can test deliberate alternatives, and teammates can reopen experiments. Strict replay needs no new inference. No invented market size, savings, or productivity percentages. |

The rubric weights are not screen-time requirements. Technical proof occupies 26 seconds and implementation depth 20 seconds: 46 of the 60 seconds cover the two highest-weight criteria.

## MongoDB's role

The video names the real configured collections:

- `agent_snapshots.files`: GridFS companion-file metadata.
- `agent_snapshots.chunks`: binary image/archive/companion chunks.
- `agent_snapshots_manifests`: the complete snapshot's companion IDs, sizes, and SHA-256 hashes.

The manifest publishes only after all companion uploads succeed. Restore downloads into staging and validates sizes, hashes, paths, and archive contents before publishing the restored directory. This is an application-level publication protocol, not a claim of a multi-file transaction. No vector-search feature is claimed.

## Recording disclosure

This is an **edited, narrated evidence demo**, not an uninterrupted screen recording. Terminal-style scenes format genuine captured command output and saved-result fields for legibility. The raw events, timestamps, real patch, request counts, and hashes are in `demo-capture.json`. Personal path prefixes are redacted as `$PROJECT`; evidence values are unchanged. Diagram chunk blocks illustrate streaming and do not assert a specific chunk count.

The narration is the local macOS **Samantha synthetic system voice**, not a cloned person. Captions are burned into the video; an SRT sidecar is also included. The 132-word script fits six timed scenes, with no spoken audio cut off at a transition.

The fresh local experiment ran on **September 26, 2026 at 19:51 UTC**:

| Mode | Model requests | Task verifier |
| --- | ---: | --- |
| Record | 4 | Pass |
| Replay | 0 | Not rerun |
| Live fork | 3 | Pass |
| Fresh run | 4 | Pass |

Replay is verified against the recorded behavior and uses zero new tokens. That is not a fresh test verdict or a claim that model inference is deterministic. The fixture is intentionally small and does not establish general model performance.

The new Qwen image reopens locally with **4 runs, 76 files, and 1 Git bundle**, with all 77 embedded payload hashes verified. **Its Atlas upload remains blocked by network timeouts.**

The MongoDB recovery footage instead re-verifies a **previously downloaded, separate Atlas snapshot**: `b185069cbeefb5e464e4523d`. Its four companion hashes match the saved manifest, and reopening restores **32 runs, 491 files, and 6 Git bundles**, with all 497 payload hashes matching. The footage explicitly labels this as an earlier Atlas download, not a new cloud transfer or the fresh Qwen image.

## Reproduce the experiment

From the repository root, with Ollama running and Qwen3.5 2B installed:

```sh
npm run demo:local -- --destination agent-exports/another-judge-demo
```

Choose a new destination. Results can differ across runs. Follow the root README to save an `Agent.image`, publish it to Atlas, and restore it once credentials and network access are available. Keep model weights, images, and credentials out of source Git.

## Submission description

TapeDeck makes coding-agent experiments recoverable. This 60-second demo shows a real local Qwen code fix, independently measured zero-call replay, and a live fork built on Git checkpoints. MongoDB Atlas stores executable Pharo images and their companion archives in GridFS; snapshot manifests link IDs and integrity hashes. The recovery proof reopens a separately verified Atlas download and checks every embedded file and Git bundle. The prototype targets debugging, evaluation, and team handoff. Actual recorded evidence is condensed for readability with disclosed synthetic narration; current Atlas connectivity limits are labeled.
