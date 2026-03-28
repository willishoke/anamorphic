#!/usr/bin/env python3
"""
Autonomous problem space explorer.

Usage:
    python explore.py "Build a REST API for a todo app"
    python explore.py --max-depth 4 --output json --save results.json "..."
    echo "long problem description..." | python explore.py
"""
from __future__ import annotations
import sys
import json
import argparse
import contextlib
import io

from anamorphic import Explorer


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Explore a problem space and generate implementation plans.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "query",
        nargs="?",
        help="Problem description. Omit to read from stdin.",
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=6,
        metavar="N",
        help="Maximum tree depth before forcing leaf nodes (default: 6).",
    )
    parser.add_argument(
        "--output",
        choices=["tree", "json"],
        default="tree",
        help="Output format (default: tree).",
    )
    parser.add_argument(
        "--save",
        metavar="FILE",
        help="Save output to FILE. JSON always saved alongside as <FILE>.json.",
    )
    parser.add_argument(
        "--no-plans",
        action="store_true",
        help="Omit implementation plans from tree display.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress progress output during exploration.",
    )
    parser.add_argument(
        "--model",
        metavar="MODEL_ID",
        help="Override the Claude model used (default: claude-sonnet-4-6).",
    )
    args = parser.parse_args()

    # --- read query ---
    if args.query:
        query = args.query.strip()
    elif not sys.stdin.isatty():
        query = sys.stdin.read().strip()
    else:
        print("Enter problem description (Ctrl+D when done):")
        query = sys.stdin.read().strip()

    if not query:
        parser.error("No query provided.")

    # --- run ---
    print(f"\nProblem: {query[:120]}{'...' if len(query) > 120 else ''}\n")
    separator = "─" * 60

    kwargs: dict = {"query": query, "max_depth": args.max_depth}
    if args.model:
        kwargs["model"] = args.model
    explorer = Explorer(**kwargs)

    if not args.quiet:
        print(separator)
    tree = explorer.run(verbose=not args.quiet)
    print(f"\n{separator}")

    # --- stats ---
    s = tree.stats()
    print(
        f"Nodes: {s['total_nodes']} total  "
        f"({s['leaf_nodes']} leaves, {s['internal_nodes']} internal)  "
        f"depth: {s['max_depth']}"
    )
    print(separator + "\n")

    # --- output ---
    if args.output == "json":
        text = tree.to_json()
        print(text)
        if args.save:
            with open(args.save, "w") as f:
                f.write(text)
            print(f"\nSaved to {args.save}")
    else:
        tree.display(show_plans=not args.no_plans)
        if args.save:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                tree.display(show_plans=not args.no_plans)
            with open(args.save, "w") as f:
                f.write(buf.getvalue())
            json_path = _with_suffix(args.save, ".json")
            with open(json_path, "w") as f:
                json.dump(tree.to_dict(), f, indent=2)
            print(f"\nSaved tree → {args.save}")
            print(f"Saved JSON → {json_path}")


def _with_suffix(path: str, suffix: str) -> str:
    if "." in path.rsplit("/", 1)[-1]:
        base = path.rsplit(".", 1)[0]
    else:
        base = path
    return base + suffix


if __name__ == "__main__":
    main()
