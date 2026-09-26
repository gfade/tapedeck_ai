# Statement One: TapeDeck evolves its runtime harness

## The working loop

`record → strict replay → diagnose → propose → fork → fresh verification × 2 → promote or retain`

Run this from the repository root with Node 22.19+:

```bash
node runner/src/cli.ts evolve --home store/adaptive --user judge --task t01 --task t04
node runner/src/cli.ts adaptive-run --home store/adaptive --user judge --task t01 --task t04
```

The default model is the explicitly labeled deterministic `scripted/toy` fixture. To exercise actual local inference with the already-installed Qwen model:

```bash
TAPEDECK_MODELS_FILE="$PWD/config/models.ollama.json" \
  node runner/src/cli.ts evolve --home store/adaptive-qwen \
  --user judge --task t01 --model ollama/tapedeck-qwen35-2b
```

Use `npm run demo:local:setup` first if the Ollama alias is not installed. There is no cloud/model fallback. Each run has a timeout (`--timeout`, seconds); each evaluation is bounded to 1–12 tasks and 2–5 fresh repetitions (`--repeat`). One command performs one evolution cycle; rerunning starts from the previously promoted profile.

## What changes automatically

| Architecture component | Implemented adaptation | Runtime enforcement |
| --- | --- | --- |
| System rules | Recorded npm/task-runner and generated-file evidence selects vetted corrective rules | `before_agent_start` injects versioned rules |
| Context policy | Large traces trial an 8,000-character rather than 16,000-character tool-text budget | `context` clips individual tool-result text blocks, retaining message roles, tool-call pairing, and user messages |
| Tool access | Candidate narrows direct tools to those observed in the workflow | `tool_call` blocks tools outside the allowlist; schemas remain stable for replay |
| Guardrails | Generated-file evidence adds a direct `sed -i` command gate | Existing path/command gates plus immutable minimum rules |
| User/task environment | Separate active policy for each user label, exact task set, and model | Scope-hashed persistent profiles and isolated Git worktrees |

This is a bounded, deterministic proposal engine, not an LLM pretending to have rewritten its own source code. The agent's observed behavior drives actual runtime policy changes. Adding new vetted mutation families is an explicit code change. The user label selects a local namespace; it is not authentication or inferred personalization.

## Why replay and fork matter

Every baseline must strictly replay with zero live steps, zero new tokens, matching recorded step counts, and no divergence before a proposal is evaluated. The exact variant is saved in each run's `variant.json`, so later changes to active policies cannot silently alter that run's replay configuration.

Candidate forks deliberately start live at **step 1**. Context and setup rules can change the first action: a late fork could reuse precisely the bad prefix we need to repair. This conservative choice favors correctness over token savings. Independent fresh runs then catch fork-only successes and setup dependencies. The existing manual `fork`/`compare` workflow remains available for later divergence-point experiments.

Promotion requires every fork and at least two fresh verifications per task to pass. Improvement means repairing a failing baseline, reducing average fresh-run tokens by more than 5%, or narrowing direct tool access without losing evaluation-set correctness. No result implies broad generalization; add representative tasks with repeated `--task` flags. The default includes t04, a fixture designed to expose late-fork/setup disagreement.

The previous active profile remains unchanged on candidate rejection or evaluation error. The scope has an exclusive filesystem lock; a crashed process leaves the lock for explicit operator inspection rather than racing another promotion.

## Verified September 26, 2026

- **Deterministic repair demo:** t01 and t04 baselines both failed. Automatic rule/tool adaptation passed both candidate forks and all four independent fresh runs. Both strict replays used zero new tokens. Report ID: `8716070a-3647-45e2-a1cf-a283f62a3fac`.
- **Real local Qwen3.5 2B:** t01 already passed; the candidate narrowed seven direct tools to `read`, `bash`, and `edit`. Its fork and both fresh runs still passed; strict replay reproduced all four steps with zero new tokens. Fresh usage was 8,223 and 8,232 tokens versus baseline 8,217: **this demonstrates tool-surface reduction, not a speed/token improvement or a repaired Qwen failure**. Report ID: `2ec10af5-96cb-4c22-9d38-9f3d377c7c57`.
- **Portability:** an evolved store was archived, restored into a separate directory, and its promoted policy successfully ran both tasks. Archive tests also verify round-tripping active profiles and per-run policy snapshots.

The final demo traces did not require context truncation or new generated-file guards; those mutation paths are covered separately by policy tests. All figures are small local experiments, not production performance claims.

## MongoDB and portable evidence

Profiles and decision reports live under `reports/harness/<scope-hash>/`; each run carries its exact `variant.json`. Both are inside the existing archive allowlist, alongside tapes, verifier results, files, and Git bundles. Capturing the evolved store therefore embeds the evolution history in the companion archive and existing Pharo image workflow:

```bash
node runner/src/cli.ts archive --home store/adaptive --output Agent.archive.json
```

Use the existing documented image-save and `atlas-push`/`atlas-pull` commands to publish and recover the same artifacts through Atlas GridFS and checksum-verified manifests. Evolution itself does **not** upload automatically or transmit credentials to the model. Atlas availability and credentials are still required for publication; a local successful experiment is not an Atlas upload claim.

## Safety and scope limits

- The immutable policy floor cannot be removed by a generated candidate. Existing guardrails cannot be weakened and direct tools cannot be expanded during promotion.
- Regex path/command gates are defense in depth, **not an OS sandbox**. Bash, interpreter calls, symlinks, and indirect access can bypass lexical policies. Use a container/OS sandbox for untrusted repositories; this implementation does not claim to provide one.
- Shorter tool text is a per-block character limit, not a total context-token cap; images, metadata, and user messages are not truncated.
- Proposals use a bounded template vocabulary; tool output is evidence, never executable policy instructions.
- Benchmark verifiers stay outside the agent's disposable working repository. Safety policies and passing benchmark tests do not establish production security or general task performance.
- Existing video/deck demonstrate the earlier record/replay/fork workflow; they have not been regenerated to claim this new evolution loop.

Implementation: `runner/src/evolve.ts`, `runner/harness/adaptive-policy.ts`, `runner/harness/variant.ts`, and the per-run snapshot integration in `runner/src/runs.ts`.
