/**
 * LLM client. Two backends, resolved at construction time:
 *   - sdk  : Anthropic SDK (when ANTHROPIC_API_KEY is set)
 *   - cli  : `claude -p` subprocess (Claude Code / Pro)
 *
 * All structured outputs request JSON instead of YAML, keeping the
 * runtime dependency-free (no js-yaml needed).
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { RootAnalysis, LeafSchema } from './types.js';

const execFileP = promisify(execFile);

const MODEL = 'claude-sonnet-4-6';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;
const MAX_BUF = 16 * 1024 * 1024; // 16 MB

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

function extractJSON(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]!.trim()); } catch { /* fall through */ } }
  const obj = t.indexOf('{'), arr = t.indexOf('[');
  const start = obj === -1 ? arr : arr === -1 ? obj : Math.min(obj, arr);
  if (start !== -1) {
    const end = t[start] === '{' ? t.lastIndexOf('}') : t.lastIndexOf(']');
    if (end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch { /* fall through */ } }
  }
  throw new Error(`No JSON found in response: ${t.slice(0, 120)}`);
}

// ---------------------------------------------------------------------------
// LLM schema template (embedded in prompts)
// ---------------------------------------------------------------------------

const PLAN_SCHEMA = `{
  "summary": "one-sentence description of what this module does",
  "estimated_lines": 120,
  "data_structures": [
    { "name": "ClassName", "fields": [{ "name": "field", "type": "Python type", "description": "optional" }] }
  ],
  "functions": [
    { "name": "func_name", "signature": "func_name(x: int) -> str", "purpose": "one-line purpose" }
  ],
  "steps": ["first implementation step", "second step"],
  "edge_cases": ["edge case or error condition to handle"]
}`;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class LLMClient {
  private mode: 'sdk' | 'cli';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sdk: any = null;

  constructor() {
    this.mode = process.env['ANTHROPIC_API_KEY'] ? 'sdk' : 'cli';
    if (this.mode === 'sdk') {
      import('@anthropic-ai/sdk').then((m) => { this.sdk = new m.default(); }).catch(() => {
        this.mode = 'cli'; // fall back if SDK import fails
      });
    }
  }

  // ---- public methods -------------------------------------------------------

  async analyzeRoot(problem: string): Promise<RootAnalysis> {
    const text = await this.call(`You are analyzing a software problem before breaking it down.

Problem:
${problem}

Respond with ONLY valid JSON — no markdown fences, no explanation.
Use exactly this structure:
{
  "problem_statement": "restate the problem clearly in 1-2 sentences",
  "key_components": ["major component or concern", "another component"],
  "scope_assessment": "1-2 sentences on size/complexity and why decomposition is needed"
}`);
    return extractJSON(text) as RootAnalysis;
  }

  async assess(problem: string): Promise<boolean> {
    const text = await this.call(`Can a skilled developer fully implement the following problem in 500 or fewer lines of Python?

Problem:
${problem}

Rules:
- 500 lines is roughly one focused module; count only implementation lines
- Standard library and common packages are available
- The problem must be specific enough to implement directly

Answer with ONLY the single word "yes" or "no".`);
    return text.trim().toLowerCase().startsWith('yes');
  }

  async decompose(problem: string, parentProblem = ''): Promise<string[]> {
    const ctx = parentProblem ? `\nParent problem for context: ${parentProblem}` : '';
    const text = await this.call(`You are decomposing a software engineering problem into concrete subproblems.

Problem:${ctx}
${problem}

Break this into 2–5 concrete, non-overlapping subproblems that together fully solve it.
Each subproblem must be specific, actionable, and independently implementable.

Respond with ONLY a valid JSON array of strings — no other text.
Example: ["subproblem one", "subproblem two", "subproblem three"]`);
    return extractJSON(text) as string[];
  }

  async structuredPlan(problem: string): Promise<LeafSchema> {
    const text = await this.call(`You are creating a structured implementation plan for a software problem (≤500 lines of Python).

Problem:
${problem}

Respond with ONLY valid JSON — no markdown fences, no explanation.
Use exactly this structure:
${PLAN_SCHEMA}`);
    return extractJSON(text) as LeafSchema;
  }

  async identifyDeps(problems: string[]): Promise<Record<string, number[]>> {
    if (problems.length < 2) return {};
    const numbered = problems.map((p, i) => `${i}. ${p}`).join('\n');
    const text = await this.call(`Identify dependencies between these software subproblems.

Subproblems:
${numbered}

A depends on B means A cannot start until B is finished.
Respond with ONLY a valid JSON object mapping each dependent index (as a string) to an array of indices it depends on.
Only include entries where there is at least one dependency. Omit independent subproblems.
Example: {"2": [0, 1], "1": [0]}`);
    try { return extractJSON(text) as Record<string, number[]>; } catch { return {}; }
  }

  async refinePlan(problem: string, schema: LeafSchema, feedback: string): Promise<LeafSchema> {
    const text = await this.call(`Revise this implementation plan based on user feedback.

Problem:
${problem}

Current plan (JSON):
${JSON.stringify(schema, null, 2)}

User feedback:
${feedback}

Respond with ONLY valid JSON using the same structure as the current plan.`);
    return extractJSON(text) as LeafSchema;
  }

  async refineDecompose(problem: string, subproblems: string[], feedback: string): Promise<string[]> {
    const current = subproblems.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const text = await this.call(`Revise this decomposition based on user feedback.

Problem:
${problem}

Current decomposition:
${current}

User feedback:
${feedback}

Respond with ONLY a valid JSON array of strings — no other text.`);
    return extractJSON(text) as string[];
  }

  async implement(problem: string, schema: LeafSchema): Promise<string> {
    return this.call(`Implement the following as a complete Python module.

Problem:
${problem}

Plan (JSON):
${JSON.stringify(schema, null, 2)}

Requirements:
- A single Python module (.py file)
- Include all necessary imports
- No placeholder TODOs — implement everything
- No markdown fences or explanation — output raw Python code only`);
  }

  // ---- internals ------------------------------------------------------------

  private async call(prompt: string): Promise<string> {
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return this.mode === 'sdk' && this.sdk
          ? await this.callSDK(prompt)
          : await this.callCLI(prompt);
      } catch (e) {
        lastErr = e as Error;
        if (attempt < MAX_RETRIES - 1) await sleep(RETRY_BASE_MS * (attempt + 1));
      }
    }
    throw lastErr ?? new Error('LLM call failed after retries');
  }

  private async callSDK(prompt: string): Promise<string> {
    const msg = await this.sdk.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    return block?.type === 'text' ? block.text : '';
  }

  private async callCLI(prompt: string): Promise<string> {
    try {
      const { stdout } = await execFileP('claude', ['-p', prompt], {
        maxBuffer: MAX_BUF,
        timeout: 180_000,
      });
      return stdout;
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'ENOENT') {
        throw new Error('claude CLI not found. Install Claude Code or set ANTHROPIC_API_KEY.');
      }
      throw new Error(err.message ?? String(e));
    }
  }
}
