# TapeDeck

Record, replay, fork, and compare pi coding-agent sessions. Save an agent's traces, workspace files, edited tapes, and Git checkpoints inside a portable Pharo `Agent.image`; optionally publish the image and its file archive to MongoDB Atlas.

## Quick start

Requires Node **22.19+**, Git, and Python 3 for fixtures. Node 24 is used for development.

```sh
npm ci
npm run fixtures
npm run typecheck
npm test
npm run demo
```

The offline demo records a task, archives its files and Git history, restores it into another store, and compares a replay, fork, and fresh run. It uses `scripted/toy`, not a paid provider.

## Save and reload an agent image

```sh
npm run test:image
node runner/src/cli.ts run --task t01 --variant vanilla
node runner/src/cli.ts serve --host 127.0.0.1 --port 4777
```

In another terminal:

```sh
bash image/scripts/save-agent.sh agent-exports/Agent.image
image/pharo/pharo agent-exports/Agent.image eval "TdAgentImage current store size"
```

The saved image has a persistent `TdAgentImage current` root. Reopening it restores embedded files beside the image under `Agent.files/`, without needing the original runner store. Complete session objects remain inspectable even without a runner. Live model calls and full Git-repository restoration use the Node runner bridge.

See **[Agent image workflow](docs/AGENT-IMAGE.md)** for Atlas placeholders, live API configuration, Git export, restore commands, security boundaries, and end-to-end tests.

## Project layout

- `pi-tape/`: session recording, replay, divergence detection, and Git snapshots.
- `runner/`: CLI/HTTP API, experiments, archives, Atlas/GridFS, and Git export.
- `image/`: Pharo/GT trace objects, inspectors, and persistent agent images.
- `INTERFACES.md`: recording, tape, store, and API contracts.

`image/README.md` documents the original analysis tools. The existing dashboard is a lightweight viewer; the CLI and JSON APIs expose the complete agent-image workflow.
