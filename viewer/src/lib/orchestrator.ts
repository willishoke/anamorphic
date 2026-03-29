/**
 * Orchestrator: all app logic extracted from App.tsx with no Ink dependency.
 * Emits 'state' events with WebState whenever anything changes.
 */
import { EventEmitter } from 'events';
import { LLMClient } from './llm.js';
import {
  AppScreen, TreeData, NodeData, LeafSchema, RootAnalysis,
  BuildProgress, EpochInfo, NodeBuildStatus, TraversalInfo, WebState,
} from './types.js';
import { buildTree } from './builder.js';
import { epochs } from './scheduler.js';

// --------------------------------------------------------------------------

let _counter = 1;
function nextId(): string { return String(_counter++); }

function makeNode(id: string, problem: string, parentId: string | null, depth: number): NodeData {
  return { id, problem, parent_id: parentId, children: [], is_leaf: false, depth, plan: null, dependencies: [], schema: null };
}

// --------------------------------------------------------------------------

interface TraversalState {
  nodeId: string;
  problem: string;
  isLeaf: boolean;
  queueLength: number;
  totalSeen: number;
  pendingSchema?: LeafSchema;
  pendingSubproblems?: string[];
}

export class Orchestrator extends EventEmitter {
  private llm = new LLMClient();

  private screen: AppScreen = { tag: 'input' };
  private loading = false;
  private error: string | undefined;

  private rootRef: { problem: string; analysis: RootAnalysis } | null = null;
  private treeRef: TreeData | null = null;
  private queue: string[] = [];
  private seen = 0;
  private traversal: TraversalState | null = null;
  private buildProgress: BuildProgress | null = null;

  // ---- state snapshot -------------------------------------------------------

  getState(): WebState {
    const base: WebState = {
      screen: this.screen.tag,
      loading: this.loading,
      error: this.error,
      tree: this.treeRef,
      traversalNodeId: this.traversal?.nodeId ?? null,
      buildProgress: this.buildProgress,
    };

    if (this.screen.tag === 'root_review') {
      const s = this.screen as Extract<AppScreen, { tag: 'root_review' }>;
      return { ...base, rootProblem: s.problem, rootAnalysis: s.analysis };
    }

    if (this.screen.tag === 'traversing' && this.traversal) {
      const t = this.traversal;
      return {
        ...base,
        traversal: {
          nodeId: t.nodeId,
          problem: t.problem,
          isLeaf: t.isLeaf,
          queueLength: t.queueLength,
          totalSeen: t.totalSeen,
          pendingSchema: t.pendingSchema,
          pendingSubproblems: t.pendingSubproblems,
        } satisfies TraversalInfo,
      };
    }

    return base;
  }

  private push(): void {
    this.emit('state', this.getState());
  }

  // ---- actions --------------------------------------------------------------

  async submitQuery(query: string): Promise<void> {
    this.error = undefined;
    this.loading = true;
    const rootId = '0';
    _counter = 1;
    const rootNode = makeNode(rootId, query, null, 0);
    this.treeRef = { root_id: rootId, nodes: { [rootId]: rootNode } };
    this.push();
    try {
      const analysis = await this.llm.analyzeRoot(query);
      this.rootRef = { problem: query, analysis };
      this.loading = false;
      this.screen = { tag: 'root_review', problem: query, analysis };
      this.push();
    } catch (e) {
      this.loading = false;
      this.error = e instanceof Error ? e.message : String(e);
      this.push();
    }
  }

  async approveRoot(): Promise<void> {
    const rootId = '0';
    _counter = 1;
    if (!this.treeRef) {
      const problem = this.rootRef?.problem ?? '';
      this.treeRef = { root_id: rootId, nodes: { [rootId]: makeNode(rootId, problem, null, 0) } };
    }
    this.queue = [this.treeRef.root_id];
    this.seen = 0;
    await this.advanceTraversal();
  }

  async refineRoot(feedback: string): Promise<void> {
    if (this.screen.tag !== 'root_review') return;
    const s = this.screen as Extract<AppScreen, { tag: 'root_review' }>;
    this.loading = true;
    this.push();
    try {
      const analysis = await this.llm.analyzeRoot(`${s.problem}\n\nUser refinement: ${feedback}`);
      this.rootRef = { problem: s.problem, analysis };
      this.loading = false;
      this.screen = { tag: 'root_review', problem: s.problem, analysis };
      this.push();
    } catch (e) {
      this.loading = false;
      this.error = e instanceof Error ? e.message : String(e);
      this.push();
    }
  }

  async approveNode(): Promise<void> {
    if (!this.traversal) return;
    const tree = this.treeRef!;
    const { nodeId, isLeaf, pendingSchema, pendingSubproblems } = this.traversal;
    const node = tree.nodes[nodeId]!;

    if (isLeaf) {
      node.is_leaf = true;
      node.schema = pendingSchema ?? null;
    } else {
      const subs = pendingSubproblems ?? [];

      let deps: Record<string, number[]> = {};
      if (subs.length > 1) {
        try { deps = await this.llm.identifyDeps(subs); } catch { /* skip */ }
      }

      const childIds: string[] = [];
      for (const sp of subs) {
        const childId = nextId();
        const child = makeNode(childId, sp, nodeId, node.depth + 1);
        child.dependencies = [...node.dependencies];
        tree.nodes[childId] = child;
        node.children.push(childId);
        childIds.push(childId);
        this.queue.push(childId);
      }

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

    this.treeRef = { ...tree };
    await this.advanceTraversal();
  }

  async refineNode(feedback: string): Promise<void> {
    if (!this.traversal) return;
    const { nodeId, isLeaf, pendingSchema, pendingSubproblems, problem } = this.traversal;
    this.loading = true;
    this.push();
    try {
      if (isLeaf) {
        const schema = await this.llm.refinePlan(problem, pendingSchema!, feedback);
        this.loading = false;
        this.traversal = { ...this.traversal, pendingSchema: schema };
      } else {
        const subs = await this.llm.refineDecompose(problem, pendingSubproblems!, feedback);
        this.loading = false;
        this.traversal = { ...this.traversal, pendingSubproblems: subs };
      }
      this.push();
    } catch (e) {
      this.loading = false;
      this.error = e instanceof Error ? e.message : String(e);
      this.push();
    }
  }

  startBuild(git: boolean): void {
    const tree = this.treeRef;
    if (!tree) return;

    const schedule = epochs(tree.nodes);
    const initialEpochs: EpochInfo[] = schedule.map((nodeIds) => ({
      nodes: nodeIds.map((id): NodeBuildStatus => ({
        nodeId: id,
        problem: tree.nodes[id]?.problem ?? id,
        status: 'waiting',
      })),
    }));

    const outputDir = 'output';
    this.buildProgress = { epochs: initialEpochs, activeEpoch: -1, done: false, gitEnabled: git, outputDir };
    this.screen = { tag: 'building' };
    this.push();

    const patchNode = (nodeId: string, patch: Partial<NodeBuildStatus>) => {
      if (!this.buildProgress) return;
      this.buildProgress = {
        ...this.buildProgress,
        epochs: this.buildProgress.epochs.map((e) => ({
          ...e,
          nodes: e.nodes.map((n) => n.nodeId === nodeId ? { ...n, ...patch } : n),
        })),
      };
      this.push();
    };

    buildTree(tree.nodes, this.llm, {
      outputDir,
      git,
      onGitError: (err) => {
        if (this.buildProgress) {
          this.buildProgress = { ...this.buildProgress, fatalError: `git init failed: ${err}`, gitEnabled: false };
          this.push();
        }
      },
      onEpochStart: (epochIdx) => {
        if (this.buildProgress) {
          this.buildProgress = { ...this.buildProgress, activeEpoch: epochIdx - 1 };
          this.push();
        }
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
    }).then(() => {
      if (this.buildProgress) {
        this.buildProgress = { ...this.buildProgress, done: true };
        this.push();
      }
    }).catch((e) => {
      if (this.buildProgress) {
        this.buildProgress = { ...this.buildProgress, done: true, fatalError: e instanceof Error ? e.message : String(e) };
        this.push();
      }
    });
  }

  back(): void {
    switch (this.screen.tag) {
      case 'root_review':
        this.treeRef = null;
        this.queue = [];
        this.seen = 0;
        this.traversal = null;
        this.error = undefined;
        this.screen = { tag: 'input' };
        break;
      case 'traversing':
        if (!this.rootRef) return;
        this.treeRef = null;
        this.queue = [];
        this.seen = 0;
        this.traversal = null;
        this.screen = { tag: 'root_review', problem: this.rootRef.problem, analysis: this.rootRef.analysis };
        break;
      case 'explore':
        if (!this.rootRef) return;
        this.screen = { tag: 'root_review', problem: this.rootRef.problem, analysis: this.rootRef.analysis };
        break;
      case 'building': {
        const tree = this.treeRef;
        if (tree) this.screen = { tag: 'explore', tree: { ...tree } };
        break;
      }
    }
    this.push();
  }

  // ---- internal -------------------------------------------------------------

  private async advanceTraversal(): Promise<void> {
    const tree = this.treeRef!;

    if (this.queue.length === 0) {
      this.traversal = null;
      this.screen = { tag: 'explore', tree: { ...tree } };
      this.push();
      return;
    }

    const nodeId = this.queue.shift()!;
    const node = tree.nodes[nodeId]!;
    this.seen += 1;
    this.loading = true;
    this.screen = { tag: 'traversing', tree: { ...tree }, currentId: nodeId, nodeMarkdown: '' };
    this.push();

    try {
      const isLeaf = await this.llm.assess(node.problem);

      if (isLeaf) {
        const schema = await this.llm.structuredPlan(node.problem);
        this.loading = false;
        this.traversal = {
          nodeId,
          problem: node.problem,
          isLeaf: true,
          queueLength: this.queue.length,
          totalSeen: this.seen,
          pendingSchema: schema,
        };
      } else {
        const parentProblem = node.parent_id ? tree.nodes[node.parent_id]?.problem ?? '' : '';
        const subproblems = await this.llm.decompose(node.problem, parentProblem);
        this.loading = false;
        this.traversal = {
          nodeId,
          problem: node.problem,
          isLeaf: false,
          queueLength: this.queue.length,
          totalSeen: this.seen,
          pendingSubproblems: subproblems,
        };
      }

      this.push();
    } catch (e) {
      this.loading = false;
      this.error = e instanceof Error ? e.message : String(e);
      this.push();
    }
  }
}
