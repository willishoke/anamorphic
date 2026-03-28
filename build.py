#!/usr/bin/env python3
"""
Phase 2: Build implementations from an explored problem tree.

Takes the JSON output from explore.py, resolves dependencies between leaf nodes,
sorts them into parallel epochs via topological sort, and generates Python
implementations for each leaf — running each epoch's tasks in parallel.

Usage:
    python3 build.py results.json
    python3 build.py results.json --output-dir ./implementation --workers 6
    python3 build.py results.json --dry-run
"""
from __future__ import annotations
import argparse
import json
import sys

from anamorphic.tree import ProblemTree
from anamorphic.scheduler import epochs, build_leaf_dep_graph
from anamorphic.builder import Builder


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build implementations from a problem tree (phase 2).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("tree_json", help="Path to JSON file produced by explore.py")
    parser.add_argument(
        "--output-dir", default="output", metavar="DIR",
        help="Directory to write generated files (default: output/)",
    )
    parser.add_argument(
        "--workers", type=int, default=4, metavar="N",
        help="Max parallel tasks per epoch (default: 4)",
    )
    parser.add_argument(
        "--model", metavar="MODEL_ID",
        help="Override the Claude model used for implementation",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print the epoch schedule without generating any code",
    )
    parser.add_argument(
        "--quiet", action="store_true",
        help="Suppress progress output",
    )
    args = parser.parse_args()

    # load tree
    try:
        with open(args.tree_json) as f:
            tree = ProblemTree.from_dict(json.load(f))
    except FileNotFoundError:
        print(f"Error: file not found: {args.tree_json}", file=sys.stderr)
        sys.exit(1)
    except (KeyError, ValueError) as e:
        print(f"Error: could not parse tree JSON: {e}", file=sys.stderr)
        sys.exit(1)

    s = tree.stats()
    print(f"Loaded tree: {s['total_nodes']} nodes, {s['leaf_nodes']} leaves\n")

    # compute + display schedule
    schedule = epochs(tree)
    _print_schedule(tree, schedule)

    if args.dry_run:
        return

    print()
    kwargs: dict = {"tree": tree, "output_dir": args.output_dir, "max_workers": args.workers}
    if args.model:
        kwargs["model"] = args.model
    builder = Builder(**kwargs)
    builder.run(verbose=not args.quiet)


def _print_schedule(tree: ProblemTree, schedule: list[list[str]]) -> None:
    dep_graph = build_leaf_dep_graph(tree)
    print(f"Execution schedule — {len(schedule)} epoch(s):\n")
    for i, epoch in enumerate(schedule, 1):
        print(f"  Epoch {i}  ({len(epoch)} task(s) in parallel)")
        for nid in epoch:
            node = tree.nodes[nid]
            deps = dep_graph.get(nid, set())
            dep_str = f"  ← [{', '.join(sorted(deps))}]" if deps else ""
            problem = node.problem if len(node.problem) <= 70 else node.problem[:67] + "..."
            print(f"    [{nid}] {problem}{dep_str}")
    print()


if __name__ == "__main__":
    main()
