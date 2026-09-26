#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
destination="${1:-$(mktemp -d "${TMPDIR:-/tmp}/tapedeck-demo.XXXXXX")}"
mkdir -p "$destination"
destination="$(cd "$destination" && pwd)"
cd "$repo"
node runner/src/cli.ts run --task t01 --variant vanilla --model scripted/toy \
  --home "$destination/original" --json > "$destination/baseline.json"
baseline="$(node -p 'require(process.argv[1])[0].id' "$destination/baseline.json")"
node runner/src/cli.ts archive --home "$destination/original" --output "$destination/Agent.archive.json"
node runner/src/cli.ts restore --archive "$destination/Agent.archive.json" --destination "$destination/restored"
node runner/src/cli.ts compare "$baseline" --variant rule-taskrunner --model scripted/toy \
  --home "$destination/restored" > "$destination/comparison.json"
node -e 'const result=require(process.argv[1]); console.log(JSON.stringify({status:result.status,baseline:result.baselineRun,replay:result.runs.replay.steps,fork:result.runs.fork.pass,rerun:result.runs.rerun.pass,comparison:result.id},null,2)); if(result.status!=="done") process.exitCode=1' "$destination/comparison.json"
printf '\nDemo files: %s\nNo paid provider was called.\n' "$destination"
