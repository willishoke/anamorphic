# anamorphic

Anamorphic is a tool for autonomous code generation through recursive problem decomposition. You give it a software problem in plain English — "build a URL shortener," "implement a rate limiter," "write a CSV processing pipeline" — and it uses Claude to break the problem down into a dependency tree of implementable subproblems, plans each one with a structured schema (functions, data structures, implementation steps, edge cases), and then generates working code for every leaf node in parallel.

The target user is a developer who wants to go from a rough problem statement to a working skeleton faster than they could scaffold it by hand, and who wants that skeleton to reflect a deliberate architectural decomposition rather than a flat dump of code. Anamorphic is not trying to replace a developer — the generated code is a starting point that expects a human to review, test, and iterate on. What it replaces is the tedious work of translating a mental model of a system into file structure, function signatures, and wiring. The interactive TUI lets you approve or push back on every decomposition and plan decision before any code is written, so you stay in control of the architecture.

## getting started

```bash
cd viewer
npm install
npm start
```

Requires either:
- `ANTHROPIC_API_KEY` set in your environment (uses the Anthropic SDK directly), or
- [Claude Code](https://claude.ai/code) installed and authenticated (`claude` on your PATH)

Once running, open **http://localhost:7777** in a browser for the web UI.

## how it works

**Traversal phase** — the TUI walks a BFS queue of nodes. At each node Claude decides whether the problem is small enough to implement directly (the threshold is ~120 lines, single responsibility) or whether it should be decomposed further into 2–5 subproblems. You approve or refine every decision before it is committed.

**Explore phase** — once the full tree is built you can navigate it, inspect node schemas, and save the tree as JSON before proceeding to build.

**Build phase** — a topological scheduler groups leaf nodes into epochs (batches whose dependencies are already satisfied) and executes each epoch in parallel. Two modes:

- **Build** — generates Python modules and writes them to `output/`
- **Build with git** — initializes a local git repo in `output/`, creates a worktree per node, scaffolds a stub commit, then streams the implementation with periodic WIP commits (`wip: N lines` every ~8 seconds) before a final `feat:` commit closes the branch

## web UI

A companion dashboard is served at **http://localhost:7777** for the duration of the session. It connects over Server-Sent Events and updates in real time alongside the TUI.

- **Tree sidebar** — full node hierarchy, color-coded by type and build status, clickable to inspect any node
- **Node detail** — schema, function signatures, implementation steps, edge cases, estimated line count
- **Build view** — live epoch timeline with per-node status, git step (branching / scaffolding / generating / done), branch name, and commit count

The web UI also ships with an embedded demo state so it can be deployed as a static page without a running CLI session.

## architecture

The system is a React/Ink terminal application backed by Node.js. LLM calls go through the Anthropic SDK (when `ANTHROPIC_API_KEY` is set) or fall back to `claude -p --dangerously-skip-permissions` as a subprocess — meaning Claude Code itself is the inference engine for all decomposition, planning, and code generation. The build phase spawns a fleet of Claude Code subprocesses in parallel, one per leaf node, each running in an isolated git worktree.

The web server (`src/lib/webserver.ts`) is a zero-dependency Node `http` server that serves `src/web/index.html` and pushes state via SSE on every React render cycle.

## current state

**Solid:** full decomposition loop with approval and refinement; structured schema generation; topological epoch scheduling; parallel code generation with and without git; all five TUI screens; real-time web UI.

**Rougher:** generated code targets Python only; the 120-line cap is a prompt instruction rather than a hard constraint so complex nodes can overrun it; sibling dependency identification is LLM-driven and can miss or hallucinate edges; no retry or recovery path if a node fails during build; cycle detection is silent (cycles get bundled into a final epoch rather than surfaced); the tree lives only in memory, so there is no way to resume an interrupted session without the explicit JSON export from the explore screen.
