from __future__ import annotations
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

from .tree import ProblemTree
from .llm import LLMClient
from .scheduler import epochs


class Builder:
    """
    Executes leaf nodes from a ProblemTree in dependency order.

    Leaves are grouped into epochs (topological levels). Within each epoch
    all tasks are independent and run in parallel via a thread pool. Epochs
    execute sequentially so every dependency is satisfied before a task starts.

    Each task calls the LLM to generate a Python implementation from the
    leaf's problem description and plan, then writes it to output_dir.
    """

    def __init__(
        self,
        tree: ProblemTree,
        output_dir: str = "output",
        max_workers: int = 4,
        model: str | None = None,
    ):
        self.tree = tree
        self.output_dir = output_dir
        self.max_workers = max_workers
        self.llm = LLMClient(**({"model": model} if model else {}))
        os.makedirs(output_dir, exist_ok=True)

    def run(self, verbose: bool = True) -> dict[str, str]:
        """
        Build all leaf nodes.
        Returns a mapping of {node_id: output_file_path}.
        """
        schedule = epochs(self.tree)
        total = sum(len(e) for e in schedule)
        results: dict[str, str] = {}

        if verbose:
            print(f"Building {total} task(s) across {len(schedule)} epoch(s)\n")

        for i, epoch in enumerate(schedule, 1):
            if verbose:
                print(f"── Epoch {i}/{len(schedule)}  ({len(epoch)} task(s))")
            epoch_results = self._run_epoch(epoch, verbose)
            results.update(epoch_results)
            if verbose:
                print()

        self._write_manifest(results)
        if verbose:
            manifest = os.path.join(self.output_dir, "manifest.json")
            print(f"Manifest → {manifest}")

        return results

    # ------------------------------------------------------------------

    def _run_epoch(self, node_ids: list[str], verbose: bool) -> dict[str, str]:
        results: dict[str, str] = {}
        workers = min(self.max_workers, len(node_ids))

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(self._build_node, nid): nid for nid in node_ids}
            for future in as_completed(futures):
                nid = futures[future]
                node = self.tree.nodes[nid]
                short = _truncate(node.problem, 60)
                try:
                    path = future.result()
                    results[nid] = path
                    if verbose:
                        print(f"   ✓ [{nid}] {short}")
                        print(f"         → {path}")
                except Exception as exc:
                    if verbose:
                        print(f"   ✗ [{nid}] {short}")
                        print(f"         ! {exc}", file=sys.stderr)

        return results

    def _build_node(self, node_id: str) -> str:
        node = self.tree.nodes[node_id]
        code = self.llm.implement(node.problem, schema=node.schema)
        filename = _slug(node.problem) + ".py"
        path = os.path.join(self.output_dir, filename)
        if os.path.exists(path):
            path = os.path.join(self.output_dir, f"node{node_id}_{filename}")
        with open(path, "w") as f:
            f.write(code)
        return path

    def _write_manifest(self, results: dict[str, str]) -> None:
        manifest = {
            nid: {
                "problem": self.tree.nodes[nid].problem,
                "dependencies": self.tree.nodes[nid].dependencies,
                "output": path,
            }
            for nid, path in results.items()
        }
        path = os.path.join(self.output_dir, "manifest.json")
        with open(path, "w") as f:
            json.dump(manifest, f, indent=2)


def _slug(text: str, max_len: int = 48) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()[:max_len])
    return slug.strip("_") or "module"


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 3] + "..."
