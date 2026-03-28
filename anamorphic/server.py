"""
JSON-lines subprocess server for the Ink TUI.

The TUI spawns this as a child process and communicates via stdin/stdout.
Each message is a single JSON line. Stderr is inherited (visible in terminal).

Supported actions:
  analyze_root      problem → {markdown}
  assess            problem → {is_leaf}
  decompose         problem, parent_problem? → {subproblems}
  structured_plan   problem → {schema}
  identify_deps     problems[] → {deps: {index: [index]}}
  refine_plan       problem, schema, feedback → {schema}
  refine_decompose  problem, subproblems[], feedback → {subproblems}
"""
from __future__ import annotations
import sys
import json
from .llm import LLMClient


def handle(req: dict, llm: LLMClient) -> dict:
    action = req["action"]
    rid = req.get("id", "0")

    if action == "analyze_root":
        md = llm.analyze_root(req["problem"])
        return {"id": rid, "markdown": md}

    elif action == "assess":
        return {"id": rid, "is_leaf": llm.assess(req["problem"])}

    elif action == "decompose":
        subs = llm.decompose(req["problem"], req.get("parent_problem", ""))
        return {"id": rid, "subproblems": subs}

    elif action == "structured_plan":
        schema = llm.structured_plan(req["problem"])
        return {"id": rid, "schema": schema}

    elif action == "identify_deps":
        deps = llm.identify_dependencies(req["problems"])
        return {"id": rid, "deps": {str(k): v for k, v in deps.items()}}

    elif action == "refine_plan":
        schema = llm.refine_plan(req["problem"], req["schema"], req["feedback"])
        return {"id": rid, "schema": schema}

    elif action == "refine_decompose":
        subs = llm.refine_decompose(req["problem"], req["subproblems"], req["feedback"])
        return {"id": rid, "subproblems": subs}

    else:
        return {"id": rid, "error": f"unknown action: {action}"}


def main() -> None:
    llm = LLMClient()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req: dict = {}
        try:
            req = json.loads(line)
            resp = handle(req, llm)
        except Exception as e:
            resp = {"id": req.get("id", "0"), "error": str(e)}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
