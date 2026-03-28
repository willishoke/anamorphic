import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  onSubmit: (query: string) => void;
}

export default function InputScreen({ onSubmit }: Props) {
  const [value, setValue] = useState('');

  useInput((char, key) => {
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) onSubmit(trimmed);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (!key.ctrl && !key.meta && char) {
      setValue((v) => v + char);
    }
  });

  return (
    <Box flexDirection="column" paddingTop={2} paddingLeft={3}>
      <Text bold color="cyan">
        anamorphic
      </Text>
      <Text dimColor>autonomous problem space explorer</Text>
      <Box marginTop={2} flexDirection="column">
        <Text>Describe your problem:</Text>
        <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1} width={72}>
          <Text>
            {value}
            <Text color="cyan">█</Text>
          </Text>
        </Box>
        <Text dimColor>  [enter] submit</Text>
      </Box>
    </Box>
  );
}
