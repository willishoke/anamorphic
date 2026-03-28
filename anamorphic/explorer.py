from __future__ import annotations
from collections import deque

from .tree import ProblemTree
from .llm import LLMClient
from .spinner import spin


class Explorer:
    """
    BFS problem-space explorer.

    Starting from the root query, each node is assessed:
    - If implementable in ≤500 LOC → leaf node, generate implementation plan.
    - Otherwise → decompose into 2–5 subproblems and enqueue children.

    Args:
        query:     The root problem description.
        max_depth: Hard cap on tree depth to prevent unbounded expansion.
        model:     Claude model to use for all LLM operations.
    """

    def __init__(self, query: str, max_depth: int = 6, model: str | None = None):
        self.tree = ProblemTree(query)
        self.llm = LLMClient(**({"model": model} if model else {}))
        self.max_depth = max_depth

    def run(self, verbose: bool = True) -> ProblemTree:
        queue: deque[str] = deque([self.tree.root_id])

        while queue:
            node_id = queue.popleft()
            node = self.tree.nodes[node_id]
            indent = "  " * node.depth

            label = f"[{node_id}] {_short(node.problem)}"
            if verbose:
                print(f"{indent}{label}")

            # --- assess ---
            with spin(f"{indent}    assessing..."):
                is_leaf = self._should_be_leaf(node)
            if is_leaf:
                node.is_leaf = True
                with spin(f"{indent}    generating plan..."):
                    node.plan = self.llm.plan(node.problem)
                if verbose:
                    print(f"{indent}    → leaf  plan ready ({len(node.plan.splitlines())} lines)")
                continue

            # --- decompose ---
            parent_problem = (
                self.tree.nodes[node.parent_id].problem if node.parent_id else ""
            )
            try:
                with spin(f"{indent}    decomposing..."):
                    subproblems = self.llm.decompose(node.problem, parent_problem)
            except (ValueError, RuntimeError) as e:
                if verbose:
                    print(f"{indent}    ! decomposition failed ({e}), treating as leaf")
                node.is_leaf = True
                with spin(f"{indent}    generating plan..."):
                    node.plan = self.llm.plan(node.problem)
                continue

            for sp in subproblems:
                child = self.tree.add_child(node_id, sp)
                queue.append(child.id)

            if verbose:
                print(f"{indent}    → {len(subproblems)} subproblems")

        return self.tree

    # ------------------------------------------------------------------

    def _should_be_leaf(self, node) -> bool:
        if node.depth >= self.max_depth:
            return True
        return self.llm.assess(node.problem)


def _short(text: str, limit: int = 70) -> str:
    return text if len(text) <= limit else text[: limit - 3] + "..."
