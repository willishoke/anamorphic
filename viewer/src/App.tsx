/**
 * Root component. Owns all app state and drives the flow:
 *
 *   input → root_review → traversing (BFS, one node at a time) → explore
 *
 * LLM calls are made via the Python bridge. The bridge runs as a child
 * process; all calls are async and update React state on completion.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from 'ink';
import { Bridge } from './lib/bridge.js';
import { AppScreen, TreeData, NodeData } from './lib/types.js';
import { rootAnalysisToLines, schemaToLines, decompositionToLines, Line } from './lib/schemaToLines.js';
import type { RootAnalysis } from './lib/types.js';
import InputScreen from './screens/InputScreen.js';
import ReviewScreen from './screens/ReviewScreen.js';
import TraversalScreen from './screens/TraversalScreen.js';
import ExploreScreen from './screens/ExploreScreen.js';

// --------------------------------------------------------------------------
// Tree builder helpers (mirror of Python tree.py, minimal)
// --------------------------------------------------------------------------

let _counter = 1;
function nextId(): string { return String(_counter++); }

function makeNode(id: string, problem: string, parentId: string | null, depth: number): NodeData {
  return { id, problem, parent_id: parentId, children: [], is_leaf: false, depth, plan: null, dependencies: [], schema: null };
}

// --------------------------------------------------------------------------

export default function App() {
  const { exit } = useApp();
  const bridge = useRef<Bridge | null>(null);

  // initialise bridge once
  if (!bridge.current) bridge.current = new Bridge();

  const [screen, setScreen] = useState<AppScreen>({ tag: 'input' });
  const [loading, setLoading] = useState(false);

  // traversal state
  const treeRef = useRef<TreeData | null>(null);
  const queueRef = useRef<string[]>([]);
  const seenRef = useRef(0);
  const [traversalState, setTraversalState] = useState<{
    nodeId: string;
    problem: string;
    isLeaf: boolean;
    lines: Line[];
    queueLength: number;
    totalSeen: number;
    // stash pending data for approval
    pendingSchema?: Record<string, unknown>;
    pendingSubproblems?: string[];
  } | null>(null);

  // ---- submit query -------------------------------------------------------

  const handleQuery = useCallback(async (query: string) => {
    setLoading(true);
    const rootId = '0';
    _counter = 1;
    const rootNode = makeNode(rootId, query, null, 0);
    treeRef.current = { root_id: rootId, nodes: { [rootId]: rootNode } };

    const analysis = await bridge.current!.analyzeRoot(query);
    setLoading(false);
    setScreen({ tag: 'root_review', problem: query, analysis });
  }, []);

  // ---- root review: approve / refine --------------------------------------

  const handleRootApprove = useCallback(() => {
    // kick off traversal from root
    queueRef.current = [treeRef.current!.root_id];
    seenRef.current = 0;
    advanceTraversal();
  }, []);

  const handleRootRefine = useCallback(async (feedback: string) => {
    setLoading(true);
    const s = screen as Extract<AppScreen, { tag: 'root_review' }>;
    const analysis = await bridge.current!.analyzeRoot(`${s.problem}\n\nUser refinement: ${feedback}`);
    setLoading(false);
    setScreen({ tag: 'root_review', problem: s.problem, analysis });
  }, [screen]);

  // ---- traversal: advance to next node ------------------------------------

  const advanceTraversal = useCallback(async () => {
    const queue = queueRef.current;
    const tree = treeRef.current!;

    if (queue.length === 0) {
      // done — move to explore
      setScreen({ tag: 'explore', tree: { ...tree } });
      return;
    }

    const nodeId = queue.shift()!;
    const node = tree.nodes[nodeId]!;
    seenRef.current += 1;
    setLoading(true);

    const isLeaf = await bridge.current!.assess(node.problem);

    if (isLeaf) {
      const schema = await bridge.current!.structuredPlan(node.problem);
      setLoading(false);
      const lines = schemaToLines(node.problem, schema as any);
      setTraversalState({
        nodeId,
        problem: node.problem,
        isLeaf: true,
        lines,
        queueLength: queue.length,
        totalSeen: seenRef.current,
        pendingSchema: schema,
      });
    } else {
      const parentProblem = node.parent_id ? tree.nodes[node.parent_id]?.problem ?? '' : '';
      const subproblems = await bridge.current!.decompose(node.problem, parentProblem);
      setLoading(false);
      const lines = decompositionToLines(node.problem, subproblems);
      setTraversalState({
        nodeId,
        problem: node.problem,
        isLeaf: false,
        lines,
        queueLength: queue.length,
        totalSeen: seenRef.current,
        pendingSubproblems: subproblems,
      });
    }

    setScreen({ tag: 'traversing', tree: { ...tree }, currentId: nodeId, nodeMarkdown: '' });
  }, []);

  // ---- traversal: approve current node ------------------------------------

  const handleNodeApprove = useCallback(async () => {
    if (!traversalState) return;
    const tree = treeRef.current!;
    const { nodeId, isLeaf, pendingSchema, pendingSubproblems } = traversalState;
    const node = tree.nodes[nodeId]!;

    if (isLeaf) {
      node.is_leaf = true;
      node.schema = pendingSchema ?? null;
    } else {
      // create child nodes and enqueue
      const subs = pendingSubproblems ?? [];

      // identify sibling deps
      let deps: Record<string, number[]> = {};
      if (subs.length > 1) {
        try { deps = await bridge.current!.identifyDeps(subs); } catch { /* skip on error */ }
      }

      const childIds: string[] = [];
      for (const sp of subs) {
        const childId = nextId();
        const child = makeNode(childId, sp, nodeId, node.depth + 1);
        // inherit parent deps + sibling deps (resolved after all siblings created)
        child.dependencies = [...node.dependencies];
        tree.nodes[childId] = child;
        node.children.push(childId);
        childIds.push(childId);
        queueRef.current.push(childId);
      }

      // apply sibling deps
      for (const [idxStr, depIdxs] of Object.entries(deps)) {
        const idx = parseInt(idxStr);
        const childId = childIds[idx];
        if (!childId) continue;
        const child = tree.nodes[childId]!;
        for (const depIdx of depIdxs) {
          const depId = childIds[depIdx];
          if (depId && !child.dependencies.includes(depId)) {
            child.dependencies.push(depId);
          }
        }
      }
    }

    treeRef.current = { ...tree };
    advanceTraversal();
  }, [traversalState, advanceTraversal]);

  // ---- traversal: refine current node -------------------------------------

  const handleNodeRefine = useCallback(async (feedback: string) => {
    if (!traversalState) return;
    const { nodeId, isLeaf, pendingSchema, pendingSubproblems, problem } = traversalState;
    setLoading(true);

    if (isLeaf) {
      const schema = await bridge.current!.refinePlan(problem, pendingSchema!, feedback);
      setLoading(false);
      setTraversalState((prev) => ({
        ...prev!,
        pendingSchema: schema,
        lines: schemaToLines(problem, schema as any),
      }));
    } else {
      const subs = await bridge.current!.refineDecompose(problem, pendingSubproblems!, feedback);
      setLoading(false);
      setTraversalState((prev) => ({
        ...prev!,
        pendingSubproblems: subs,
        lines: decompositionToLines(problem, subs),
      }));
    }
  }, [traversalState]);

  // ---- render -------------------------------------------------------------

  if (screen.tag === 'input') {
    return <InputScreen onSubmit={handleQuery} />;
  }

  if (screen.tag === 'root_review') {
    const s = screen as Extract<AppScreen, { tag: 'root_review' }>;
    return (
      <ReviewScreen
        title="Root Problem Analysis"
        lines={loading ? [] : rootAnalysisToLines(s.problem, s.analysis)}
        loading={loading}
        onApprove={handleRootApprove}
        onRefine={handleRootRefine}
      />
    );
  }

  if (screen.tag === 'traversing' && traversalState) {
    return (
      <TraversalScreen
        nodeId={traversalState.nodeId}
        problem={traversalState.problem}
        isLeaf={traversalState.isLeaf}
        lines={traversalState.lines}
        loading={loading}
        queueLength={traversalState.queueLength}
        totalSeen={traversalState.totalSeen}
        onApprove={handleNodeApprove}
        onRefine={handleNodeRefine}
      />
    );
  }

  if (screen.tag === 'explore') {
    return (
      <ExploreScreen
        tree={(screen as any).tree}
        onQuit={() => {
          bridge.current?.destroy();
          exit();
        }}
      />
    );
  }

  return null;
}
