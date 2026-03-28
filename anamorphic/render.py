"""
Markdown rendering for ProblemTree nodes.

- Leaf nodes   → rich markdown from their structured LeafPlan schema
- Internal nodes → markdown with problem statement + subproblem list
- tree_to_markdown → full document, BFS order, sections separated by ---
"""
from __future__ import annotations
from collections import deque

from .tree import ProblemTree, Node
from .schema import LeafPlan


def node_to_markdown(node: Node, tree: ProblemTree) -> str:
    if node.is_leaf:
        return _leaf_to_markdown(node, tree)
    return _internal_to_markdown(node, tree)


def tree_to_markdown(tree: ProblemTree) -> str:
    """Render the entire tree as a single markdown document (BFS order)."""
    sections: list[str] = []
    queue: deque[str] = deque([tree.root_id])
    while queue:
        nid = queue.popleft()
        node = tree.nodes[nid]
        sections.append(node_to_markdown(node, tree))
        for child_id in node.children:
            queue.append(child_id)
    return "\n\n---\n\n".join(sections)


# ---------------------------------------------------------------------------
# Internal nodes
# ---------------------------------------------------------------------------

def _internal_to_markdown(node: Node, tree: ProblemTree) -> str:
    lines: list[str] = []

    lines += [f"# {node.problem}", ""]
    lines += _meta_lines(node, tree)

    if node.children:
        lines += ["## Subproblems", ""]
        for i, child_id in enumerate(node.children, 1):
            child = tree.nodes[child_id]
            tag = " *(leaf)*" if child.is_leaf else ""
            lines.append(f"{i}. **[{child_id}]** {child.problem}{tag}")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Leaf nodes
# ---------------------------------------------------------------------------

def _leaf_to_markdown(node: Node, tree: ProblemTree) -> str:
    lines: list[str] = []

    lines += [f"# {node.problem}", ""]
    lines += _meta_lines(node, tree)

    if node.schema:
        try:
            plan = LeafPlan.from_dict(node.schema)
            lines += _plan_lines(plan)
            return "\n".join(lines)
        except Exception:
            pass

    # fallback: free-text plan
    if node.plan:
        lines += ["## Plan", "", node.plan, ""]

    return "\n".join(lines)


def _meta_lines(node: Node, tree: ProblemTree) -> list[str]:
    lines: list[str] = []
    lines.append(f"**Node:** `{node.id}`  ")
    lines.append(f"**Depth:** {node.depth}  ")
    if node.dependencies:
        lines.append("**Depends on:**  ")
        for dep_id in node.dependencies:
            if dep_id in tree.nodes:
                dep = tree.nodes[dep_id]
                short = dep.problem[:60] + ("..." if len(dep.problem) > 60 else "")
                lines.append(f"- `{dep_id}` — {short}")
            else:
                lines.append(f"- `{dep_id}`")
    lines.append("")
    return lines


def _plan_lines(plan: LeafPlan) -> list[str]:
    lines: list[str] = []

    lines += ["## Summary", "", plan.summary, ""]
    lines.append(f"*Estimated: ~{plan.estimated_lines} lines*")
    lines.append("")

    if plan.data_structures:
        lines += ["## Data Structures", ""]
        for ds in plan.data_structures:
            lines.append(f"### `{ds.name}`")
            lines.append("")
            if ds.fields:
                lines += ["| Field | Type | Description |", "|-------|------|-------------|"]
                for f in ds.fields:
                    lines.append(f"| `{f.name}` | `{f.type}` | {f.description} |")
            lines.append("")

    if plan.functions:
        lines += ["## Functions", ""]
        for fn in plan.functions:
            lines.append(f"### `{fn.signature}`")
            lines.append("")
            lines.append(fn.purpose)
            lines.append("")

    if plan.steps:
        lines += ["## Implementation Steps", ""]
        for i, step in enumerate(plan.steps, 1):
            lines.append(f"{i}. {step}")
        lines.append("")

    if plan.edge_cases:
        lines += ["## Edge Cases", ""]
        for ec in plan.edge_cases:
            lines.append(f"- {ec}")
        lines.append("")

    return lines
