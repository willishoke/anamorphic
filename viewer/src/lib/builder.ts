/**
 * Executes leaf nodes in topological epoch order.
 * Within each epoch, tasks run in parallel (capped by maxWorkers).
 * Port of anamorphic/builder.py.
 */
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import type { NodeData, LeafSchema } from './types.js';
import { LLMClient } from './llm.js';
import { epochs } from './scheduler.js';

export interface BuildResult {
  nodeId: string;
  outputPath: string;
  error?: string;
}

export interface BuildOptions {
  outputDir?: string;
  maxWorkers?: number;
  onEpochStart?: (epochIdx: number, total: number, size: number) => void;
  onNodeDone?: (result: BuildResult) => void;
}

export async function buildTree(
  nodes: Record<string, NodeData>,
  llm: LLMClient,
  opts: BuildOptions = {},
): Promise<BuildResult[]> {
  const {
    outputDir = 'output',
    maxWorkers = 4,
    onEpochStart,
    onNodeDone,
  } = opts;

  await mkdir(outputDir, { recursive: true });

  const schedule = epochs(nodes);
  const results: BuildResult[] = [];

  for (let ei = 0; ei < schedule.length; ei++) {
    const epoch = schedule[ei]!;
    onEpochStart?.(ei + 1, schedule.length, epoch.length);

    // run epoch in chunks of maxWorkers
    for (let i = 0; i < epoch.length; i += maxWorkers) {
      const chunk = epoch.slice(i, i + maxWorkers);
      const chunkResults = await Promise.all(chunk.map((nodeId) => buildNode(nodeId, nodes[nodeId]!, llm, outputDir)));
      for (const r of chunkResults) {
        results.push(r);
        onNodeDone?.(r);
      }
    }
  }

  // write manifest
  const manifest: Record<string, { problem: string; output: string }> = {};
  for (const r of results) {
    if (!r.error) manifest[r.nodeId] = { problem: nodes[r.nodeId]!.problem, output: r.outputPath };
  }
  await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return results;
}

async function buildNode(
  nodeId: string,
  node: NodeData,
  llm: LLMClient,
  outputDir: string,
): Promise<BuildResult> {
  try {
    const code = await llm.implement(node.problem, (node.schema ?? {}) as LeafSchema);
    const filename = slug(node.problem) + '.py';
    const outputPath = path.join(outputDir, filename);
    await writeFile(outputPath, code, 'utf8');
    return { nodeId, outputPath };
  } catch (e) {
    return { nodeId, outputPath: '', error: String(e) };
  }
}

function slug(text: string, max = 48): string {
  return text.toLowerCase().slice(0, max).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'module';
}
