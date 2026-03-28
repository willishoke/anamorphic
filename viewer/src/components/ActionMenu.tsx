import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface Action {
  label: string;
  value: string;
}

interface Props {
  actions: Action[];
  onSelect: (value: string) => void;
  disabled?: boolean;
}

export default function ActionMenu({ actions, onSelect, disabled = false }: Props) {
  const [idx, setIdx] = useState(0);

  useInput((_char, key) => {
    if (disabled) return;
    if (key.leftArrow)  setIdx((i) => Math.max(0, i - 1));
    if (key.rightArrow) setIdx((i) => Math.min(actions.length - 1, i + 1));
    if (key.return)     onSelect(actions[idx]!.value);
  });

  return (
    <Box gap={1} marginTop={1}>
      {actions.map((a, i) => {
        const selected = i === idx;
        return (
          <Box
            key={a.value}
            borderStyle="round"
            borderColor={selected ? 'cyan' : 'gray'}
            paddingX={1}
          >
            <Text color={selected ? 'cyan' : 'gray'} bold={selected}>
              {a.label}
            </Text>
          </Box>
        );
      })}
      {!disabled && (
        <Text dimColor> ← → to move  ↵ to select</Text>
      )}
    </Box>
  );
}
