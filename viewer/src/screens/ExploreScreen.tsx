import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { TreeData } from '../lib/types.js';
import TreePane, { getVisibleNodes } from '../components/TreePane.js';
import DetailPane from '../components/DetailPane.js';
import { nodeDetailLines } from '../lib/schemaToLines.js';
import { writeFileSync } from 'fs';

interface Props {
  tree: TreeData;
  onQuit: () => void;
}

export default function ExploreScreen({ tree, onQuit }: Props) {
  const { stdout } = useStdout();
  const termW = stdout?.columns ?? 120;
  const termH = (stdout?.rows ?? 40) - 3; // subtract header + status

  const treeW = Math.floor(termW * 0.36);
  const detailW = termW - treeW - 3;

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([tree.root_id]),
  );
  const [selectedId, setSelectedId] = useState(tree.root_id);
  const [treeScroll, setTreeScroll] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);

  const visible = getVisibleNodes(tree, expanded);
  const selIdx = visible.indexOf(selectedId);

  useInput((char, key) => {
    if (char === 'q' || key.escape) { onQuit(); return; }

    // tree navigation
    if (key.upArrow || char === 'k') {
      const ni = Math.max(0, selIdx - 1);
      setSelectedId(visible[ni]!);
      setDetailScroll(0);
      if (ni < treeScroll) setTreeScroll(ni);
    }
    if (key.downArrow || char === 'j') {
      const ni = Math.min(visible.length - 1, selIdx + 1);
      setSelectedId(visible[ni]!);
      setDetailScroll(0);
      if (ni >= treeScroll + termH) setTreeScroll(ni - termH + 1);
    }
    if (key.rightArrow || char === 'l') {
      const node = tree.nodes[selectedId]!;
      if (!node.is_leaf && !expanded.has(selectedId)) {
        setExpanded((e) => new Set([...e, selectedId]));
      }
    }
    if (key.leftArrow || char === 'h') {
      const node = tree.nodes[selectedId]!;
      if (!node.is_leaf && expanded.has(selectedId)) {
        setExpanded((e) => { const s = new Set(e); s.delete(selectedId); return s; });
      } else if (node.parent_id) {
        setSelectedId(node.parent_id);
        setDetailScroll(0);
      }
    }
    if (key.return || char === ' ') {
      const node = tree.nodes[selectedId]!;
      if (!node.is_leaf) {
        setExpanded((e) => {
          const s = new Set(e);
          s.has(selectedId) ? s.delete(selectedId) : s.add(selectedId);
          return s;
        });
      }
    }

    // detail scroll
    const detailLines = nodeDetailLines(tree.nodes[selectedId]!, tree);
    const maxDetailScroll = Math.max(0, detailLines.length - termH);
    if (char === 'u') setDetailScroll((s) => Math.max(0, s - 4));
    if (char === 'd') setDetailScroll((s) => Math.min(maxDetailScroll, s + 4));

    // save
    if (char === 's') {
      try {
        const out = JSON.stringify({ root_id: tree.root_id, nodes: tree.nodes }, null, 2);
        writeFileSync('tree.json', out);
      } catch { /* ignore */ }
    }
  });

  const s = statsOf(tree);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box paddingX={1} borderStyle="single" borderColor="cyan">
        <Text bold color="cyan">anamorphic  </Text>
        <Text dimColor>
          {s.total_nodes} nodes  {s.leaf_nodes} leaves  depth {s.max_depth}
        </Text>
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
          scrollOffset={detailScroll}
          height={termH}
          width={detailW}
        />
      </Box>

      {/* Status */}
      <Box paddingX={1}>
        <Text dimColor>
          [↑↓/jk] navigate  [←→/hl] collapse/expand  [space/↵] toggle  [u/d] scroll detail  [s] save  [q] quit
        </Text>
      </Box>
    </Box>
  );
}

function statsOf(tree: TreeData) {
  const nodes = Object.values(tree.nodes);
  const leaves = nodes.filter((n) => n.is_leaf);
  return {
    total_nodes: nodes.length,
    leaf_nodes: leaves.length,
    max_depth: Math.max(...nodes.map((n) => n.depth), 0),
  };
}
