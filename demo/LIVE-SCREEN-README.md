# Real application screen demo

This is a running app, not a presentation. Its terminal pane and proof table are updated from actual Runner events, real local Ollama requests, verifier outcomes, and an optional Pharo recovery subprocess. Nothing in the page schedules predetermined pass/fail outcomes.

The current UI uses a terminal-style process stream: monospace output, a shell-style launch line, colored results, selectable scrollback, and a persistent status bar. Expand the verifier and MongoDB sections to inspect detailed evidence. This is a read-only output view, not an arbitrary-command shell. Existing recorded videos retain their original visual layout.

## Watch

- `presentation/TapeDeck-Live-60s.mp4`: 60-second, narrated 1080p video.
- `presentation/TapeDeck-Live-Unnarrated.mp4`: the same full-minute screen recording without narration.
- `presentation/TapeDeck-Live-60s.srt`: optional captions.
- `presentation/LIVE-DEMO-TRANSCRIPT.md`: timed narration, exact task/fix explanation, and judging-criteria mapping.
- `presentation/live-screen-evidence.json`: recorded run results, provider counts, recovery hashes, capture timing, and video checksum.

## Run it yourself

### Terminal only

```bash
npm run demo:cli
npm run demo:cli -- --help
```

The CLI starts immediately, streams actual results, and exits without starting a web UI. Exit code 0 means the proof completed; a rejected candidate or execution error returns 1. The intentionally failed repair-fixture baseline is expected, not an overall failure. Each invocation defaults to a fresh evidence directory printed at startup, containing `terminal.jsonl`, `result.json`, the archive, and restored store. Keep explicit `--output` directories unique between runs.

To include checksum verification and reopening of a trusted prior Atlas download:

```bash
npm run demo:cli -- --atlas-proof /absolute/path/to/verified-atlas-download
```

This checks existing downloaded bytes, not a live Atlas transfer. Without the flag, Atlas verification is explicitly skipped. The model and Pharo prerequisites below still apply. `--start-file` is only available in web mode.

### Web UI

Prerequisites: Node 22.19+, dependencies installed, Git, Ollama, and the configured Qwen3.5 2B alias. Run `npm run demo:local:setup` after installing the model as documented in the main README.

```bash
npm run demo:screen -- --port 4781 --output agent-exports/my-live-demo
```

Open `http://127.0.0.1:4781`, then choose **Run live demo**. Every server instance runs once and retains the evidence. Use a new output directory and restart the server for another take. Without `--atlas-proof`, the page explicitly reports that Atlas recovery is not configured; it does not invent recovery results.

To include recovery from your own previously verified Atlas download:

```bash
npm run demo:screen -- --port 4781 --output agent-exports/my-live-demo \
  --atlas-proof /absolute/path/to/verified-atlas-download
```

That directory must contain `snapshot.json`, `downloaded/archive.json`, and `downloaded/image/` with the image and its companion files. The local Pharo VM is required. The image must be trusted: opening a Smalltalk image executes its saved environment. Use the existing Atlas commands to obtain the directory; this demo does not perform a new cloud transfer.

For recording without clicking the page, supply `--start-file /absolute/path/to/new-trigger-file`. After the page is framed, create that file from a terminal. The server starts the same real workflow exactly once. This is a local recording trigger, not a remote shell API.

## The exact failure and fixes

- **Bug:** t01's `sum()` subtracts. `sum(2,3)` returns `-1`, not `5`.
- **Failed fixture attempt:** it edits subtraction into addition, runs the deliberately disabled `npm test`, then reverts the correct edit. The separate verifier catches the failure.
- **Harness repair:** a trace-derived rule selects `./tasks test`. The candidate retains `return a + b`; a fork and two fresh runs pass the repository and hidden checks.
- **Qwen validation:** the real local model starts out passing. Its candidate reduces seven direct tools to `read`, `bash`, and `edit`, with independent checks still passing. This is not a Qwen-failure-repair or token-savings claim.
- **Persistence:** the newly recorded ten runs, policies, and Git history are archived and restored. Separately, a historical Atlas image is reopened and all 497 embedded payloads are hashed again.

## Recording method and limitations

The delivered video contains 60 continuous seconds of actual browser-viewport pixels captured at about eight samples per second, using wall-clock timestamps. Those pixels are encoded at 30 fps without speeding the execution up. The workflow completes in approximately 41.5 seconds; capture continues on the actual result page for the rest of the minute. There are no cuts, substituted stills, slide transitions, or recreated terminal screens. Native Terminal UI automation was unavailable; the live app displays the actual backend command/status output instead.

The repaired failure is a clearly labeled deterministic fixture, not an organic Qwen failure. One coding task cannot establish general performance. Direct-tool and regex gates are not OS sandboxing. Atlas was unreachable during this recording, so the cloud segment is explicitly **prior download, fresh local verification**. No new `.image` upload is claimed.

`demo/render-live-video.py` encodes timestamped source captures and adds original synthetic Samantha narration. It requires Pillow, ffmpeg, and macOS `say`; run it with `--help` for its input paths. The script never redraws the app, generates fake output, or changes recorded outcomes.
