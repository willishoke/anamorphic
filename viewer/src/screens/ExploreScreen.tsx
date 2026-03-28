import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { TreeData } from '../lib/types.js';
import TreePane, { getVisibleNodes } from '../components/TreePane.js';
import DetailPane from '../components/DetailPane.js';
import ActionMenu from '../components/ActionMenu.js';
import { nodeDetailLines } from '../lib/schemaToLines.js';
import { writeFileSync } from 'fs';

interface Props {
  tree: TreeData;
  onQuit: () => void;
  onBack?: () => void;
  onBuild?: (git: boolean) => void;
}

const BOTTOM_ACTIONS = [
  { label: 'Build', value: 'build' },
  { label: 'Build with git', value: 'build-git' },
  { label: 'Save tree', value: 'save' },
  { label: 'Quit', value: 'quit' },
];

export default function ExploreScreen({ tree, onQuit, onBack, onBuild }: Props) {
  const { stdout } = useStdout();
  const termW = stdout?.columns ?? 120;
  const termH = (stdout?.rows ?? 40) - 5; // header + footer + action menu

  const treeW = Math.floor(termW * 0.36);
  const detailW = termW - treeW - 3;

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([tree.root_id]));
  const [selectedId, setSelectedId] = useState(tree.root_id);
  const [treeScroll, setTreeScroll] = useState(0);
  const [saved, setSaved] = useState(false);

  const visible = getVisibleNodes(tree, expanded);
  const selIdx = visible.indexOf(selectedId);

  useInput((_char, key) => {
    if (key.escape) { onBack?.(); return; }
    if (key.upArrow) {
      const ni = Math.max(0, selIdx - 1);
      setSelectedId(visible[ni]!);
      if (ni < treeScroll) setTreeScroll(ni);
    }
    if (key.downArrow) {
      const ni = Math.min(visible.length - 1, selIdx + 1);
      setSelectedId(visible[ni]!);
      if (ni >= treeScroll + termH) setTreeScroll(ni - termH + 1);
    }
    if (key.rightArrow) {
      const node = tree.nodes[selectedId]!;
      if (!node.is_leaf) setExpanded((e) => new Set([...e, selectedId]));
    }
    if (key.leftArrow) {
      const node = tree.nodes[selectedId]!;
      if (!node.is_leaf && expanded.has(selectedId)) {
        setExpanded((e) => { const s = new Set(e); s.delete(selectedId); return s; });
      } else if (node.parent_id) {
        setSelectedId(node.parent_id);
      }
    }
    if (key.return) {
      const node = tree.nodes[selectedId]!;
      if (!node.is_leaf) {
        setExpanded((e) => {
          const s = new Set(e);
          s.has(selectedId) ? s.delete(selectedId) : s.add(selectedId);
          return s;
        });
      }
    }
  });

  function handleAction(value: string) {
    if (value === 'build')     { onBuild?.(false); return; }
    if (value === 'build-git') { onBuild?.(true);  return; }
    if (value === 'quit') { onQuit(); return; }
    if (value === 'save') {
      try {
        writeFileSync('tree.json', JSON.stringify({ root_id: tree.root_id, nodes: tree.nodes }, null, 2));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch { /* ignore */ }
    }
  }

  const s = statsOf(tree);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box paddingX={1} borderStyle="single" borderColor="cyan">
        <Text bold color="cyan">anamorphic  </Text>
        <Text dimColor>{s.total} nodes  {s.leaves} leaves  depth {s.depth}  </Text>
        <Text dimColor>↑↓ navigate  ←→ expand/collapse  ↵ toggle</Text>
        {saved && <Text color="green">  ✓ saved</Text>}
      </Box>

      {/* Two panes */}
      <Box flexDirection="row">
        <TreePane
          tree={tree}
          visible={visible}
          selectedId={selectedId}
          expanded={expanded}
          scrollOffset={treeScroll}
          height={termH}
          width={treeW}
        />
        <Box borderLeft borderStyle="single" borderColor="gray" />
        <DetailPane
          tree={tree}
          nodeId={selectedId}
          scrollOffset={0}
          height={termH}
          width={detailW}
        />
      </Box>

      {/* Action menu */}
      <Box paddingLeft={2}>
        <ActionMenu actions={BOTTOM_ACTIONS} onSelect={handleAction} />
      </Box>
    </Box>
  );
}

function statsOf(tree: TreeData) {
  const nodes = Object.values(tree.nodes);
  return {
    total: nodes.length,
    leaves: nodes.filter((n) => n.is_leaf).length,
    depth: Math.max(...nodes.map((n) => n.depth), 0),
  };
}
