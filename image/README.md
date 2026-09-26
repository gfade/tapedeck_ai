# TapeDeck image

The Pharo side of TapeDeck: an analysis lab for pi runs. It imports every run of a runner
store as live objects (runs, steps, tool calls, harness states, tapes), answers questions
about them without calling a model, drives the runner to fork and replay runs, serves tapes
and results as JSON to other programs, and, saved as an image, keeps every run, fork and
analysis inside.

Target: Pharo 13. It also loads in Glamorous Toolkit (Pharo 12 based), with extra GT views.
The contract with pi-tape and the runner is [`../INTERFACES.md`](../INTERFACES.md) (§7 for
the image).

## Packages

Tonel sources in `src/`, baseline `BaselineOfTapeDeck`. Each package loads after the ones
before it.

| Package | Classes |
|---|---|
| TapeDeck-Core | `TdStore` (runs of a store), `TdRun`, `TdStep`, `TdToolCall`, `TdMessage`, `TdHarnessState`, `TdHarnessDiff`, `TdHarnessChange`, `TdDivergence`, `TdUsage`, `TdTape` (tape JSON, editable), `TdSessionFile`, `TdStepReader`, `TdJson` (JSON with key order kept), `TdText` |
| TapeDeck-Analysis | `TdPolicy` with `TdDenyCommandRule` and `TdDenyPathRule`, `TdVariant`, `TdForkRule`, `TdAlignment` (where two runs differ), `TdComparison`, `TdComparisonTable`, `TdStats`, `TdPattern`, `TdJsonDiff` |
| TapeDeck-Server | `TdRunnerClient` (the runner's HTTP API), `TdServer` (the image's JSON server), `TdRunnerError`; `TdRun>>forkAt:with:`, `replayWith:tape:` |
| TapeDeck-Inspector | Spec 2 inspector tabs: run timeline and harness diff, step request/response/tools, store runs, comparison table, tape steps |
| TapeDeck-GT | the same views as `<gtView>` methods (Glamorous Toolkit only) |
| TapeDeck-Tests | SUnit tests on the fixture store, a stub runner and the server |

Metacello groups: `default` (everything but TapeDeck-GT) and `gt` (everything).

## Build

### Pharo 13

```sh
image/scripts/build-pharo13.sh
```

This downloads Pharo 13 and its VM into `image/pharo/` (`curl https://get.pharo.org/64/130+vm | bash`),
loads the `default` group headless, saves `image/pharo/TapeDeck.image` and runs the tests.
Open it with `cd image/pharo && ./pharo-ui TapeDeck.image`.

To load into an image you already have, evaluate:

```smalltalk
Metacello new
	baseline: 'TapeDeck';
	repository: 'tonel:///abs/path/to/tapedeck/image/src';
	load: #( 'default' ).
```

or run `pharo Your.image st --save --quit image/scripts/load.st` (it finds the sources through
`TAPEDECK_SRC` or the working directory).

### Glamorous Toolkit

Load the `gt` group the same way (`load: #( 'gt' )`); `load.st` picks it automatically in GT.
To run the tests headless in a throwaway copy of a GT image (the original is not modified):

```sh
GT_HOME=/path/to/glamoroustoolkit image/scripts/test-gt.sh
```

It prints `N run, P passed, F failed, E errors` and exits non-zero on failure. `test.st` also
fails when a TapeDeck method refers to an undeclared variable or a test leaves a server running.
The tests read the fixture store `fixtures/store` (`TAPEDECK_FIXTURES` or
`TdTestCase fixturesDirectory: '/abs/store'` point them elsewhere, e.g. at a real store).

## Playground

Paste into a Playground; `Do it` or `Inspect it` each line. The paths are examples.

Import a store (the runner's `store/` directory, or over HTTP):

```smalltalk
store := TdStore fromDirectory: '/path/to/tapedeck/store'.
store := (TdRunnerClient new baseUrl: 'http://127.0.0.1:4777') importStore.
store runs.
store refresh.	"import new runs"
baseline := (store baselinesFor: 'vanilla') detect: [ :run | run failed ].
```

A run's timeline (inspect `baseline`: the Timeline tab shows steps, live or replayed, tools,
tokens, cost and the divergence marker):

```smalltalk
baseline inspect.
baseline steps.
(baseline stepAt: 4) tools first command.	"'npm test'"
(baseline stepAt: 4) tools first resultText.
(baseline stepAt: 4) requestText.
baseline stats toolHistogram.
```

Harness diff: what a variant changed in the prompt sections and tools:

```smalltalk
fork := (store forksOf: baseline) first.
fork harnessDiffFromParent.	"+ section tapedeck-rules"
(baseline harnessStateAt: 1) diff: (fork harnessStateAt: 1).
(fork harnessStateAt: 1) promptText.
```

What would this policy have blocked? A what-if over every recorded call, no model calls:

```smalltalk
policy := TdPolicy new
	denyCommand: '^npm (test|run test)';
	denyPath: '(^|/)\.env$';
	yourself.
policy blockedCallsIn: store.
(policy blockedCallsIn: store) collect: [ :call | call run id -> (policy reasonFor: call) ].
policy firstBlockedCallIn: baseline.	"where a replay with this policy diverges"
(TdVariant fromFile: '/path/to/tapedeck/runner/bench/variants/guard-secrets/variant.json') blockedCallsIn: store.
```

Where do two runs differ?

```smalltalk
(baseline alignmentWith: fork) lenient: #( 'system' ); reason.
	"'step 4 response content[0].arguments.command: ""npm test"" vs ""./tasks test""'"
```

Pick the first `npm` call and fork there with a variant. This needs the runner
(`node runner/src/cli.ts serve`); the fork is imported and added to the store:

```smalltalk
TdRunnerClient default: (TdRunnerClient new baseUrl: 'http://127.0.0.1:4777').
variant := TdRunnerClient default variantNamed: 'rule-taskrunner'.
step := variant forkStepFor: baseline.	"step 4: $ npm test"
newFork := baseline forkAt: step with: variant.
newFork divergence.	"step 4 forced at request -> live"
newFork passed.
```

Edit a tool call in a tape and replay it. The later requests keep the recorded conversation,
so a zero-token replay stops at the next step, and a fork goes live there with the edit in
its context:

```smalltalk
tape := TdTape fromRun: baseline.
tape editToolCall: step tools first id result: '# pass 3' note: 'what if npm test had passed?'.
tape edits.
replay := baseline replayWith: 'vanilla' tape: tape.
replay divergence.	"step 5 context at request ..."
TdRunnerClient default forkRun: baseline variant: 'vanilla' tape: tape.
tape editToolCall: step tools first id command: './tasks test'.	"or change what the model ran"
store registerTape: tape.	"now served at /tapes/<baseline id>"
```

Build the comparison table (the runner's gate report, computed in the image):

```smalltalk
table := TdComparisonTable forCandidate: 'rule-taskrunner' baseline: 'vanilla' in: store.
table agreement.
table tokenSavings.
table summaryDictionary.
(TdComparisonTable fromGateReport: (store reportNamed: 'rule-taskrunner-vs-vanilla') in: store) inspect.
TdRunnerClient default gateBaseline: 'vanilla' candidate: 'rule-taskrunner'.	"runs a new gate"
```

Start the server:

```smalltalk
server := TdServer startOn: store.	"http://127.0.0.1:4778"
server comparisonTable: table.	"what /comparisons serves (default: every fork)"
server stop.
```

## Serving

`TdServer` listens on 127.0.0.1 only (INTERFACES.md §7): `/health`, `/runs`,
`/runs/<id>/timeline`, `/tapes/<id>` and `/comparisons`, all JSON. A tape registered with
`store registerTape:` wins over the tape derived from the run with that id, so pi-tape can
replay an edited tape with `PI_TAPE_SOURCE=http://127.0.0.1:4778/tapes/<id>`. Tapes served by
the image are the ones pi-tape derives from the same session.

Headless: `image/scripts/serve.sh [store-dir]` (default `$TAPEDECK_HOME`, then `<repo>/store`).
It uses `image/pharo/TapeDeck.image`, or a copy of the GT image in `$GT_HOME`, refreshes the
store every 5 seconds (`TAPEDECK_REFRESH`) and listens on `TAPEDECK_IMAGE_PORT` (default 4778).

## The image as a lab notebook

Save the image (World menu, Save; or `Smalltalk snapshot: true andQuit: false`) and everything
stays: the store with every run and its sessions in memory, forks made from the image, edited
tapes, policies, tables and playground variables. After reopening it, `store refresh` imports
the runs made since, and `TdServer startOn: store` serves again (servers do not survive a
save). Runs still refer to their directories; a run whose directory was deleted keeps
everything it imported.

## Notes

- JSON is read with object key order kept (prompt sections are ordered objects in pi's
  sessions); `TdJson` does this rather than STON's JSON reader, which uses unordered
  dictionaries.
- Sessions without pi-tape entries still import: steps come from the assistant messages, with
  tool calls and results but no requests or snapshots; they have no tape.
- Policy and fork-rule patterns are JavaScript regexes compiled with Pharo's regex engine
  (`TdPattern`): `(?:...)` is accepted, lookarounds are not.
- Comparison summaries follow the runner's gate (`runner/src/gate.ts`): a tie among reruns
  counts as fail, and one fork is compared with one rerun per task.
- Verified headless in Glamorous Toolkit (Pharo 12). The Pharo 13 build script could not be
  run where this was written (no access to get.pharo.org); the code uses APIs present in both.
