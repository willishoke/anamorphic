from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import json


@dataclass
class Node:
    id: str
    problem: str
    parent_id: Optional[str] = None
    children: list[str] = field(default_factory=list)
    is_leaf: bool = False
    depth: int = 0
    plan: Optional[str] = None


class ProblemTree:
    def __init__(self, root_problem: str):
        self.nodes: dict[str, Node] = {}
        self._counter = 0
        root = Node(id=self._next_id(), problem=root_problem)
        self.nodes[root.id] = root
        self.root_id = root.id

    def _next_id(self) -> str:
        id_ = str(self._counter)
        self._counter += 1
        return id_

    def add_child(self, parent_id: str, problem: str) -> Node:
        parent = self.nodes[parent_id]
        node = Node(
            id=self._next_id(),
            problem=problem,
            parent_id=parent_id,
            depth=parent.depth + 1,
        )
        self.nodes[node.id] = node
        parent.children.append(node.id)
        return node

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "root_id": self.root_id,
            "nodes": {
                k: {
                    "id": v.id,
                    "problem": v.problem,
                    "parent_id": v.parent_id,
                    "children": v.children,
                    "is_leaf": v.is_leaf,
                    "depth": v.depth,
                    "plan": v.plan,
                }
                for k, v in self.nodes.items()
            },
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    # ------------------------------------------------------------------
    # Display
    # ------------------------------------------------------------------

    def display(self, show_plans: bool = True) -> None:
        root = self.nodes[self.root_id]
        tag = " [LEAF]" if root.is_leaf else ""
        print(f"[ROOT]{tag} {_truncate(root.problem, 90)}")
        if show_plans and root.plan:
            _print_plan(root.plan, prefix="")
        for i, child_id in enumerate(root.children):
            self._print_node(child_id, "", i == len(root.children) - 1, show_plans)

    def _print_node(self, node_id: str, prefix: str, is_last: bool, show_plans: bool) -> None:
        node = self.nodes[node_id]
        connector = "└── " if is_last else "├── "
        tag = " [LEAF]" if node.is_leaf else ""
        print(f"{prefix}{connector}{_truncate(node.problem, 90)}{tag}")
        child_prefix = prefix + ("    " if is_last else "│   ")
        if show_plans and node.plan:
            _print_plan(node.plan, prefix=child_prefix)
        for i, child_id in enumerate(node.children):
            self._print_node(child_id, child_prefix, i == len(node.children) - 1, show_plans)

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    def stats(self) -> dict:
        leaves = [n for n in self.nodes.values() if n.is_leaf]
        max_depth = max(n.depth for n in self.nodes.values()) if self.nodes else 0
        return {
            "total_nodes": len(self.nodes),
            "leaf_nodes": len(leaves),
            "internal_nodes": len(self.nodes) - len(leaves),
            "max_depth": max_depth,
        }


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 3] + "..."


def _print_plan(plan: str, prefix: str) -> None:
    lines = plan.splitlines()
    for line in lines[:12]:  # show first 12 lines of plan
        print(f"{prefix}    │ {line}")
    if len(lines) > 12:
        print(f"{prefix}    │ ... ({len(lines) - 12} more lines)")
