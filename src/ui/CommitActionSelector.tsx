import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useMemo, useState } from 'react';

export type CommitAction =
  | 'copy'
  | 'commit'
  | 'push'
  | 'checkout'
  | 'checkoutPush'
  | 'checkoutPushPR'
  | 'edit'
  | 'editBranch'
  | 'cancel';

interface ActionItem {
  value: CommitAction;
  label: string;
  icon: string;
  disabled?: boolean;
  disabledReason?: string;
}

const BASE_ACTIONS: ActionItem[] = [
  { value: 'copy', label: 'Copy to clipboard', icon: '📋' },
  { value: 'commit', label: 'Commit changes', icon: '✅' },
  { value: 'push', label: 'Commit and push', icon: '🚀' },
  { value: 'checkout', label: 'Create branch and commit', icon: '🌿' },
  {
    value: 'checkoutPush',
    label: 'Create branch and commit and push',
    icon: '🌿',
  },
];

const PR_ACTION: ActionItem = {
  value: 'checkoutPushPR',
  label: 'Create branch, commit, push and create PR',
  icon: '🔀',
};

const TAIL_ACTIONS: ActionItem[] = [
  { value: 'edit', label: 'Edit commit message', icon: '📝' },
  { value: 'editBranch', label: 'Edit branch name', icon: '🌿' },
  { value: 'cancel', label: 'Cancel', icon: '❌' },
];

export interface CommitActionSelectorProps {
  onSelect: (action: CommitAction) => void;
  onCancel: () => void;
  disabled?: boolean;
  defaultAction?: CommitAction;
  hasGhCli?: boolean;
  isGitHubRemote?: boolean;
  hasRemote?: boolean;
}

export const CommitActionSelector: React.FC<CommitActionSelectorProps> = ({
  onSelect,
  onCancel,
  disabled = false,
  defaultAction = 'push', // Default to "Commit and push"
  hasGhCli = false,
  isGitHubRemote = false,
  hasRemote = true,
}) => {
  // Build actions list dynamically based on GitHub detection
  const actions = useMemo(() => {
    const showPRAction = hasGhCli && isGitHubRemote;
    const remoteRequiredActions = ['push', 'checkoutPush', 'checkoutPushPR'];
    const noRemoteReason = 'No remote configured';

    // Mark push-related actions as disabled if no remote
    const baseActionsWithRemoteCheck = BASE_ACTIONS.map((action) => {
      if (!hasRemote && remoteRequiredActions.includes(action.value)) {
        return {
          ...action,
          disabled: true,
          disabledReason: noRemoteReason,
        };
      }
      return action;
    });

    // Add PR action if applicable
    let allActions = baseActionsWithRemoteCheck;
    if (showPRAction) {
      const prActionWithCheck = !hasRemote
        ? { ...PR_ACTION, disabled: true, disabledReason: noRemoteReason }
        : PR_ACTION;
      allActions = [...allActions, prActionWithCheck];
    }

    // Separate enabled and disabled actions
    const enabledActions = allActions.filter((a) => !a.disabled);
    const disabledActions = allActions.filter((a) => a.disabled);

    // Put disabled actions at the end, before TAIL_ACTIONS
    return [...enabledActions, ...TAIL_ACTIONS, ...disabledActions];
  }, [hasGhCli, isGitHubRemote, hasRemote]);

  const defaultIndex = actions.findIndex(
    (a) => a.value === defaultAction && !a.disabled,
  );
  const [selectedIndex, setSelectedIndex] = useState(
    defaultIndex >= 0
      ? defaultIndex
      : actions.findIndex((a) => !a.disabled) || 0,
  );

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.escape) {
        onCancel();
        return;
      }

      if (key.return) {
        const selectedAction = actions[selectedIndex];
        // Don't allow selecting disabled actions
        if (!selectedAction.disabled) {
          onSelect(selectedAction.value);
        }
        return;
      }

      if (key.upArrow) {
        setSelectedIndex((prev) => {
          // Find previous non-disabled action
          let newIndex = prev - 1;
          if (newIndex < 0) newIndex = actions.length - 1;

          // Skip disabled actions
          while (actions[newIndex]?.disabled && newIndex !== prev) {
            newIndex--;
            if (newIndex < 0) newIndex = actions.length - 1;
          }

          return newIndex;
        });
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((prev) => {
          // Find next non-disabled action
          let newIndex = prev + 1;
          if (newIndex >= actions.length) newIndex = 0;

          // Skip disabled actions
          while (actions[newIndex]?.disabled && newIndex !== prev) {
            newIndex++;
            if (newIndex >= actions.length) newIndex = 0;
          }

          return newIndex;
        });
        return;
      }

      // Quick select by number (1-9)
      const num = Number.parseInt(input, 10);
      if (num >= 1 && num <= actions.length) {
        const action = actions[num - 1];
        if (!action.disabled) {
          onSelect(action.value);
        }
      }
    },
    { isActive: !disabled },
  );

  return (
    <Box flexDirection="column">
      <Text bold>What would you like to do?</Text>
      <Box flexDirection="column" marginTop={1}>
        {actions.map((action, index) => {
          const isSelected = index === selectedIndex;
          const isDisabled = action.disabled || disabled;
          return (
            <Box key={action.value}>
              <Text
                color={isSelected ? 'cyan' : isDisabled ? 'gray' : undefined}
                inverse={isSelected && !isDisabled}
                dimColor={isDisabled}
              >
                {isSelected ? '● ' : '○ '}
                {action.icon} {action.label}
                {isDisabled && action.disabledReason && (
                  <Text color="yellow"> ({action.disabledReason})</Text>
                )}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          ↑↓ Navigate Enter Select Esc Cancel
        </Text>
      </Box>
    </Box>
  );
};

export default CommitActionSelector;
