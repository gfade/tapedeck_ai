# TapeDeck: 60-second MongoDB hackathon pitch

Five slides. 138 spoken words. Rehearse to the time marks; reference notes are not spoken. The full local experiment runs before the pitch.

## 1. TapeDeck (0:00–0:10)

When a coding agent fails, a chat log is not enough. TapeDeck saves the experiment: its trace, files, and Git checkpoints, ready to reopen.

**Reference, not spoken:** Audience: MongoDB hackathon judges. The saved Pharo image contains trace objects and embedded file bytes, not an operating-system snapshot.

## 2. Real Qwen3.5 2B, zero-call replay (0:10–0:25)

We ran Qwen three-point-five two-B locally on a coding task. The original run, live fork, and fresh run passed. Strict replay reproduced the trace with zero model calls, measured independently.

**Reference, not spoken:** One sum-function fixture on a 24 GiB Apple Silicon Mac. Ollama 0.33.2, Q8_0 weights, 16,384-token context, temperature zero, seed 42. Replay does not rerun the task verifier. Fork reuses one recorded step and explicitly permits a changed system prompt. No general benchmark claim.

## 3. MongoDB Atlas keeps the experiment (0:25–0:40)

MongoDB Atlas stores the image and companion files in GridFS. A snapshot manifest links their hashes. Download verifies the bytes before restoring the experiment. Reconnect the local model only when you choose a live continuation.

**Reference, not spoken:** Implemented in runner/src/atlas.ts and archive.ts. Collections: agent_snapshots.files, agent_snapshots.chunks, agent_snapshots_manifests. Manifests publish only after all uploads succeed. Model weights and credentials stay external. No vector-search feature is claimed.

## 4. Downloaded, reopened, checksum-verified (0:40–0:52)

Atlas recovery is independently verified: four companion hashes matched, and the downloaded image reopened with its files and Git history intact. That earlier snapshot is separate from today’s Qwen run.

**Reference, not spoken:** Snapshot b185069cbeefb5e464e4523d, verified 2026-09-26T19:06:14.492Z. Separate prior snapshot, not the new Qwen experiment. Every companion hash matches both source and manifest. Every image-materialized file and Git bundle matches its archive digest.

## 5. Bring one failing agent run (0:52–1:00)

Our ask: bring one failing agent run. Recover it, inspect it, then try a live alternative. That is TapeDeck.

**Reference, not spoken:** Prototype boundaries: one controlled coding fixture, not a general benchmark or OS sandbox. Model inference is local. Repository access may require permission.

## Evidence

Measured results: `docs/demo-evidence.json`. Presenter walkthrough: `docs/JUDGE-WALKTHROUGH.md`.
