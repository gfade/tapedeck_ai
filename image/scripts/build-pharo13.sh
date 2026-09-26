#!/usr/bin/env bash
# Build image/pharo/TapeDeck.image: download Pharo 13 and its VM into image/pharo/, load
# TapeDeck (Metacello group 'default') headless, save the image, then run the tests.
#
#   image/scripts/build-pharo13.sh
#
# Needs curl and network access to get.pharo.org and files.pharo.org. Set
# TAPEDECK_SKIP_TESTS=1 to skip the tests. Open the result with image/pharo/pharo-ui TapeDeck.image
# (from image/pharo), or serve a store with image/scripts/serve.sh.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
image_dir="$(dirname "$here")"
repo="$(dirname "$image_dir")"
pharo_dir="$image_dir/pharo"

mkdir -p "$pharo_dir"
cd "$pharo_dir"
if [ ! -f Pharo.image ] || [ ! -x pharo ]; then
	curl -fsSL https://get.pharo.org/64/130+vm | bash
fi

rm -f TapeDeck.image TapeDeck.changes
./pharo Pharo.image save TapeDeck
TAPEDECK_SRC="$image_dir/src" TAPEDECK_GROUP=default \
	./pharo TapeDeck.image st --save --quit "$here/load.st"

if [ "${TAPEDECK_SKIP_TESTS:-0}" != 1 ]; then
	TAPEDECK_SRC="$image_dir/src" TAPEDECK_GROUP=default \
		TAPEDECK_FIXTURES="${TAPEDECK_FIXTURES:-$repo/fixtures/store}" \
		./pharo TapeDeck.image st "$here/test.st"
fi
echo "Built $pharo_dir/TapeDeck.image"
