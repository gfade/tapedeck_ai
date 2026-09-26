#!/usr/bin/env bash
# Serve a runner store from the image on http://127.0.0.1:4778 (see serve.st).
#
#   image/scripts/serve.sh [store-dir]
#
# The store is the argument, else $TAPEDECK_HOME, else <repo>/store. Uses
# image/pharo/TapeDeck.image when build-pharo13.sh made it, else a throwaway copy of the
# Glamorous Toolkit image in $GT_HOME. TAPEDECK_IMAGE_PORT and TAPEDECK_REFRESH are passed on.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
image_dir="$(dirname "$here")"
repo="$(dirname "$image_dir")"
store="${1:-${TAPEDECK_HOME:-$repo/store}}"
if [ ! -d "$store" ]; then
	echo "No runner store at $store" >&2
	exit 1
fi
store="$(cd "$store" && pwd)"
export TAPEDECK_SRC="$image_dir/src"
export TAPEDECK_HOME="$store"

if [ -x "$image_dir/pharo/pharo" ] && [ -f "$image_dir/pharo/TapeDeck.image" ]; then
	cd "$image_dir/pharo"
	exec ./pharo TapeDeck.image st "$here/serve.st" "$store"
fi

: "${GT_HOME:?no image/pharo/TapeDeck.image: run build-pharo13.sh or set GT_HOME to a Glamorous Toolkit directory}"
# shellcheck source=gt-copy.sh
source "$here/gt-copy.sh"
work="$(gt_copy "$GT_HOME")"
trap 'rm -rf "$work"' EXIT
cd "$work"
"$GT_HOME/bin/GlamorousToolkit-cli" "$work/$(ls "$work" | grep '\.image$' | head -n 1)" st "$here/serve.st" "$store"
