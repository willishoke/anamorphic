from __future__ import annotations
from collections import defaultdict, deque
from .tree import ProblemTree, Node


def leaf_descendants(tree: ProblemTree, node_id: str) -> set[str]:
    """All leaf IDs at or below node_id."""
    node = tree.nodes[node_id]
    if node.is_leaf:
        return {node_id}
    result: set[str] = set()
    for child_id in node.children:
        result |= leaf_descendants(tree, child_id)
    return result


def build_leaf_dep_graph(tree: ProblemTree) -> dict[str, set[str]]:
    """
    For each leaf node, compute the set of other leaf IDs it must wait for.
    A node's `dependencies` list may point to any node in the tree; each is
    resolved to its leaf descendants so the graph only contains leaf IDs.
    """
    all_leaves = {nid for nid, n in tree.nodes.items() if n.is_leaf}
    graph: dict[str, set[str]] = {lid: set() for lid in all_leaves}

    for lid in all_leaves:
        leaf = tree.nodes[lid]
        for dep_id in leaf.dependencies:
            if dep_id not in tree.nodes:
                continue
            dep_leaves = leaf_descendants(tree, dep_id) & all_leaves - {lid}
            graph[lid] |= dep_leaves

    return graph


def epochs(tree: ProblemTree) -> list[list[str]]:
    """
    Topological sort of leaf nodes into epochs.
    All leaves in the same epoch are independent and can run in parallel.
    Epochs must be executed in order.
    """
    graph = build_leaf_dep_graph(tree)  # lid -> set of lids it depends on

    # in-degree (number of unresolved dependencies)
    in_degree: dict[str, int] = {lid: len(deps) for lid, deps in graph.items()}

    # reverse map: lid -> set of lids that depend on it
    dependents: dict[str, set[str]] = defaultdict(set)
    for lid, deps in graph.items():
        for dep in deps:
            dependents[dep].add(lid)

    result: list[list[str]] = []
    ready: deque[str] = deque(lid for lid, deg in in_degree.items() if deg == 0)

    while ready:
        epoch = sorted(ready)   # sorted for determinism
        result.append(epoch)
        ready.clear()
        for lid in epoch:
            for dep_lid in dependents[lid]:
                in_degree[dep_lid] -= 1
                if in_degree[dep_lid] == 0:
                    ready.append(dep_lid)

    # safety: if a cycle exists, remaining nodes form a final epoch
    remaining = [lid for lid, deg in in_degree.items() if deg > 0]
    if remaining:
        result.append(sorted(remaining))

    return result
