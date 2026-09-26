#!/usr/bin/env bash
# Run the TapeDeck tests headless in a throwaway copy of a Glamorous Toolkit image.
#
#   GT_HOME=/path/to/glamoroustoolkit image/scripts/test-gt.sh
#
# GT_HOME holds bin/GlamorousToolkit-cli and GlamorousToolkit.image; it is not modified.
# The fixture store defaults to <repo>/fixtures/store (override with TAPEDECK_FIXTURES).
# Exits with the test script's status: 0 when every test passed.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
image_dir="$(dirname "$here")"
repo="$(dirname "$image_dir")"
: "${GT_HOME:?set GT_HOME to a Glamorous Toolkit directory}"

# shellcheck source=gt-copy.sh
source "$here/gt-copy.sh"
work="$(gt_copy "$GT_HOME")"
trap 'rm -rf "$work"' EXIT

export TAPEDECK_SRC="$image_dir/src"
export TAPEDECK_FIXTURES="${TAPEDECK_FIXTURES:-$repo/fixtures/store}"
cd "$work"
status=0
"$GT_HOME/bin/GlamorousToolkit-cli" "$work/$(ls "$work" | grep '\.image$' | head -n 1)" st "$here/test.st" || status=$?
exit "$status"
