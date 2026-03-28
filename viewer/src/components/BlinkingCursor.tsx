import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

interface Props {
  color?: string;
  interval?: number;
}

export default function BlinkingCursor({ color = 'white', interval = 530 }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setVisible((v) => !v), interval);
    return () => clearInterval(id);
  }, [interval]);

  return <Text color={color}>{visible ? '▌' : ' '}</Text>;
}
