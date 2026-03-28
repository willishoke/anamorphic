/**
 * Shows LLM-generated markdown for a node and lets the user
 * approve or type refinement feedback.
 */
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  title: string;           // header label (e.g. "Root Problem Analysis")
  markdown: string;        // raw markdown text from LLM
  loading: boolean;        // true while LLM is generating / refining
  onApprove: () => void;
  onRefine: (feedback: string) => void;
}

type Mode = 'view' | 'input';

export default function ReviewScreen({ title, markdown, loading, onApprove, onRefine }: Props) {
  const [mode, setMode] = useState<Mode>('view');
  const [feedback, setFeedback] = useState('');
  const [scroll, setScroll] = useState(0);

  const lines = markdown.split('\n');
  const visibleLines = lines.slice(scroll, scroll + 24);
  const canScrollDown = scroll + 24 < lines.length;

  useInput((char, key) => {
    if (loading) return;

    if (mode === 'view') {
      if (key.return || char === 'a') { onApprove(); return; }
      if (char === 'r') { setMode('input'); return; }
      if (key.downArrow || char === 'j') setScroll((s) => canScrollDown ? s + 1 : s);
      if (key.upArrow || char === 'k') setScroll((s) => Math.max(0, s - 1));
      if (char === 'd') setScroll((s) => canScrollDown ? Math.min(s + 8, lines.length - 1) : s);
      if (char === 'u') setScroll((s) => Math.max(0, s - 8));
    }

    if (mode === 'input') {
      if (key.return) {
        const trimmed = feedback.trim();
        if (trimmed) {
          onRefine(trimmed);
          setFeedback('');
          setMode('view');
          setScroll(0);
        }
        return;
      }
      if (key.escape) { setMode('view'); setFeedback(''); return; }
      if (key.backspace || key.delete) { setFeedback((f) => f.slice(0, -1)); return; }
      if (!key.ctrl && !key.meta && char) setFeedback((f) => f + char);
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">{title}</Text>
        {loading && <Text dimColor>  generating…</Text>}
      </Box>

      {/* Content */}
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
          visibleLines.map((line, i) => <MarkdownLine key={i} text={line} />)
        )}
      </Box>

      {/* Scroll hint */}
      {!loading && lines.length > 24 && (
        <Text dimColor>  line {scroll + 1}/{lines.length}  [j/k] scroll  [u/d] page</Text>
      )}

      {/* Action bar / feedback input */}
      <Box marginTop={1} flexDirection="column">
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
            <Box borderStyle="round" borderColor="yellow" paddingX={1} width={72} marginTop={0}>
              <Text>{feedback}<Text color="yellow">█</Text></Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function MarkdownLine({ text }: { text: string }) {
  if (text.startsWith('## ')) return <Text bold color="cyan">{text}</Text>;
  if (text.startsWith('# '))  return <Text bold color="cyan">{text}</Text>;
  if (text.startsWith('- ') || text.startsWith('* ')) return <Text>{text}</Text>;
  if (/^\d+\./.test(text)) return <Text>{text}</Text>;
  if (text.trim() === '') return <Text> </Text>;
  return <Text>{text}</Text>;
}
