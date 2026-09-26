# TapeDeck — 60-second live demo

Original narration combining short, concrete sentences with the idea of augmenting human work and improving the tools of improvement. Inspired by Hemingway's economy and Engelbart's systems perspective; not quotations, impersonation, or text attributed to either writer.

| Time | Narration | Actual screen evidence / judging purpose |
| --- | --- | --- |
| 00:00–00:10 | Two plus three should make five. This agent returned minus one. It fixed the code, ran a disabled test command, then undid its fix. | The deterministic fixture's real failure: sum(2,3) is -1 instead of 5. Technical demo. |
| 00:10–00:20 | TapeDeck kept the trace. Replay costs no new model calls. The harness learns to use the repository's task runner, not npm test. | An automatic rule selects `./tasks test`. Creativity and implementation depth. |
| 00:20–00:31 | The patch is small: add, don't subtract. The proof is not. A fork and two fresh runs pass the real and hidden checks. | `return a - b` becomes `return a + b`; separate verifiers confirm the result. Technical proof. |
| 00:31–00:42 | Qwen runs locally. Its checks pass with seven direct tools reduced to three. We improve the working system, not just its next answer. | Real local Qwen inference and verified tool-access reduction. No claim that Qwen initially failed. |
| 00:42–00:53 | MongoDB GridFS keeps the image, files, and history. This prior Atlas download reopens. Four hundred ninety-seven restored payloads pass fresh checksums. | Live reopening and hashes of an explicitly labeled prior Atlas download. MongoDB implementation depth. |
| 00:53–01:00 | Keep the evidence. Test the change. Give people a reliable way to improve the tools that help them think. | Repeatable, inspectable work as a human-augmentation goal. Impact, not a quantified production claim. |

## Exactly what failed and what worked

1. **Task t01:** repair `sum()` in `src/sum.js`. It subtracts, so `sum(2,3)` produces `-1` instead of `5`.
2. **Failed attempt:** the deterministic agent makes the correct `a + b` edit, then runs `npm test`. This fixture deliberately disables that command and tells it to run `./tasks test`. The agent treats the command failure as a bad patch and reverts to subtraction. The independent verifier confirms `-1 !== 5`.
3. **Harness fix:** trace-driven policy generation adds a rule to use the repository's task runner and documented setup, rather than `npm test`. This is a rule change, not a model-weight update.
4. **Code fix retained:** the candidate keeps `return a + b`, invokes `./tasks test`, and does not revert the good patch.
5. **Proof:** the fork and two independent fresh runs all pass the repository tests and hidden checks, including `sum(2,3) = 5`, `sum(10,-4) = 6`, and `sum(0.5,0.25) = 0.75`.
6. **Separate Qwen result:** real Qwen3.5 2B already succeeds on this task. Its candidate narrows direct tool access from seven tools to `read`, `bash`, and `edit` while retaining passing fork/fresh checks. This is not evidence that Qwen was repaired or that token use fell.

## Recording truth

- All **60 seconds** are continuous real-time screen capture of the running local web app, including its streamed terminal output. The full workflow finishes in approximately **41.5 seconds**, and the capture continues on the actual live result page. No slide deck, reconstructed UI, cuts, accelerated execution, substituted stills, or fabricated results.
- Native Terminal UI automation is unavailable in this environment. The app's terminal pane displays stdout/status events from the real Node runner, Ollama inference, Git worktrees, archive functions, and Pharo subprocess.
- The first model is clearly labeled **Repair fixture** (`scripted/toy`). The second is the real, locally installed **Qwen3.5 2B**. The fixture demonstrates correction; Qwen demonstrates passing checks with reduced direct tool access, not a claim that Qwen initially failed.
- The model-request gateway counts real local provider requests independently. Strict replay must make zero provider calls.
- The `Agent.image` used in the MongoDB section was uploaded and downloaded earlier. This recording reopens it and verifies its bytes now. It is not a live cloud upload/download, and it is not the newly created Qwen experiment image.
- Narration is synthetic system speech, not a clone of either writer. The subtitle file contains this same original script.
- The app timer correctly stops at the actual completion time while screen capture continues. The completed state is not a claim that more computation or a cloud transfer is happening.

## Rubric coverage

- **Technical Demo — 35%:** actual failed/passing verifiers, live local inference, zero-call replay, automatic promotion, image recovery.
- **Implementation Difficulty — 30%:** normalized tapes, Git checkpoint restoration, candidate/fresh-run comparison, versioned policies, portable images, GridFS manifests and hashes.
- **Creativity — 15%:** use a replayable agent memory to improve the harness itself rather than retrying a prompt.
- **Impact Potential — 20%:** make agent changes inspectable, repeatable, and recoverable, reducing blind retries and lost work. These are intended benefits, not measured customer outcomes.
