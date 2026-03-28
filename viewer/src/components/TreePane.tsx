import React from 'react';
import { Box, Text } from 'ink';
import { TreeData } from '../lib/types.js';

interface Props {
  tree: TreeData;
  visible: string[];       // ordered list of currently-visible node IDs
  selectedId: string;
  expanded: Set<string>;
  scrollOffset: number;
  height: number;
  width: number;
}

export default function TreePane({ tree, visible, selectedId, expanded, scrollOffset, height, width }: Props) {
  const slice = visible.slice(scrollOffset, scrollOffset + height);

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {slice.map((nodeId) => {
        const node = tree.nodes[nodeId];
        const isSelected = nodeId === selectedId;
        const indent = '  '.repeat(node.depth);
        const icon = node.is_leaf ? '●' : expanded.has(nodeId) ? '▼' : '▶';
        const hasDeps = node.dependencies.length > 0 ? ' ·' : '';
        const maxText = width - indent.length - 4;
        const label = node.problem.length > maxText
          ? node.problem.slice(0, maxText - 1) + '…'
          : node.problem;

        const color = node.is_leaf ? 'yellow' : 'white';

        return (
          <Box key={nodeId}>
            {isSelected ? (
              <Text backgroundColor="cyan" color="black">
                {indent}{icon} {label}{hasDeps}
              </Text>
            ) : (
              <Text color={color}>
                {indent}{icon} {label}
                {hasDeps ? <Text dimColor>{hasDeps}</Text> : null}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export function getVisibleNodes(tree: TreeData, expanded: Set<string>): string[] {
  const result: string[] = [];
  const visit = (id: string) => {
    result.push(id);
    const node = tree.nodes[id];
    if (!node.is_leaf && expanded.has(id)) {
      node.children.forEach(visit);
    }
  };
  visit(tree.root_id);
  return result;
}
