# Developer tasks: `make setup` once, then `make test`.
.PHONY: setup test

setup:
	@cp test/cases.sample.json test/cases.json
	@echo "setup: wrote test/cases.json"

test:
	@node --test --test-reporter=dot
