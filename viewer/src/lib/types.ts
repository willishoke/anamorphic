export interface FieldDef {
  name: string;
  type: string;
  description?: string;
}

export interface DataStructureDef {
  name: string;
  fields?: FieldDef[];
}

export interface FunctionDef {
  name: string;
  signature: string;
  purpose: string;
}

export interface LeafSchema {
  summary?: string;
  estimated_lines?: number;
  data_structures?: DataStructureDef[];
  functions?: FunctionDef[];
  steps?: string[];
  edge_cases?: string[];
}

export interface NodeData {
  id: string;
  problem: string;
  parent_id: string | null;
  children: string[];
  is_leaf: boolean;
  depth: number;
  plan: string | null;
  dependencies: string[];
  schema: LeafSchema | null;
  // set during traversal before full tree is known
  subproblems?: string[];
}

export interface TreeData {
  root_id: string;
  nodes: Record<string, NodeData>;
}

export interface RootAnalysis {
  problem_statement?: string;
  key_components?: string[];
  scope_assessment?: string;
}

// ---- App state machine ----

export type AppScreen =
  | { tag: 'input' }
  | { tag: 'root_review'; problem: string; analysis: RootAnalysis }
  | { tag: 'traversing'; tree: TreeData; currentId: string; nodeMarkdown: string }
  | { tag: 'explore'; tree: TreeData }
  | { tag: 'building' };
