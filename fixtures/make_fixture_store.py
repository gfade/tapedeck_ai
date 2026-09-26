#!/usr/bin/env python3
"""Generate a small, hand-made runner store that follows INTERFACES.md.

It exists so the image and the runner can be built and tested before real runs exist.
After integration, `fixtures/store` is regenerated from real runs; this script stays as a
readable example of the formats.

    python3 fixtures/make_fixture_store.py fixtures/store
"""
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = json.load(open(os.path.join(HERE, "_system_template.json")))
PI_DIR = "/home/claude/tools/pi-probe/node_modules/@earendil-works/pi-coding-agent"

T0 = datetime(2026, 9, 26, 15, 30, 0, tzinfo=timezone.utc)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def ms(t):
    return int(t.timestamp() * 1000)


def sha(text):
    return hashlib.sha1(text.encode()).hexdigest()


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def subst(value, cwd):
    if isinstance(value, str):
        for src, dst in sorted([(cwd, "<cwd>"), (PI_DIR, "<pi>")], key=lambda p: -len(p[0])):
            value = value.replace(src, dst)
        return value
    if isinstance(value, list):
        return [subst(v, cwd) for v in value]
    if isinstance(value, dict):
        return {k: subst(v, cwd) for k, v in value.items()}
    return value


def normalize(msg, cwd):
    role = msg["role"]
    if role == "system":
        out = {"role": "system", "content": msg.get("content") or ""}
        if msg.get("sections") is not None:
            out["sections"] = [[k, v] for k, v in msg["sections"].items()]
        if msg.get("toolsAdded"):
            out["toolsAdded"] = [json.loads(json.dumps(t)) for t in msg["toolsAdded"]]
        if msg.get("toolsRemoved"):
            out["toolsRemoved"] = [t["name"] for t in msg["toolsRemoved"]]
    elif role == "user":
        c = msg["content"]
        out = {"role": "user", "content": [{"type": "text", "text": c}] if isinstance(c, str) else c}
    elif role == "assistant":
        blocks = []
        for b in msg["content"]:
            if b["type"] == "text":
                blocks.append({"type": "text", "text": b["text"]})
            elif b["type"] == "thinking":
                blocks.append({"type": "thinking", "thinking": b["thinking"]})
            elif b["type"] == "toolCall":
                blocks.append({"type": "toolCall", "id": b["id"], "name": b["name"], "arguments": b["arguments"]})
        out = {"role": "assistant", "content": blocks}
    elif role == "toolResult":
        out = {"role": "toolResult", "toolCallId": msg["toolCallId"], "toolName": msg["toolName"],
               "isError": msg["isError"], "content": msg["content"]}
    else:
        out = {"role": role, "content": str(msg.get("content"))}
    return subst(out, cwd)


def usage_for(n_in, n_out):
    cin, cout = n_in * 3 / 1e6, n_out * 15 / 1e6
    return {"input": n_in, "output": n_out, "cacheRead": 0, "cacheWrite": 0, "totalTokens": n_in + n_out,
            "cost": {"input": cin, "output": cout, "cacheRead": 0, "cacheWrite": 0, "total": cin + cout}}


class Session:
    def __init__(self, run_id, cwd, t, label, mode, upstream, source=None, fork_at=None, lenient=None):
        self.lines = []
        self.id_counter = 0
        self.run_id = run_id
        self.cwd = cwd
        self.t = t
        self.parent = None
        self.session_id = sha(run_id)[:8] + "-0000-7000-8000-" + sha(run_id)[8:20]
        self.lines.append({"type": "session", "version": 3, "id": self.session_id, "timestamp": iso(t), "cwd": cwd})
        self.add({"type": "model_change", "provider": "tape", "modelId": "main"})
        self.add({"type": "thinking_level_change", "thinkingLevel": "off"})
        self.base = sha(run_id + "base")
        self.add({"type": "custom", "customType": "tape.header", "data": {
            "v": 1, "mode": mode, "label": label, "cwd": cwd, "piVersion": "0.87.1",
            "upstream": upstream, "snapshotBase": self.base, "refPrefix": f"refs/tapes/{self.session_id}",
            "source": source, "forkAt": fork_at, "lenient": lenient or []}})
        self.request = []  # full normalized request so far
        self.prev_request = []
        self.context = []  # raw messages as the provider sees them
        self.step = 0
        self.steps = []

    def next_id(self):
        self.id_counter += 1
        return sha(f"{self.run_id}:{self.id_counter}")[:8]

    def add(self, entry):
        self.t += timedelta(milliseconds=350)
        e = dict(entry)
        e["id"] = self.next_id()
        e["parentId"] = self.parent
        e["timestamp"] = iso(self.t)
        # keep pi's field order: type, id, parentId, timestamp, rest
        ordered = {"type": e.pop("type"), "id": e.pop("id"), "parentId": e.pop("parentId"), "timestamp": e.pop("timestamp")}
        ordered.update(e)
        self.lines.append(ordered)
        self.parent = ordered["id"]
        return ordered["id"]

    def message(self, msg):
        msg = dict(msg)
        msg["timestamp"] = ms(self.t)
        eid = self.add({"type": "message", "message": msg})
        return eid

    def system(self, extra_sections=None):
        sections = dict(TEMPLATE["sections"])
        sections["cwd"] = f"<cwd>\n{self.cwd}\n</cwd>"
        sections["docs"] = sections["docs"].replace("/home/claude/tools/pi-probe/node_modules/@earendil-works/pi-coding-agent", PI_DIR)
        if extra_sections:
            ordered = {}
            for k, v in sections.items():
                if k == "cwd":
                    ordered.update(extra_sections)
                ordered[k] = v
            sections = ordered
        msg = {"role": "system", "content": "", "sections": sections, "toolsAdded": TEMPLATE["toolsAdded"]}
        self.message(msg)
        self.context.append(msg)

    def user(self, text):
        msg = {"role": "user", "content": [{"type": "text", "text": text}]}
        self.message(msg)
        self.context.append(msg)

    def turn(self, text, calls, live=True, upstream=("scripted", "toy")):
        """calls: list of (name, args, result_text, is_error, exec)"""
        self.step += 1
        k = self.step
        full = [normalize(m, self.cwd) for m in self.context]
        keep = 0
        while keep < min(len(full), len(self.prev_request)) and canonical(full[keep]) == canonical(self.prev_request[keep]):
            keep += 1
        request = {"keep": keep, "append": full[keep:]}
        request_hash = hashlib.sha256(canonical(full).encode()).hexdigest()
        self.prev_request = full
        content = []
        if text:
            content.append({"type": "text", "text": text})
        for n, (name, args, *_rest) in enumerate(calls):
            content.append({"type": "toolCall", "id": f"toy_{k}_{n}", "name": name, "arguments": args})
        n_in = max(1, len(canonical(full)) // 4)
        n_out = max(1, len(json.dumps(content)) // 4)
        usage = usage_for(n_in, n_out)
        if not live:
            # replayed steps keep token counts but cost nothing
            usage = dict(usage)
            usage["cost"] = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}
        amsg = {"role": "assistant", "content": content, "api": "tapedeck-scripted", "provider": upstream[0],
                "model": upstream[1], "usage": usage, "stopReason": "toolUse" if calls else "stop"}
        resp_id = self.message(amsg)
        self.context.append(amsg)
        tools = []
        for n, (name, args, result_text, is_error, exec_kind) in enumerate(calls):
            rmsg = {"role": "toolResult", "toolCallId": f"toy_{k}_{n}", "toolName": name,
                    "content": [{"type": "text", "text": result_text}], "isError": is_error}
            if is_error:
                rmsg["details"] = {}
            rid = self.message(rmsg)
            self.context.append(rmsg)
            snap = sha(f"{self.run_id}:s{k}-t{n+1}") if exec_kind != "none" else None
            tools.append({"id": f"toy_{k}_{n}", "name": name, "args": args, "exec": exec_kind,
                          "resultEntryId": rid, "isError": is_error, "snapshot": snap})
        snap_after = sha(f"{self.run_id}:s{k}")
        self.add({"type": "custom", "customType": "tape.step", "data": {
            "v": 1, "step": k, "live": live, "responseEntryId": resp_id, "request": request,
            "requestHash": request_hash, "tools": tools, "snapshotAfter": snap_after, "usage": amsg["usage"]}})
        self.steps.append({"step": k, "live": live, "usage": usage_for(n_in, n_out), "snapshotAfter": snap_after})
        return k

    def write(self, path):
        with open(path, "w") as f:
            for line in self.lines:
                f.write(json.dumps(line, ensure_ascii=False) + "\n")


PROMPT = "The test for sum() in src/sum.js fails. Fix the bug and make sure the tests pass."
LS = "AGENTS.md\nREADME.md\npackage.json\nsrc\ntasks\ntest"
SUM_BUGGY = "export function sum(a, b) {\n  return a - b;\n}\n"
NPM_FAIL = ("> t01@1.0.0 test\n> echo 'npm test is disabled here: run ./tasks test' && exit 1\n\n"
            "npm test is disabled here: run ./tasks test\n\n\nCommand exited with code 1")
TASKS_OK = "# tests 3\n# pass 3\n# fail 0"
RULE = "Run tests with the repository's task runner (./tasks test). Never run npm test."


def zero_usage():
    return {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": 0}


def sum_usage(steps, live):
    u = zero_usage()
    for s in steps:
        if s["live"] == live:
            su = s["usage"]
            for key in ("input", "output", "cacheRead", "cacheWrite", "totalTokens"):
                u[key] += su[key]
            u["cost"] += su["cost"]["total"]
    u["cost"] = round(u["cost"], 8)
    return u


def write_run(store, s, run, report_extra, verify):
    d = os.path.join(store, "runs", run["id"])
    os.makedirs(d, exist_ok=True)
    s.write(os.path.join(d, "session.jsonl"))
    replayed = sum(1 for st in s.steps if not st["live"])
    live = sum(1 for st in s.steps if st["live"])
    report = {
        "format": "tapedeck.report/v1", "mode": run["_mode"], "label": run["variant"],
        "sessionId": s.session_id, "sessionFile": os.path.join("/abs/store/runs", run["id"], "session.jsonl"),
        "source": report_extra.get("source"), "forkAt": run.get("forkAt"), "lenient": run.get("lenient", []),
        "steps": {"replayed": replayed, "live": live, "total": len(s.steps)},
        "divergence": report_extra.get("divergence"),
        "usage": {"live": sum_usage(s.steps, True), "replayed": sum_usage(s.steps, False)},
        "snapshots": {"base": s.base, "final": s.steps[-1]["snapshotAfter"]},
        "finalRestore": None, "errors": [],
    }
    json.dump(report, open(os.path.join(d, "tape-report.json"), "w"), indent=1)
    if verify is not None:
        json.dump(verify, open(os.path.join(d, "verify.json"), "w"), indent=1)
    out = {k: v for k, v in run.items() if not k.startswith("_")}
    out.update({
        "format": "tapedeck.run/v1", "status": "done", "error": None,
        "verify": verify, "pass": None if verify is None else verify["pass"],
        "steps": report["steps"], "usage": report["usage"]["live"], "savedUsage": report["usage"]["replayed"],
        "divergence": report["divergence"], "snapshotBase": s.base, "snapshotFinal": s.steps[-1]["snapshotAfter"],
        "sessionFile": f"runs/{run['id']}/session.jsonl", "reportFile": f"runs/{run['id']}/tape-report.json",
        "repo": f"repos/{run['task']}.git",
    })
    json.dump(out, open(os.path.join(d, "run.json"), "w"), indent=1)
    return out


def main(store):
    if os.path.exists(store):
        shutil.rmtree(store)
    os.makedirs(os.path.join(store, "runs"))
    os.makedirs(os.path.join(store, "reports"))
    up = {"provider": "scripted", "model": "toy"}

    # 1. vanilla baseline: fixes the bug, runs npm test (trap), reverts, fails.
    base_id = "20260926-153000-t01-vanilla-run-a1b2"
    cwd = f"/abs/store/work/{base_id}"
    s = Session(base_id, cwd, T0, "vanilla", "record", up)
    s.system()
    s.user(PROMPT)
    s.turn("Let me look at the repository.", [("bash", {"command": "ls"}, LS, False, "real")])
    s.turn(None, [("read", {"path": "src/sum.js"}, SUM_BUGGY, False, "real")])
    s.turn("sum subtracts instead of adding.", [("edit", {"path": "src/sum.js", "edits": [{"oldText": "a - b", "newText": "a + b"}]},
                                                  "Successfully replaced 1 block(s) in src/sum.js.", False, "real")])
    s.turn(None, [("bash", {"command": "npm test"}, NPM_FAIL, True, "real")])
    s.turn("The test command fails, so I reverted my change to be safe.",
           [("edit", {"path": "src/sum.js", "edits": [{"oldText": "a + b", "newText": "a - b"}]},
             "Successfully replaced 1 block(s) in src/sum.js.", False, "real")])
    s.turn("I could not get the tests to pass; the test command is broken.", [])
    base = write_run(store, s, {"id": base_id, "kind": "run", "_mode": "record", "task": "t01", "split": "held-in",
                                "variant": "vanilla", "model": "scripted/toy", "parent": None, "forkAt": None,
                                "lenient": [], "tapeSource": None, "startedAt": iso(T0),
                                "finishedAt": iso(T0 + timedelta(seconds=2)), "durationMs": 2100},
                     {}, {"exitCode": 1, "pass": False, "output": "not ok 1 - sum adds", "durationMs": 40})

    # 2. fork of the baseline with the rule, live from step 4 (the first npm call).
    fork_id = "20260926-153100-t01-rule-taskrunner-fork-c3d4"
    cwd2 = f"/abs/store/work/{fork_id}"
    src = {"kind": "session", "location": f"/abs/store/runs/{base_id}/session.jsonl", "tapeId": None, "steps": 6}
    s2 = Session(fork_id, cwd2, T0 + timedelta(minutes=1), "rule-taskrunner", "fork", up, source=src, fork_at=4,
                 lenient=["system"])
    s2.system({"tapedeck-rules": f"<tapedeck-rules>\n- {RULE}\n</tapedeck-rules>"})
    s2.user(PROMPT)
    s2.turn("Let me look at the repository.", [("bash", {"command": "ls"}, LS, False, "stub")], live=False)
    s2.turn(None, [("read", {"path": "src/sum.js"}, SUM_BUGGY, False, "stub")], live=False)
    s2.turn("sum subtracts instead of adding.", [("edit", {"path": "src/sum.js", "edits": [{"oldText": "a - b", "newText": "a + b"}]},
                                                   "Successfully replaced 1 block(s) in src/sum.js.", False, "stub")], live=False)
    divergence = {"v": 1, "step": 4, "kind": "forced", "toolId": None, "at": "request", "detail": None,
                  "restoredSnapshot": sha(f"{base_id}:s3-t1"), "action": "live"}
    s2.add({"type": "custom", "customType": "tape.divergence", "data": divergence})
    s2.turn(None, [("bash", {"command": "./tasks test"}, TASKS_OK, False, "real")])
    s2.turn("Fixed: sum now adds, and ./tasks test passes.", [])
    fork = write_run(store, s2, {"id": fork_id, "kind": "fork", "_mode": "fork", "task": "t01", "split": "held-in",
                                 "variant": "rule-taskrunner", "model": "scripted/toy", "parent": base_id, "forkAt": 4,
                                 "lenient": ["system"], "tapeSource": src["location"],
                                 "startedAt": iso(T0 + timedelta(minutes=1)),
                                 "finishedAt": iso(T0 + timedelta(minutes=1, seconds=1)), "durationMs": 900},
                     {"source": src, "divergence": divergence},
                     {"exitCode": 0, "pass": True, "output": "# pass 3", "durationMs": 38})

    # 3. full rerun with the rule.
    rerun_id = "20260926-153200-t01-rule-taskrunner-run-e5f6"
    cwd3 = f"/abs/store/work/{rerun_id}"
    s3 = Session(rerun_id, cwd3, T0 + timedelta(minutes=2), "rule-taskrunner", "record", up)
    s3.system({"tapedeck-rules": f"<tapedeck-rules>\n- {RULE}\n</tapedeck-rules>"})
    s3.user(PROMPT)
    s3.turn("Let me look at the repository.", [("bash", {"command": "ls"}, LS, False, "real")])
    s3.turn(None, [("read", {"path": "src/sum.js"}, SUM_BUGGY, False, "real")])
    s3.turn("sum subtracts instead of adding.", [("edit", {"path": "src/sum.js", "edits": [{"oldText": "a - b", "newText": "a + b"}]},
                                                   "Successfully replaced 1 block(s) in src/sum.js.", False, "real")])
    s3.turn(None, [("bash", {"command": "./tasks test"}, TASKS_OK, False, "real")])
    s3.turn("Fixed: sum now adds, and ./tasks test passes.", [])
    rerun = write_run(store, s3, {"id": rerun_id, "kind": "run", "_mode": "record", "task": "t01", "split": "held-in",
                                  "variant": "rule-taskrunner", "model": "scripted/toy", "parent": None, "forkAt": None,
                                  "lenient": [], "tapeSource": None, "startedAt": iso(T0 + timedelta(minutes=2)),
                                  "finishedAt": iso(T0 + timedelta(minutes=2, seconds=2)), "durationMs": 1800},
                      {}, {"exitCode": 0, "pass": True, "output": "# pass 3", "durationMs": 41})

    # 4. a zero-token replay of the baseline with a guard policy: nothing diverges.
    replay_id = "20260926-153300-t01-guard-secrets-replay-a7b8"
    cwd4 = f"/abs/store/work/{replay_id}"
    s4 = Session(replay_id, cwd4, T0 + timedelta(minutes=3), "guard-secrets", "replay", up, source=src)
    s4.system()
    s4.user(PROMPT)
    s4.turn("Let me look at the repository.", [("bash", {"command": "ls"}, LS, False, "stub")], live=False)
    s4.turn(None, [("read", {"path": "src/sum.js"}, SUM_BUGGY, False, "stub")], live=False)
    s4.turn("sum subtracts instead of adding.", [("edit", {"path": "src/sum.js", "edits": [{"oldText": "a - b", "newText": "a + b"}]},
                                                   "Successfully replaced 1 block(s) in src/sum.js.", False, "stub")], live=False)
    s4.turn(None, [("bash", {"command": "npm test"}, NPM_FAIL, True, "stub")], live=False)
    s4.turn("The test command fails, so I reverted my change to be safe.",
            [("edit", {"path": "src/sum.js", "edits": [{"oldText": "a + b", "newText": "a - b"}]},
              "Successfully replaced 1 block(s) in src/sum.js.", False, "stub")], live=False)
    s4.turn("I could not get the tests to pass; the test command is broken.", [], live=False)
    write_run(store, s4, {"id": replay_id, "kind": "replay", "_mode": "replay", "task": "t01", "split": "held-in",
                          "variant": "guard-secrets", "model": "scripted/toy", "parent": base_id, "forkAt": None,
                          "lenient": [], "tapeSource": src["location"], "startedAt": iso(T0 + timedelta(minutes=3)),
                          "finishedAt": iso(T0 + timedelta(minutes=3, seconds=1)), "durationMs": 600},
              {"source": src, "divergence": None}, None)

    gate = {
        "format": "tapedeck.gate/v1", "name": "rule-taskrunner-vs-vanilla", "candidate": "rule-taskrunner",
        "baseline": "vanilla", "model": "scripted/toy", "createdAt": iso(T0 + timedelta(minutes=4)),
        "rows": [{
            "task": "t01", "split": "held-in", "baselineRun": base_id, "baselinePass": False,
            "forkRun": fork_id, "forkPass": True, "forkAt": 4, "divergence": fork["divergence"],
            "forkUsage": fork["usage"], "savedUsage": fork["savedUsage"],
            "rerunRuns": [rerun_id], "rerunPass": [True], "rerunUsage": rerun["usage"], "agree": True}],
        "summary": {
            "n": 1, "agreement": 1.0,
            "forkTokens": fork["usage"]["totalTokens"], "rerunTokens": rerun["usage"]["totalTokens"],
            "forkCost": fork["usage"]["cost"], "rerunCost": rerun["usage"]["cost"],
            "tokenSavings": round(1 - fork["usage"]["totalTokens"] / rerun["usage"]["totalTokens"], 4),
            "baselinePassRate": {"held-in": 0.0}, "candidateForkPassRate": {"held-in": 1.0},
            "candidateRerunPassRate": {"held-in": 1.0}},
    }
    json.dump(gate, open(os.path.join(store, "reports", "rule-taskrunner-vs-vanilla.json"), "w"), indent=1)
    print("wrote", store)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "store"))
