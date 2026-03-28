import React from 'react';
import { Box, Text } from 'ink';
import { TreeData } from '../lib/types.js';
import { nodeDetailLines, Line } from '../lib/schemaToLines.js';

interface Props {
  tree: TreeData;
  nodeId: string;
  scrollOffset: number;
  height: number;
  width: number;
}

export default function DetailPane({ tree, nodeId, scrollOffset, height, width }: Props) {
  const node = tree.nodes[nodeId];
  if (!node) return null;

  const lines: Line[] = nodeDetailLines(node, tree);
  const slice = lines.slice(scrollOffset, scrollOffset + height);

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden" paddingLeft={1}>
      {slice.map((line, i) => (
        <Text
          key={i}
          color={line.color as any}
          bold={line.bold}
          dimColor={line.dim}
          wrap="truncate-end"
        >
          {line.text || ' '}
        </Text>
      ))}
    </Box>
  );
}
