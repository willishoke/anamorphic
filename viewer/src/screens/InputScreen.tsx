import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  onSubmit: (query: string) => void;
  onQuit: () => void;
  loading: boolean;
  error?: string;
}

export default function InputScreen({ onSubmit, onQuit, loading, error }: Props) {
  const [value, setValue] = useState('');

  useInput((char, key) => {
    if (loading) return;
    if (key.escape) { onQuit(); return; }
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) onSubmit(trimmed);
      return;
    }
    if (key.backspace || key.delete) { setValue((v) => v.slice(0, -1)); return; }
    if (!key.ctrl && !key.meta && char) setValue((v) => v + char);
  });

  return (
    <Box flexDirection="column" paddingTop={2} paddingLeft={3}>
      <Text bold color="cyan">anamorphic</Text>
      <Text dimColor>autonomous problem space explorer</Text>

      <Box marginTop={2} flexDirection="column">
        {loading ? (
          <Box flexDirection="column" gap={1}>
            <Text>Analyzing your problem…</Text>
            <Text dimColor>This may take a few seconds.</Text>
          </Box>
        ) : (
          <>
            <Text>Describe the problem you want to explore:</Text>
            <Box marginTop={1} borderStyle="round" borderColor={error ? 'red' : 'cyan'} paddingX={1} width={72}>
              <Text>
                {value}
                <Text color="cyan">█</Text>
              </Text>
            </Box>
            {error ? (
              <Text color="red">Error: {error}</Text>
            ) : (
              <Text dimColor>Press ↵ to continue · Escape to quit</Text>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
