#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
base="${TAPEDECK_BASE_IMAGE:-$repo/image/pharo/TapeDeck.image}"
vm="${PHARO_VM:-$repo/image/pharo/pharo}"
output="${1:-$repo/agent-exports/Agent.image}"

if [[ "$output" != *.image ]]; then
  echo 'Output must end in .image' >&2
  exit 1
fi
if [[ ! -f "$base" || ! -x "$vm" ]]; then
  echo 'Build the base image first: npm run test:image' >&2
  exit 1
fi
mkdir -p "$(dirname "$output")"
output="$(cd "$(dirname "$output")" && pwd)/$(basename "$output")"
if [[ -e "$output" || -e "${output%.image}.changes" || -e "${output%.image}.archive.json" ]]; then
  echo 'Refusing to replace an existing image or changes file' >&2
  exit 1
fi

"$vm" "$base" save "${output%.image}"
for sources in "$(dirname "$base")"/*.sources; do
  if [[ -f "$sources" && ! -e "$(dirname "$output")/$(basename "$sources")" ]]; then
    cp "$sources" "$(dirname "$output")/$(basename "$sources")"
  fi
done
TAPEDECK_SRC="$repo/image/src" "$vm" "$output" st --save --quit "$here/load.st"
"$vm" "$output" st "$here/save-agent.st"
printf 'Saved %s\n' "$output"
