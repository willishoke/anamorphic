import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Line } from '../lib/schemaToLines.js';
import ActionMenu from '../components/ActionMenu.js';
import BlinkingCursor from '../components/BlinkingCursor.js';

interface Props {
  title: string;
  lines: Line[];
  loading: boolean;
  onApprove: () => void;
  onRefine: (feedback: string) => void;
  onBack?: () => void;
}

type Mode = 'menu' | 'refine';

const ACTIONS = [
  { label: 'Approve', value: 'approve' },
  { label: 'Refine…', value: 'refine' },
];

export default function ReviewScreen({ title, lines, loading, onApprove, onRefine, onBack }: Props) {
  const [mode, setMode] = useState<Mode>('menu');
  const [feedback, setFeedback] = useState('');
  const [scroll, setScroll] = useState(0);

  const PAGE = 24;
  const visible = lines.slice(scroll, scroll + PAGE);
  const canScrollDown = scroll + PAGE < lines.length;

  React.useEffect(() => { setScroll(0); setMode('menu'); }, [lines]);

  // scroll keys active only in menu mode (no action menu conflict)
  useInput((_char, key) => {
    if (loading || mode !== 'menu') return;
    if (key.escape) { onBack?.(); return; }
    if (key.downArrow) setScroll((s) => canScrollDown ? s + 1 : s);
    if (key.upArrow)   setScroll((s) => Math.max(0, s - 1));
  });

  // refinement text input
  useInput((char, key) => {
    if (mode !== 'refine') return;
    if (key.return) {
      const trimmed = feedback.trim();
      if (trimmed) { onRefine(trimmed); setFeedback(''); setMode('menu'); }
      return;
    }
    if (key.escape) { setMode('menu'); setFeedback(''); return; }
    if (key.backspace || key.delete) { setFeedback((f) => f.slice(0, -1)); return; }
    if (!key.ctrl && !key.meta && char) setFeedback((f) => f + char);
  });

  function handleAction(value: string) {
    if (value === 'approve') onApprove();
    if (value === 'refine')  setMode('refine');
  }

  return (
    <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{title}</Text>
        {loading && <Text dimColor>  generating…</Text>}
      </Box>

      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={loading ? 'gray' : 'cyan'}
        paddingX={1}
        width={78}
      >
        {loading ? (
          <Text dimColor>Please wait…</Text>
        ) : (
          visible.map((line, i) => (
            <Text key={i} color={line.color as any} bold={line.bold} dimColor={line.dim}>
              {line.text || ' '}
            </Text>
          ))
        )}
      </Box>

      {!loading && lines.length > PAGE && (
        <Text dimColor>  ↑ ↓ to scroll  ({scroll + 1}–{Math.min(scroll + PAGE, lines.length)} of {lines.length})</Text>
      )}

      {mode === 'menu' ? (
        <ActionMenu actions={ACTIONS} onSelect={handleAction} disabled={loading} />
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text>What would you like to change?</Text>
          <Text dimColor>Press ↵ to submit or Escape to go back.</Text>
          <Box borderStyle="round" borderColor="yellow" paddingX={1} width={72} marginTop={1}>
            <Text>{feedback}<BlinkingCursor color="yellow" /></Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
