import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import ActionMenu from '../components/ActionMenu.js';

export type NodeStatus = 'waiting' | 'running' | 'done' | 'error';

export interface NodeBuildStatus {
  nodeId: string;
  problem: string;
  status: NodeStatus;
  outputPath?: string;
  error?: string;
  // git
  branchName?: string;
  commitCount?: number;
  gitStep?: string;
}

export interface EpochInfo {
  nodes: NodeBuildStatus[];
}

export interface BuildProgress {
  epochs: EpochInfo[];
  activeEpoch: number; // 0-based index into epochs, -1 = not started
  done: boolean;
  fatalError?: string;
  gitEnabled?: boolean;
  outputDir?: string;
}

interface Props {
  progress: BuildProgress;
  onBack: () => void;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const STATUS_ICON: Record<NodeStatus, string> = {
  waiting: '○',
  running: '●',
  done:    '✓',
  error:   '✗',
};

const STATUS_COLOR: Record<NodeStatus, string> = {
  waiting: 'gray',
  running: 'cyan',
  done:    'green',
  error:   'red',
};

function truncate(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export default function BuildScreen({ progress, onBack }: Props) {
  const [spinIdx, setSpinIdx] = useState(0);

  useEffect(() => {
    if (progress.done) return;
    const id = setInterval(() => setSpinIdx((i) => (i + 1) % SPINNER.length), 80);
    return () => clearInterval(id);
  }, [progress.done]);

  useInput((_char, key) => {
    if (progress.done && key.escape) onBack();
  });

  const allNodes = progress.epochs.flatMap((e) => e.nodes);
  const done    = allNodes.filter((n) => n.status === 'done').length;
  const running = allNodes.filter((n) => n.status === 'running').length;
  const errors  = allNodes.filter((n) => n.status === 'error').length;
  const total   = allNodes.length;

  return (
    <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
      {/* Header */}
      <Box marginBottom={1} gap={2}>
        <Text bold color="cyan">anamorphic</Text>
        <Text dimColor>building</Text>
        {progress.gitEnabled && <Text dimColor>[git]</Text>}
        {progress.outputDir  && <Text dimColor>{progress.outputDir}</Text>}
        {!progress.done && <Text color="cyan">{SPINNER[spinIdx]}</Text>}
        {progress.done && errors === 0 && <Text color="green">✓ complete</Text>}
        {progress.done && errors > 0  && <Text color="yellow">⚠ complete with errors</Text>}
      </Box>

      {/* Epoch list */}
      <Box flexDirection="column" gap={1}>
        {progress.epochs.map((epoch, ei) => {
          const isActive  = ei === progress.activeEpoch;
          const isPast    = ei < progress.activeEpoch;
          const isFuture  = ei > progress.activeEpoch;
          const epochColor = isActive ? 'cyan' : isPast ? 'green' : 'gray';
          const epochLabel = `Epoch ${ei + 1} / ${progress.epochs.length}`;

          return (
            <Box key={ei} flexDirection="column">
              <Box gap={2}>
                <Text color={epochColor} bold={isActive}>{epochLabel}</Text>
                {isPast && <Text color="green" dimColor>done</Text>}
                {isActive && !progress.done && <Text color="cyan" dimColor>running</Text>}
                {isFuture && <Text dimColor>waiting</Text>}
              </Box>

                      {/* Only show node rows for active + past epochs, or future if first */}
              {(!isFuture || ei === 0) && epoch.nodes.map((n) => {
                const icon  = n.status === 'running' ? SPINNER[spinIdx]! : STATUS_ICON[n.status]!;
                const color = STATUS_COLOR[n.status]!;
                const label = truncate(n.problem, 40);

                // right-side annotation
                let right = '';
                let rightColor: string | undefined;
                if (n.status === 'running') {
                  right = n.gitStep ?? 'generating…';
                  if (n.commitCount) right += `  ${n.commitCount} commit${n.commitCount !== 1 ? 's' : ''}`;
                } else if (n.status === 'done') {
                  right = n.branchName ? truncate(n.branchName, 36) : truncate(n.outputPath ?? '', 36);
                  if (n.commitCount) right += `  (${n.commitCount})`;
                } else if (n.status === 'error') {
                  right = truncate(n.error ?? 'error', 40);
                  rightColor = 'red';
                }

                return (
                  <Box key={n.nodeId} paddingLeft={2} gap={2}>
                    <Text color={color}>{icon}</Text>
                    <Text color={isFuture ? 'gray' : undefined} dimColor={isFuture}>
                      {label}
                    </Text>
                    {right ? <Text dimColor color={rightColor}>{right}</Text> : null}
                  </Box>
                );
              })}

              {/* Show count for future epochs */}
              {isFuture && ei > 0 && (
                <Box paddingLeft={2}>
                  <Text dimColor>{epoch.nodes.length} node{epoch.nodes.length !== 1 ? 's' : ''}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Footer stats */}
      <Box marginTop={1} gap={3}>
        <Text dimColor>{total} total</Text>
        {done    > 0 && <Text color="green">{done} done</Text>}
        {running > 0 && <Text color="cyan">{running} running</Text>}
        {errors  > 0 && <Text color="red">{errors} errors</Text>}
      </Box>

      {progress.fatalError && (
        <Text color="red">Fatal: {progress.fatalError}</Text>
      )}

      {progress.done && (
        <ActionMenu
          actions={[{ label: 'Back to explore', value: 'back' }]}
          onSelect={onBack}
        />
      )}
    </Box>
  );
}
