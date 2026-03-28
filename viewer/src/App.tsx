/**
 * Root component. Owns all app state and drives the flow:
 *
 *   input → root_review → traversing (BFS, one node at a time) → explore → building
 *
 * LLM calls are made directly via LLMClient (claude CLI or Anthropic SDK).
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from 'ink';
import { LLMClient } from './lib/llm.js';
import { AppScreen, TreeData, NodeData, LeafSchema } from './lib/types.js';
import { rootAnalysisToLines, schemaToLines, decompositionToLines, Line } from './lib/schemaToLines.js';
import type { RootAnalysis } from './lib/types.js';
import InputScreen from './screens/InputScreen.js';
import ReviewScreen from './screens/ReviewScreen.js';
import TraversalScreen from './screens/TraversalScreen.js';
import ExploreScreen from './screens/ExploreScreen.js';
import BuildScreen, { BuildProgress, EpochInfo, NodeBuildStatus } from './screens/BuildScreen.js'; // eslint-disable-line @typescript-eslint/no-unused-vars
import { buildTree } from './lib/builder.js';
import { epochs } from './lib/scheduler.js';
import { createWebServer, pushState } from './lib/webserver.js';

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
  const llm = useRef<LLMClient | null>(null);
  if (!llm.current) llm.current = new LLMClient();

  const [screen, setScreen] = useState<AppScreen>({ tag: 'input' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // persisted root analysis — survives screen transitions so back works
  const rootRef = useRef<{ problem: string; analysis: RootAnalysis } | null>(null);

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
    pendingSchema?: LeafSchema;
    pendingSubproblems?: string[];
  } | null>(null);

  // build state
  const [buildProgress, setBuildProgress] = useState<BuildProgress | null>(null);

  // ---- web server ---------------------------------------------------------

  useEffect(() => {
    const server = createWebServer(7777);
    // eslint-disable-next-line no-console
    console.error('web ui → http://localhost:7777');
    return () => { server.close(); };
  }, []);

  // push state to web clients after every relevant change
  // traversalState changing implies treeRef may also have been updated
  useEffect(() => {
    pushState({
      screen: screen.tag,
      tree: treeRef.current,
      traversalNodeId: traversalState?.nodeId ?? null,
      buildProgress,
    });
  });

  // ---- submit query -------------------------------------------------------

  const handleQuery = useCallback(async (query: string) => {
    setError(undefined);
    setLoading(true);
    const rootId = '0';
    _counter = 1;
    const rootNode = makeNode(rootId, query, null, 0);
    treeRef.current = { root_id: rootId, nodes: { [rootId]: rootNode } };
    try {
      const analysis = await llm.current!.analyzeRoot(query);
      rootRef.current = { problem: query, analysis };
      setLoading(false);
      setScreen({ tag: 'root_review', problem: query, analysis });
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // ---- root review: approve / refine --------------------------------------

  const handleRootApprove = useCallback(() => {
    // re-initialize tree in case user backed out and is re-approving
    const rootId = '0';
    _counter = 1;
    if (!treeRef.current) {
      const problem = rootRef.current?.problem ?? '';
      treeRef.current = { root_id: rootId, nodes: { [rootId]: makeNode(rootId, problem, null, 0) } };
    }
    queueRef.current = [treeRef.current.root_id];
    seenRef.current = 0;
    advanceTraversal();
  }, []);

  const handleRootRefine = useCallback(async (feedback: string) => {
    setLoading(true);
    const s = screen as Extract<AppScreen, { tag: 'root_review' }>;
    const analysis = await llm.current!.analyzeRoot(`${s.problem}\n\nUser refinement: ${feedback}`);
    rootRef.current = { problem: s.problem, analysis };
    setLoading(false);
    setScreen({ tag: 'root_review', problem: s.problem, analysis });
  }, [screen]);

  // ---- back navigation ----------------------------------------------------

  const handleBackFromReview = useCallback(() => {
    setError(undefined);
    treeRef.current = null;
    queueRef.current = [];
    seenRef.current = 0;
    setTraversalState(null);
    setScreen({ tag: 'input' });
  }, []);

  const handleBackFromTraversal = useCallback(() => {
    if (!rootRef.current) return;
    const { problem, analysis } = rootRef.current;
    // reset traversal state so re-approving starts fresh
    treeRef.current = null;
    queueRef.current = [];
    seenRef.current = 0;
    setTraversalState(null);
    setScreen({ tag: 'root_review', problem, analysis });
  }, []);

  const handleBackFromExplore = useCallback(() => {
    if (!rootRef.current) return;
    const { problem, analysis } = rootRef.current;
    setScreen({ tag: 'root_review', problem, analysis });
  }, []);

  // ---- build --------------------------------------------------------------

  const handleBuild = useCallback(async (git: boolean) => {
    const tree = treeRef.current;
    if (!tree) return;

    // pre-compute epoch schedule so we can show all epochs upfront
    const schedule = epochs(tree.nodes);
    const initialEpochs: EpochInfo[] = schedule.map((nodeIds) => ({
      nodes: nodeIds.map((id) => ({
        nodeId: id,
        problem: tree.nodes[id]?.problem ?? id,
        status: 'waiting' as const,
      })),
    }));

    const outputDir = 'output';
    setBuildProgress({ epochs: initialEpochs, activeEpoch: -1, done: false, gitEnabled: git, outputDir });
    setScreen({ tag: 'building' });

    // helper to patch a single node across all epochs
    const patchNode = (nodeId: string, patch: Partial<NodeBuildStatus>) => {
      setBuildProgress((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          epochs: prev.epochs.map((e) => ({
            ...e,
            nodes: e.nodes.map((n) => n.nodeId === nodeId ? { ...n, ...patch } : n),
          })),
        };
      });
    };

    try {
      await buildTree(tree.nodes, llm.current!, {
        outputDir,
        git,
        onGitError: (err) => {
          setBuildProgress((prev) => prev ? { ...prev, fatalError: `git init failed: ${err}`, gitEnabled: false } : prev);
        },
        onEpochStart: (epochIdx) => {
          setBuildProgress((prev) => prev ? { ...prev, activeEpoch: epochIdx - 1 } : prev);
        },
        onNodeStart: (nodeId) => patchNode(nodeId, { status: 'running' }),
        onNodeGitStep: (nodeId, step) => patchNode(nodeId, { gitStep: step }),
        onNodeCommit: (nodeId, commitCount) => patchNode(nodeId, { commitCount }),
        onNodeDone: (result) => patchNode(result.nodeId, {
          status: result.error ? 'error' : 'done',
          outputPath: result.outputPath,
          error: result.error,
          branchName: result.branchName,
          commitCount: result.commitCount,
          gitStep: undefined,
        }),
      });
    } catch (e) {
      setBuildProgress((prev) =>
        prev ? { ...prev, done: true, fatalError: e instanceof Error ? e.message : String(e) } : prev,
      );
      return;
    }

    setBuildProgress((prev) => prev ? { ...prev, done: true } : prev);
  }, []);

  const handleBackFromBuild = useCallback(() => {
    const tree = treeRef.current;
    if (tree) setScreen({ tag: 'explore', tree: { ...tree } });
  }, []);

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

    const isLeaf = await llm.current!.assess(node.problem);

    if (isLeaf) {
      const schema = await llm.current!.structuredPlan(node.problem);
      setLoading(false);
      const lines = schemaToLines(node.problem, schema);
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
      const subproblems = await llm.current!.decompose(node.problem, parentProblem);
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
        try { deps = await llm.current!.identifyDeps(subs); } catch { /* skip on error */ }
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
      const schema = await llm.current!.refinePlan(problem, pendingSchema!, feedback);
      setLoading(false);
      setTraversalState((prev) => ({
        ...prev!,
        pendingSchema: schema,
        lines: schemaToLines(problem, schema),
      }));
    } else {
      const subs = await llm.current!.refineDecompose(problem, pendingSubproblems!, feedback);
      setLoading(false);
      setTraversalState((prev) => ({
        ...prev!,
        pendingSubproblems: subs,
        lines: decompositionToLines(problem, subs),
      }));
    }
  }, [traversalState]);

  // ---- render -------------------------------------------------------------

  const handleQuit = useCallback(() => {
    exit();
  }, [exit]);

  if (screen.tag === 'input') {
    return (
      <InputScreen
        onSubmit={handleQuery}
        onQuit={handleQuit}
        loading={loading}
        error={error}
      />
    );
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
        onBack={handleBackFromReview}
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
        onBack={handleBackFromTraversal}
      />
    );
  }

  if (screen.tag === 'explore') {
    return (
      <ExploreScreen
        tree={(screen as any).tree}
        onQuit={handleQuit}
        onBack={handleBackFromExplore}
        onBuild={(git) => handleBuild(git)}
      />
    );
  }

  if (screen.tag === 'building' && buildProgress) {
    return <BuildScreen progress={buildProgress} onBack={handleBackFromBuild} />;
  }

  return null;
}
