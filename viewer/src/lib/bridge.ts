/**
 * Async bridge to the Python subprocess (anamorphic/server.py).
 * Communicates via newline-delimited JSON on stdin/stdout.
 */
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

type Resolver = (value: Record<string, unknown>) => void;

export class Bridge {
  private proc: ChildProcess;
  private pending = new Map<string, Resolver>();
  private counter = 0;

  constructor() {
    this.proc = spawn('python3', ['-m', 'anamorphic.server'], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    const rl = createInterface({ input: this.proc.stdout! });
    rl.on('line', (line) => {
      try {
        const resp = JSON.parse(line) as Record<string, unknown>;
        const resolve = this.pending.get(resp['id'] as string);
        if (resolve) {
          this.pending.delete(resp['id'] as string);
          resolve(resp);
        }
      } catch {
        // malformed line — ignore
      }
    });

    this.proc.on('error', (err) => {
      process.stderr.write(`[bridge] python error: ${err.message}\n`);
    });
  }

  private call(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = String(++this.counter);
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      const msg = JSON.stringify({ id, action, ...params });
      this.proc.stdin!.write(msg + '\n');
    });
  }

  async analyzeRoot(problem: string): Promise<string> {
    const r = await this.call('analyze_root', { problem });
    if (r['error']) throw new Error(r['error'] as string);
    return r['markdown'] as string;
  }

  async assess(problem: string): Promise<boolean> {
    const r = await this.call('assess', { problem });
    if (r['error']) throw new Error(r['error'] as string);
    return r['is_leaf'] as boolean;
  }

  async decompose(problem: string, parentProblem = ''): Promise<string[]> {
    const r = await this.call('decompose', { problem, parent_problem: parentProblem });
    if (r['error']) throw new Error(r['error'] as string);
    return r['subproblems'] as string[];
  }

  async structuredPlan(problem: string): Promise<Record<string, unknown>> {
    const r = await this.call('structured_plan', { problem });
    if (r['error']) throw new Error(r['error'] as string);
    return r['schema'] as Record<string, unknown>;
  }

  async identifyDeps(problems: string[]): Promise<Record<string, number[]>> {
    const r = await this.call('identify_deps', { problems });
    if (r['error']) throw new Error(r['error'] as string);
    return r['deps'] as Record<string, number[]>;
  }

  async refinePlan(
    problem: string,
    schema: Record<string, unknown>,
    feedback: string,
  ): Promise<Record<string, unknown>> {
    const r = await this.call('refine_plan', { problem, schema, feedback });
    if (r['error']) throw new Error(r['error'] as string);
    return r['schema'] as Record<string, unknown>;
  }

  async refineDecompose(problem: string, subproblems: string[], feedback: string): Promise<string[]> {
    const r = await this.call('refine_decompose', { problem, subproblems, feedback });
    if (r['error']) throw new Error(r['error'] as string);
    return r['subproblems'] as string[];
  }

  destroy() {
    this.proc.stdin!.end();
    this.proc.kill();
  }
}
