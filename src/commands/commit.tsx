import clipboardy from 'clipboardy';
import { Box, render, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { Context } from '../context';
import { DirectTransport, MessageBus } from '../messageBus';
import { NodeBridge } from '../nodeBridge';
import {
  type CommitAction,
  CommitActionSelector,
} from '../ui/CommitActionSelector';
import { CommitResultCard } from '../ui/CommitResultCard';

// ============================================================================
// Types
// ============================================================================

interface GenerateCommitData {
  commitMessage: string;
  branchName: string;
  isBreakingChange: boolean;
  summary: string;
}

interface GitStatusData {
  isRepo: boolean;
  hasUncommittedChanges: boolean;
  hasStagedChanges: boolean;
  isGitInstalled: boolean;
  isUserConfigured: { name: boolean; email: boolean };
}

interface ExecutionResult {
  committed: boolean;
  pushed: boolean;
  copied: boolean;
  branchCreated?: string;
}

type CommitState =
  | { phase: 'validating' }
  | { phase: 'staging' }
  | { phase: 'generating' }
  | { phase: 'displaying'; data: GenerateCommitData }
  | { phase: 'editing'; data: GenerateCommitData; editedMessage: string }
  | { phase: 'editingBranch'; data: GenerateCommitData; editedBranch: string }
  | { phase: 'executing'; action: CommitAction; data: GenerateCommitData }
  | { phase: 'success'; message: string }
  | {
      phase: 'completed';
      data: GenerateCommitData;
      result: ExecutionResult;
    }
  | { phase: 'error'; error: string; recoveryAction?: () => void };

interface CommitUIProps {
  messageBus: MessageBus;
  cwd: string;
  options: CommitOptions;
}

interface CommitOptions {
  stage: boolean;
  commit: boolean;
  push: boolean;
  copy: boolean;
  checkout: boolean;
  noVerify: boolean;
  interactive: boolean;
  model?: string;
  language?: string;
  followStyle: boolean;
}

// ============================================================================
// Main UI Component
// ============================================================================

const CommitUI: React.FC<CommitUIProps> = ({ messageBus, cwd, options }) => {
  const [state, setState] = useState<CommitState>({ phase: 'validating' });
  const [shouldExit, setShouldExit] = useState(false);

  // Handle exit
  useEffect(() => {
    if (shouldExit) {
      process.exit(0);
    }
  }, [shouldExit]);

  // Handle keyboard input for global actions
  useInput((_input, key) => {
    if (key.escape) {
      if (
        state.phase === 'validating' ||
        state.phase === 'staging' ||
        state.phase === 'generating'
      ) {
        setShouldExit(true);
      } else if (state.phase === 'editing') {
        // Cancel editing, go back to displaying
        setState({ phase: 'displaying', data: state.data });
      } else if (state.phase === 'editingBranch') {
        // Cancel editing branch, go back to displaying
        setState({ phase: 'displaying', data: state.data });
      }
    }
  });

  const executeNonInteractiveActions = useCallback(
    async (data: GenerateCommitData) => {
      const { commitMessage } = data;
      const result: ExecutionResult = {
        committed: false,
        pushed: false,
        copied: false,
      };

      // Handle checkout (create branch) first
      if (options.checkout) {
        setState({ phase: 'executing', action: 'checkout', data });
        const branchResult = await messageBus.request('git.createBranch', {
          cwd,
          name: data.branchName,
        });

        if (!branchResult.success) {
          setState({
            phase: 'error',
            error: branchResult.error || 'Failed to create branch',
          });
          return;
        }
        result.branchCreated = branchResult.data?.branchName || data.branchName;
      }

      // Commit changes
      if (options.commit || options.checkout) {
        setState({ phase: 'executing', action: 'commit', data });
        const commitResult = await messageBus.request('git.commit', {
          cwd,
          message: commitMessage,
          noVerify: options.noVerify,
        });

        if (!commitResult.success) {
          const error = commitResult.error || 'Commit failed';
          if (
            error.includes('pre-commit hook failed') ||
            error.includes('hook failed')
          ) {
            setState({
              phase: 'error',
              error: `${error}\n\nHint: Use --no-verify (-n) to skip pre-commit hooks.`,
            });
          } else {
            setState({ phase: 'error', error });
          }
          return;
        }
        result.committed = true;

        // Push if requested
        if (options.push) {
          setState({ phase: 'executing', action: 'push', data });
          const pushResult = await messageBus.request('git.push', { cwd });

          if (!pushResult.success) {
            const error = pushResult.error || 'Push failed';
            if (error.includes('rejected')) {
              setState({
                phase: 'error',
                error: `${error}\n\nHint: Run 'git pull' first to sync with remote.`,
              });
            } else if (error.includes('Authentication')) {
              setState({
                phase: 'error',
                error: `${error}\n\nHint: Check your credentials or setup SSH keys.`,
              });
            } else {
              setState({ phase: 'error', error });
            }
            return;
          }
          result.pushed = true;
        }
      }

      // Copy to clipboard
      if (options.copy) {
        clipboardy.writeSync(commitMessage);
        result.copied = true;
      }

      // Show completed state with detailed info
      setState({
        phase: 'completed',
        data,
        result,
      });

      // Exit after showing results
      setTimeout(() => setShouldExit(true), 1500);
    },
    [messageBus, cwd, options],
  );

  const runWorkflow = useCallback(async () => {
    try {
      // Phase 1: Validate git status
      setState({ phase: 'validating' });
      const statusResult = await messageBus.request('git.status', { cwd });

      if (!statusResult.success) {
        setState({
          phase: 'error',
          error: statusResult.error || 'Failed to get git status',
        });
        return;
      }

      const status = statusResult.data as GitStatusData;

      if (!status.isGitInstalled) {
        setState({
          phase: 'error',
          error:
            'Git is not installed or not available in PATH. Please install Git and try again.',
        });
        return;
      }

      if (!status.isRepo) {
        setState({
          phase: 'error',
          error:
            'Not a Git repository. Please run this command from inside a Git repository.',
        });
        return;
      }

      if (!status.isUserConfigured.name) {
        setState({
          phase: 'error',
          error:
            'Git user name is not configured. Please run: git config --global user.name "Your Name"',
        });
        return;
      }

      if (!status.isUserConfigured.email) {
        setState({
          phase: 'error',
          error:
            'Git user email is not configured. Please run: git config --global user.email "your.email@example.com"',
        });
        return;
      }

      if (!status.hasUncommittedChanges) {
        setState({
          phase: 'error',
          error: 'No changes to commit. Your working tree is clean.',
        });
        return;
      }

      // Phase 2: Stage changes if needed
      if (options.stage) {
        setState({ phase: 'staging' });
        const stageResult = await messageBus.request('git.stage', {
          cwd,
          all: true,
        });

        if (!stageResult.success) {
          setState({
            phase: 'error',
            error: stageResult.error || 'Failed to stage changes',
          });
          return;
        }
      } else if (!status.hasStagedChanges) {
        setState({
          phase: 'error',
          error:
            'No staged changes to commit. Use -s flag to stage all changes or manually stage files with git add.',
        });
        return;
      }

      // Phase 3: Generate commit message
      setState({ phase: 'generating' });
      const generateResult = await messageBus.request(
        'project.generateCommit',
        {
          cwd,
          language: options.language || 'English',
          model: options.model,
        },
      );

      if (!generateResult.success) {
        setState({
          phase: 'error',
          error: generateResult.error || 'Failed to generate commit message',
          recoveryAction: () => runWorkflow(),
        });
        return;
      }

      const data = generateResult.data as GenerateCommitData;

      // Non-interactive mode: execute actions directly
      if (!options.interactive) {
        await executeNonInteractiveActions(data);
        return;
      }

      // Interactive mode: show results
      setState({ phase: 'displaying', data });
    } catch (error: any) {
      setState({
        phase: 'error',
        error: error.message || 'An unexpected error occurred',
      });
    }
  }, [messageBus, cwd, options, executeNonInteractiveActions]);

  // Main workflow
  useEffect(() => {
    runWorkflow();
  }, [runWorkflow]);

  const handleAction = useCallback(
    async (action: CommitAction) => {
      if (
        state.phase !== 'displaying' &&
        state.phase !== 'editing' &&
        state.phase !== 'editingBranch'
      )
        return;

      let data: GenerateCommitData;
      if (state.phase === 'editing') {
        data = { ...state.data, commitMessage: state.editedMessage };
      } else if (state.phase === 'editingBranch') {
        data = { ...state.data, branchName: state.editedBranch };
      } else {
        data = state.data;
      }

      switch (action) {
        case 'copy': {
          clipboardy.writeSync(data.commitMessage);
          setState({
            phase: 'success',
            message: 'Commit message copied to clipboard!',
          });
          setTimeout(() => setShouldExit(true), 1000);
          break;
        }

        case 'commit': {
          setState({ phase: 'executing', action: 'commit', data });
          const result = await messageBus.request('git.commit', {
            cwd,
            message: data.commitMessage,
            noVerify: options.noVerify,
          });

          if (result.success) {
            setState({
              phase: 'success',
              message: 'Changes committed successfully!',
            });
            setTimeout(() => setShouldExit(true), 1000);
          } else {
            const error = result.error || 'Commit failed';
            if (
              error.includes('pre-commit hook failed') ||
              error.includes('hook failed')
            ) {
              setState({
                phase: 'error',
                error: `${error}\n\nHint: Use --no-verify (-n) to skip pre-commit hooks.`,
                recoveryAction: async () => {
                  setState({ phase: 'executing', action: 'commit', data });
                  const retryResult = await messageBus.request('git.commit', {
                    cwd,
                    message: data.commitMessage,
                    noVerify: true,
                  });
                  if (retryResult.success) {
                    setState({
                      phase: 'success',
                      message:
                        'Changes committed successfully (hooks skipped)!',
                    });
                    setTimeout(() => setShouldExit(true), 1000);
                  } else {
                    setState({
                      phase: 'error',
                      error: retryResult.error || 'Commit failed',
                    });
                  }
                },
              });
            } else {
              setState({ phase: 'error', error });
            }
          }
          break;
        }

        case 'push': {
          // First commit
          setState({ phase: 'executing', action: 'commit', data });
          const commitResult = await messageBus.request('git.commit', {
            cwd,
            message: data.commitMessage,
            noVerify: options.noVerify,
          });

          if (!commitResult.success) {
            setState({
              phase: 'error',
              error: commitResult.error || 'Commit failed',
            });
            return;
          }

          // Then push
          setState({ phase: 'executing', action: 'push', data });
          const pushResult = await messageBus.request('git.push', { cwd });

          if (pushResult.success) {
            setState({
              phase: 'success',
              message: 'Changes committed and pushed successfully!',
            });
            setTimeout(() => setShouldExit(true), 1000);
          } else {
            const error = pushResult.error || 'Push failed';
            if (error.includes('rejected')) {
              setState({
                phase: 'error',
                error: `${error}\n\nHint: Run 'git pull' first to sync with remote.`,
              });
            } else {
              setState({ phase: 'error', error });
            }
          }
          break;
        }

        case 'checkout': {
          // Create branch
          setState({ phase: 'executing', action: 'checkout', data });
          const branchResult = await messageBus.request('git.createBranch', {
            cwd,
            name: data.branchName,
          });

          if (!branchResult.success) {
            setState({
              phase: 'error',
              error: branchResult.error || 'Failed to create branch',
            });
            return;
          }

          const branchName = branchResult.data?.branchName || data.branchName;

          // Then commit
          const commitResult = await messageBus.request('git.commit', {
            cwd,
            message: data.commitMessage,
            noVerify: options.noVerify,
          });

          if (commitResult.success) {
            setState({
              phase: 'success',
              message: `Branch '${branchName}' created and changes committed!`,
            });
            setTimeout(() => setShouldExit(true), 1000);
          } else {
            setState({
              phase: 'error',
              error: commitResult.error || 'Commit failed',
            });
          }
          break;
        }

        case 'edit': {
          setState({
            phase: 'editing',
            data,
            editedMessage: data.commitMessage,
          });
          break;
        }

        case 'editBranch': {
          setState({
            phase: 'editingBranch',
            data,
            editedBranch: data.branchName,
          });
          break;
        }

        case 'cancel': {
          setShouldExit(true);
          break;
        }
      }
    },
    [state, messageBus, cwd, options],
  );

  const handleEditSubmit = useCallback(
    (value: string) => {
      if (state.phase !== 'editing') return;
      setState({
        phase: 'displaying',
        data: { ...state.data, commitMessage: value },
      });
    },
    [state],
  );

  const handleBranchEditSubmit = useCallback(
    (value: string) => {
      if (state.phase !== 'editingBranch') return;
      setState({
        phase: 'displaying',
        data: { ...state.data, branchName: value },
      });
    },
    [state],
  );

  // Render based on current state
  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold color="cyan">
          🚀 AI Commit Message Generator
        </Text>
        {options.model && (
          <Text dimColor>
            Model: <Text color="yellow">{options.model}</Text>
          </Text>
        )}
      </Box>

      {/* Validating Phase */}
      {state.phase === 'validating' && (
        <Box>
          <Text color="yellow">⏳ Validating git repository...</Text>
        </Box>
      )}

      {/* Staging Phase */}
      {state.phase === 'staging' && (
        <Box>
          <Text color="yellow">⏳ Staging changes...</Text>
        </Box>
      )}

      {/* Generating Phase */}
      {state.phase === 'generating' && (
        <Box>
          <Text color="yellow">⏳ Generating commit message with AI...</Text>
        </Box>
      )}

      {/* Displaying Phase */}
      {state.phase === 'displaying' && (
        <Box flexDirection="column">
          <CommitResultCard {...state.data} />
          <Box marginTop={1}>
            <CommitActionSelector
              onSelect={handleAction}
              onCancel={() => setShouldExit(true)}
            />
          </Box>
        </Box>
      )}

      {/* Editing Phase */}
      {state.phase === 'editing' && (
        <Box flexDirection="column">
          <CommitResultCard {...state.data} />
          <Box marginTop={1} flexDirection="column">
            <Text bold>Edit commit message:</Text>
            <Box marginTop={1}>
              <Text color="cyan">{'> '}</Text>
              <TextInput
                value={state.editedMessage}
                onChange={(value) =>
                  setState((prev) =>
                    prev.phase === 'editing'
                      ? { ...prev, editedMessage: value }
                      : prev,
                  )
                }
                onSubmit={handleEditSubmit}
              />
            </Box>
            <Box marginTop={1}>
              <Text color="gray" dimColor>
                Press Enter to save, Esc to cancel
              </Text>
            </Box>
          </Box>
        </Box>
      )}

      {/* Editing Branch Phase */}
      {state.phase === 'editingBranch' && (
        <Box flexDirection="column">
          <CommitResultCard {...state.data} />
          <Box marginTop={1} flexDirection="column">
            <Text bold>Edit branch name:</Text>
            <Box marginTop={1}>
              <Text color="cyan">{'> '}</Text>
              <TextInput
                value={state.editedBranch}
                onChange={(value) =>
                  setState((prev) =>
                    prev.phase === 'editingBranch'
                      ? { ...prev, editedBranch: value }
                      : prev,
                  )
                }
                onSubmit={handleBranchEditSubmit}
              />
            </Box>
            <Box marginTop={1}>
              <Text color="gray" dimColor>
                Press Enter to save, Esc to cancel
              </Text>
            </Box>
          </Box>
        </Box>
      )}

      {/* Executing Phase */}
      {state.phase === 'executing' && (
        <Box flexDirection="column">
          <CommitResultCard {...state.data} />
          <Box marginTop={1}>
            <Text color="yellow">
              ⏳{' '}
              {state.action === 'commit'
                ? 'Committing changes...'
                : state.action === 'push'
                  ? 'Pushing to remote...'
                  : state.action === 'checkout'
                    ? 'Creating branch...'
                    : 'Executing...'}
            </Text>
          </Box>
        </Box>
      )}

      {/* Success Phase */}
      {state.phase === 'success' && (
        <Box>
          <Text color="green">✅ {state.message}</Text>
        </Box>
      )}

      {/* Completed Phase - Shows detailed results for non-interactive mode */}
      {state.phase === 'completed' && (
        <Box flexDirection="column">
          <CommitResultCard {...state.data} />
          <Box
            flexDirection="column"
            marginTop={1}
            borderStyle="round"
            borderColor="green"
            paddingX={1}
          >
            <Text bold color="green">
              ✅ Execution Summary
            </Text>
            <Box flexDirection="column" marginTop={1}>
              {state.result.branchCreated && (
                <Text>
                  🌿 Branch created:{' '}
                  <Text color="cyan">{state.result.branchCreated}</Text>
                </Text>
              )}
              {state.result.committed && (
                <Text>
                  ✅ Committed:{' '}
                  <Text color="cyan">{state.data.commitMessage}</Text>
                </Text>
              )}
              {state.result.pushed && (
                <Text>
                  🚀 Pushed:{' '}
                  <Text color="green">Successfully pushed to remote</Text>
                </Text>
              )}
              {state.result.copied && (
                <Text>
                  📋 Clipboard:{' '}
                  <Text color="green">Message copied to clipboard</Text>
                </Text>
              )}
            </Box>
          </Box>
        </Box>
      )}

      {/* Error Phase */}
      {state.phase === 'error' && (
        <ErrorDisplay
          error={state.error}
          recoveryAction={state.recoveryAction}
          onExit={() => setShouldExit(true)}
        />
      )}
    </Box>
  );
};

// ============================================================================
// Error Display Component
// ============================================================================

interface ErrorDisplayProps {
  error: string;
  recoveryAction?: () => void;
  onExit: () => void;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  error,
  recoveryAction,
  onExit,
}) => {
  useInput((input, key) => {
    if (key.escape || input === 'n' || input === 'N') {
      onExit();
    }
    if ((input === 'y' || input === 'Y' || key.return) && recoveryAction) {
      recoveryAction();
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="red">❌ Error: {error}</Text>
      {recoveryAction && (
        <Box marginTop={1}>
          <Text color="yellow">Would you like to retry? (y/N)</Text>
        </Box>
      )}
      {!recoveryAction && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            Press Esc to exit...
          </Text>
        </Box>
      )}
    </Box>
  );
};

// ============================================================================
// Help Text
// ============================================================================

function printHelp(productName: string) {
  console.log(
    `
Usage:
  ${productName} commit [options]

Generate intelligent commit messages based on staged changes.

Options:
  -h, --help                    Show help
  -s, --stage                   Stage all changes before committing
  -c, --commit                  Commit changes automatically
  -n, --no-verify               Skip pre-commit hooks
  -i, --interactive             Interactive mode (default)
  -m, --model <model>           Specify model to use
  --language <language>         Set language for commit message
  --copy                        Copy commit message to clipboard
  --push                        Push changes after commit
  --follow-style                Follow existing repository commit style
  --checkout                    Create and checkout new branch based on commit message

Examples:
  ${productName} commit                 Interactive mode - generate and choose action
  ${productName} commit -s -c           Stage all changes and commit automatically
  ${productName} commit --copy          Generate message and copy to clipboard
  ${productName} commit -s -c --push    Stage, commit and push in one command
  ${productName} commit --follow-style  Generate message following repo style
  ${productName} commit --checkout      Create branch and commit changes
    `.trim(),
  );
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function runCommit(context: Context) {
  const { default: yargsParser } = await import('yargs-parser');
  const argv = yargsParser(process.argv.slice(2), {
    alias: {
      stage: 's',
      commit: 'c',
      noVerify: 'n',
      interactive: 'i',
      model: 'm',
      help: 'h',
    },
    boolean: [
      'stage',
      'push',
      'commit',
      'noVerify',
      'copy',
      'interactive',
      'followStyle',
      'help',
      'checkout',
    ],
    string: ['model', 'language'],
  });

  // Help
  if (argv.help) {
    printHelp(context.productName.toLowerCase());
    return;
  }

  // Determine interactive mode
  let interactive = argv.interactive;
  if (!interactive && !argv.commit && !argv.copy && !argv.checkout) {
    interactive = true;
  }

  const options: CommitOptions = {
    stage: argv.stage || false,
    commit: argv.commit || false,
    push: argv.push || false,
    copy: argv.copy || false,
    checkout: argv.checkout || false,
    noVerify: argv.noVerify || false,
    interactive,
    model: argv.model || context.config.commit?.model || context.config.model,
    language:
      argv.language ||
      context.config.commit?.language ||
      context.config.language,
    followStyle: argv.followStyle || false,
  };

  try {
    // Initialize NodeBridge and message bus
    const nodeBridge = new NodeBridge({
      contextCreateOpts: {
        productName: context.productName,
        version: context.version,
        argvConfig: {},
        plugins: [],
      },
    });

    const [uiTransport, nodeTransport] = DirectTransport.createPair();
    const uiMessageBus = new MessageBus();
    uiMessageBus.setTransport(uiTransport);
    nodeBridge.messageBus.setTransport(nodeTransport);

    // Render the UI
    render(
      <CommitUI
        messageBus={uiMessageBus}
        cwd={context.cwd}
        options={options}
      />,
      {
        patchConsole: true,
        exitOnCtrlC: true,
      },
    );

    // Handle process signals
    const exit = () => {
      process.exit(0);
    };
    process.on('SIGINT', exit);
    process.on('SIGTERM', exit);
  } catch (error: any) {
    console.error('Error initializing commit command:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}
