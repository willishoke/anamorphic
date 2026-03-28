/**
 * Shown during BFS traversal. Displays one node at a time for user review.
 * User approves or refines before the traversal advances.
 */
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Line } from '../lib/schemaToLines.js';

interface Props {
  nodeId: string;
  problem: string;
  isLeaf: boolean;
  lines: Line[];          // pre-rendered content lines
  loading: boolean;
  queueLength: number;    // remaining nodes after this one
  totalSeen: number;
  onApprove: () => void;
  onRefine: (feedback: string) => void;
}

type Mode = 'view' | 'input';

export default function TraversalScreen({
  nodeId,
  problem,
  isLeaf,
  lines,
  loading,
  queueLength,
  totalSeen,
  onApprove,
  onRefine,
}: Props) {
  const [mode, setMode] = useState<Mode>('view');
  const [feedback, setFeedback] = useState('');
  const [scroll, setScroll] = useState(0);

  const visibleLines = lines.slice(scroll, scroll + 22);
  const canScrollDown = scroll + 22 < lines.length;

  // reset scroll when node changes
  React.useEffect(() => { setScroll(0); setMode('view'); }, [nodeId]);

  useInput((char, key) => {
    if (loading) return;

    if (mode === 'view') {
      if (key.return || char === 'a') { onApprove(); return; }
      if (char === 'r') { setMode('input'); return; }
      if (key.downArrow || char === 'j') setScroll((s) => canScrollDown ? s + 1 : s);
      if (key.upArrow || char === 'k')   setScroll((s) => Math.max(0, s - 1));
      if (char === 'd') setScroll((s) => canScrollDown ? Math.min(s + 6, lines.length - 1) : s);
      if (char === 'u') setScroll((s) => Math.max(0, s - 6));
    }

    if (mode === 'input') {
      if (key.return) {
        const trimmed = feedback.trim();
        if (trimmed) { onRefine(trimmed); setFeedback(''); setMode('view'); }
        return;
      }
      if (key.escape) { setMode('view'); setFeedback(''); return; }
      if (key.backspace || key.delete) { setFeedback((f) => f.slice(0, -1)); return; }
      if (!key.ctrl && !key.meta && char) setFeedback((f) => f + char);
    }
  });

  const tag = isLeaf ? '● leaf' : '◆ internal';
  const tagColor = isLeaf ? 'yellow' : 'blue';

  return (
    <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
      {/* Status bar */}
      <Box marginBottom={1} gap={2}>
        <Text bold color="cyan">Traversal</Text>
        <Text dimColor>node [{nodeId}]</Text>
        <Text color={tagColor}>{tag}</Text>
        <Text dimColor>·  {totalSeen} done  {queueLength} queued</Text>
        {loading && <Text dimColor>  thinking…</Text>}
      </Box>

      {/* Content box */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={loading ? 'gray' : isLeaf ? 'yellow' : 'blue'}
        paddingX={1}
        width={80}
        height={24}
      >
        {loading ? (
          <Text dimColor>Generating…</Text>
        ) : (
          visibleLines.map((line, i) => (
            <Text
              key={i}
              color={line.color as any}
              bold={line.bold}
              dimColor={line.dim}
            >
              {line.text || ' '}
            </Text>
          ))
        )}
      </Box>

      {/* Scroll hint */}
      {!loading && lines.length > 22 && (
        <Text dimColor>  {scroll + 1}/{lines.length}  [j/k] scroll</Text>
      )}

      {/* Actions */}
      <Box marginTop={1}>
        {mode === 'view' ? (
          <Text>
            <Text color="green" bold>[a/↵]</Text>
            <Text> approve  </Text>
            <Text color="yellow" bold>[r]</Text>
            <Text> refine</Text>
          </Text>
        ) : (
          <Box flexDirection="column">
            <Text>Feedback: <Text dimColor>[esc] cancel  [↵] submit</Text></Text>
            <Box borderStyle="round" borderColor="yellow" paddingX={1} width={72}>
              <Text>{feedback}<Text color="yellow">█</Text></Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
