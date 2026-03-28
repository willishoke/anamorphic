/**
 * Renders a LeafSchema or a decomposition list into colored line objects
 * for display in Ink without any LLM calls.
 */
import { LeafSchema, NodeData, TreeData, RootAnalysis } from './types.js';

export interface Line {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

export function rootAnalysisToLines(problem: string, analysis: RootAnalysis): Line[] {
  const lines: Line[] = [];
  lines.push({ text: problem, bold: true });
  lines.push({ text: '' });

  if (analysis.problem_statement) {
    lines.push({ text: '── Problem Statement', color: 'cyan', bold: true });
    lines.push({ text: analysis.problem_statement });
    lines.push({ text: '' });
  }

  if (analysis.key_components?.length) {
    lines.push({ text: '── Key Components', color: 'cyan', bold: true });
    for (const c of analysis.key_components) {
      lines.push({ text: `  · ${c}` });
    }
    lines.push({ text: '' });
  }

  if (analysis.scope_assessment) {
    lines.push({ text: '── Scope Assessment', color: 'cyan', bold: true });
    lines.push({ text: analysis.scope_assessment, dim: true });
    lines.push({ text: '' });
  }

  return lines;
}

export function schemaToLines(problem: string, schema: LeafSchema): Line[] {
  const lines: Line[] = [];

  lines.push({ text: problem, bold: true });
  lines.push({ text: '' });

  if (schema.summary) {
    lines.push({ text: '── Summary', color: 'cyan', bold: true });
    lines.push({ text: schema.summary });
    if (schema.estimated_lines) {
      lines.push({ text: `~${schema.estimated_lines} lines`, dim: true });
    }
    lines.push({ text: '' });
  }

  if (schema.data_structures?.length) {
    lines.push({ text: '── Data Structures', color: 'cyan', bold: true });
    for (const ds of schema.data_structures) {
      lines.push({ text: `  ${ds.name}`, color: 'yellow', bold: true });
      for (const f of ds.fields ?? []) {
        const desc = f.description ? `  — ${f.description}` : '';
        lines.push({ text: `    ${f.name}: ${f.type}${desc}`, dim: true });
      }
    }
    lines.push({ text: '' });
  }

  if (schema.functions?.length) {
    lines.push({ text: '── Functions', color: 'cyan', bold: true });
    for (const fn of schema.functions) {
      lines.push({ text: `  ${fn.signature}`, color: 'green' });
      lines.push({ text: `    ${fn.purpose}`, dim: true });
    }
    lines.push({ text: '' });
  }

  if (schema.steps?.length) {
    lines.push({ text: '── Steps', color: 'cyan', bold: true });
    schema.steps.forEach((s, i) => {
      lines.push({ text: `  ${i + 1}. ${s}` });
    });
    lines.push({ text: '' });
  }

  if (schema.edge_cases?.length) {
    lines.push({ text: '── Edge Cases', color: 'cyan', bold: true });
    for (const ec of schema.edge_cases) {
      lines.push({ text: `  · ${ec}`, dim: true });
    }
    lines.push({ text: '' });
  }

  return lines;
}

export function decompositionToLines(problem: string, subproblems: string[]): Line[] {
  const lines: Line[] = [];
  lines.push({ text: problem, bold: true });
  lines.push({ text: '' });
  lines.push({ text: '── Proposed Decomposition', color: 'cyan', bold: true });
  subproblems.forEach((s, i) => {
    lines.push({ text: `  ${i + 1}. ${s}` });
  });
  lines.push({ text: '' });
  return lines;
}

export function nodeDetailLines(node: NodeData, tree: TreeData): Line[] {
  const lines: Line[] = [];

  lines.push({ text: node.problem, bold: true });
  lines.push({ text: `node ${node.id}  depth ${node.depth}`, dim: true });
  lines.push({ text: '' });

  if (node.dependencies.length > 0) {
    lines.push({ text: '── Depends On', color: 'cyan', bold: true });
    for (const depId of node.dependencies) {
      const dep = tree.nodes[depId];
      const label = dep ? dep.problem.slice(0, 60) + (dep.problem.length > 60 ? '…' : '') : depId;
      lines.push({ text: `  [${depId}] ${label}`, dim: true });
    }
    lines.push({ text: '' });
  }

  if (node.is_leaf && node.schema) {
    lines.push(...schemaToLines('', node.schema as LeafSchema).slice(2)); // skip problem header
  } else if (!node.is_leaf && node.children.length > 0) {
    lines.push({ text: '── Subproblems', color: 'cyan', bold: true });
    node.children.forEach((childId, i) => {
      const child = tree.nodes[childId];
      const tag = child?.is_leaf ? ' ●' : ' ▶';
      lines.push({ text: `  ${i + 1}.${tag} ${child?.problem ?? childId}` });
    });
  }

  return lines;
}
