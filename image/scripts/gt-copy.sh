#!/usr/bin/env bash
# Shared by test-gt.sh and serve.sh: make a throwaway copy of the Glamorous Toolkit image in
# $GT_HOME and print its directory. GT_HOME itself is never modified: the image and changes
# files are copied, the rest (sources, gt-extra) is linked.

gt_copy() {
	local gt="$1" work image
	image="$(ls "$gt"/*.image 2>/dev/null | head -n 1)"
	if [ ! -x "$gt/bin/GlamorousToolkit-cli" ] || [ -z "$image" ]; then
		echo "GT_HOME=$gt does not look like a Glamorous Toolkit directory (bin/GlamorousToolkit-cli, *.image)" >&2
		return 1
	fi
	work="$(mktemp -d "${TMPDIR:-/tmp}/tapedeck-gt.XXXXXX")"
	cp "$image" "${image%.image}.changes" "$work/"
	for extra in "$gt"/*.sources "$gt/gt-extra"; do
		if [ -e "$extra" ]; then ln -s "$extra" "$work/"; fi
	done
	echo "$work"
}
