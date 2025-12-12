import * as p from '@umijs/clack-prompts';
import clipboardy from 'clipboardy';
import pc from 'picocolors';
import type { Context } from '../context';
import { type ModelInfo, resolveModelWithContext } from '../model';
import { query } from '../query';
import {
  branchExists,
  createAndCheckoutBranch,
  getRecentCommitMessages,
  getStagedDiff,
  getStagedFileList,
  gitCommit,
  gitPush,
  hasRemote,
  hasUncommittedChanges,
  isGitInstalled,
  isGitRepository,
  isGitUserConfigured,
  stageAll,
} from '../utils/git';
import * as logger from '../utils/logger';

interface GenerateCommitMessageOpts {
  prompt: string;
  language?: string;
  systemPrompt?: string;
  context: Context;
}

interface GenerateBranchNameOpts {
  commitMessage: string;
  language?: string;
  context: Context;
}

async function generateCommitMessage(opts: GenerateCommitMessageOpts) {
  const language = opts.language ?? 'English';
  const systemPrompt = opts.systemPrompt ?? createCommitSystemPrompt(language);

  let model: ModelInfo | undefined;
  if (opts.context.config.commit?.model) {
    const resolved = await resolveModelWithContext(
      opts.context.config.commit.model,
      opts.context,
    );
    model = resolved.model || undefined;
  }

  const result = await query({
    userPrompt: opts.prompt,
    systemPrompt,
    context: opts.context,
    model,
    thinking: false, // Disable thinking mode for commit messages
  });
  let message = result.success ? result.data.text : null;
  if (typeof message !== 'string') {
    throw new Error('Commit message is not a string');
  }
  message = message.trim();
  message = message.replace(/^```/, '').replace(/```$/, '');
  message = message.trim();
  return message;
}

async function generateBranchName(opts: GenerateBranchNameOpts) {
  let model: ModelInfo | undefined;
  if (opts.context.config.commit?.model) {
    const resolved = await resolveModelWithContext(
      opts.context.config.commit.model,
      opts.context,
    );
    model = resolved.model || undefined;
  }

  const result = await query({
    userPrompt: opts.commitMessage,
    systemPrompt: createBranchSystemPrompt(),
    context: opts.context,
    model,
    thinking: false, // Disable thinking mode for branch names
  });
  const branchName = result.success ? result.data.text : null;
  if (typeof branchName !== 'string') {
    throw new Error('Branch name is not a string');
  }
  return branchName.trim();
}

function printHelp(p: string) {
  console.log(
    `
Usage:
  ${p} commit [options]

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
  --ai                          Add [AI] suffix to commit message
  --checkout                    Create and checkout new branch based on commit message

Examples:
  ${p} commit                 Interactive mode - generate and choose action
  ${p} commit -s -c           Stage all changes and commit automatically
  ${p} commit --copy          Generate message and copy to clipboard
  ${p} commit -s -c --push    Stage, commit and push in one command
  ${p} commit --follow-style  Generate message following repo style
  ${p} commit --ai            Generate message with [AI] suffix
  ${p} commit --checkout      Create branch and commit changes
      `.trim(),
  );
}

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
      'ai',
      'checkout',
    ],
    string: ['model', 'language'],
  });

  // help
  if (argv.help) {
    printHelp(context.productName.toLowerCase());
    return;
  }

  logger.logIntro({
    productName: context.productName,
    version: context.version,
  });
  if (!argv.interactive && !argv.commit && !argv.copy) {
    argv.interactive = true;
  }

  // Validation checks
  if (!(await isGitInstalled())) {
    throw new Error(
      'Git is not installed or not available in PATH. Please install Git and try again.',
    );
  }

  if (!(await isGitRepository(context.cwd))) {
    throw new Error(
      'Not a Git repository. Please run this command from inside a Git repository.',
    );
  }

  const userConfig = await isGitUserConfigured(context.cwd);
  if (!userConfig.name) {
    throw new Error(
      'Git user name is not configured. Please run: git config --global user.name "Your Name"',
    );
  }
  if (!userConfig.email) {
    throw new Error(
      'Git user email is not configured. Please run: git config --global user.email "your.email@example.com"',
    );
  }

  const hasChanged = await hasUncommittedChanges(context.cwd);
  if (!hasChanged) {
    logger.logWarn('No changes to commit');
    return;
  }

  if (argv.stage) {
    await stageAll(context.cwd);
  }

  const diff = await getStagedDiff(context.cwd);
  if (diff.length === 0) {
    logger.logWarn(
      'No staged changes to commit. Use -s flag to stage all changes or manually stage files with git add.',
    );
    return;
  }

  const fileList = await getStagedFileList(context.cwd);

  let repoStyle = '';
  if (argv.followStyle) {
    const recentCommits = await getRecentCommitMessages(context.cwd, 10);
    if (recentCommits) {
      repoStyle = `
# Recent commits in this repository:
${recentCommits}
Please follow a similar style for this commit message while still adhering to the structure guidelines.
`;
    } else {
      logger.logError({
        error:
          'Could not analyze repository commit style. Using default style.',
      });
    }
  }

  // Generate the commit message
  const model = context.config.commit?.model || context.config.model;
  logger.logInfo(`Using model: ${model}`);
  let message = '';
  let attempts = 0;
  const maxAttempts = 3;
  while (attempts < maxAttempts) {
    try {
      const stop = logger.spinThink({ productName: context.productName });
      message = await generateCommitMessage({
        prompt: `
# Staged files:
${fileList}

# Diffs:
${diff}
${repoStyle}
      `,
        context,
        language: context.config.commit?.language ?? context.config.language,
        systemPrompt: context.config.commit?.systemPrompt,
      });
      stop();
      checkCommitMessage(message, argv.ai);
      break;
    } catch (error: any) {
      attempts++;
      if (attempts >= maxAttempts) {
        throw error;
      }
    }
  }

  // Add [AI] suffix if --ai flag is used
  const finalMessage = argv.ai ? `${message} [AI]` : message;

  logger.logResult(`Generated commit message: ${pc.cyan(finalMessage)}`);

  // Handle checkout before commit operations
  if (argv.checkout) {
    const stop = logger.spinThink({ productName: context.productName });
    const branchName = await generateBranchName({
      commitMessage: finalMessage,
      language: context.config.commit?.language ?? context.config.language,
      context,
    });
    stop();
    await checkoutNewBranch(context.cwd, branchName);
  }

  // Check if interactive mode is needed
  const isNonInteractiveParam =
    argv.stage || argv.commit || argv.noVerify || argv.copy || argv.checkout;
  if (argv.interactive && !isNonInteractiveParam) {
    await handleInteractiveMode(finalMessage, {
      context,
      language: context.config.commit?.language ?? context.config.language,
    });
  } else {
    // Non-interactive mode logic
    if (argv.commit || argv.checkout) {
      await commitChanges(context.cwd, finalMessage, argv.noVerify);
      if (argv.push) {
        await pushChanges(context.cwd);
      }
    }
    if (argv.copy) {
      copyToClipboard(finalMessage);
    }
  }
  process.exit(0);
}

function copyToClipboard(message: string) {
  clipboardy.writeSync(message);
  logger.logResult('Commit message copied to clipboard');
}

async function checkoutNewBranch(
  cwd: string,
  branchName: string,
): Promise<void> {
  // Check if branch already exists
  if (await branchExists(cwd, branchName)) {
    // Branch exists, add timestamp to make it unique
    const timestamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/[-:]/g, '');
    branchName = `${branchName}-${timestamp}`;
    logger.logWarn(`Branch name already exists, using: ${branchName}`);
  }

  logger.logAction({
    message: `Creating and checking out new branch: ${branchName}`,
  });

  try {
    await createAndCheckoutBranch(cwd, branchName);
    logger.logResult(
      `Successfully created and checked out branch: ${branchName}`,
    );
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';

    if (errorMessage.includes('already exists')) {
      throw new Error(
        `Branch ${branchName} already exists. Please choose a different name.`,
      );
    }

    if (errorMessage.includes('not a valid branch name')) {
      throw new Error(
        `Invalid branch name: ${branchName}. Please use a valid Git branch name.`,
      );
    }

    if (errorMessage.includes('uncommitted changes')) {
      throw new Error(
        'Cannot create branch with uncommitted changes. Please commit or stash your changes first.',
      );
    }

    throw new Error(`Failed to create branch: ${errorMessage}`);
  }
}

async function commitChanges(cwd: string, message: string, skipHooks = false) {
  logger.logAction({ message: 'Commit the changes.' });

  try {
    await gitCommit(cwd, message, skipHooks);
    logger.logResult('Commit message committed');
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';

    if (errorMessage.includes('nothing to commit')) {
      logger.logWarn('No changes to commit');
      return;
    }

    if (
      errorMessage.includes('pre-commit hook failed') ||
      errorMessage.includes('hook failed')
    ) {
      logger.logError({
        error:
          'Pre-commit hook failed. Use --no-verify to skip hooks or fix the issues.',
      });
      throw new Error('Commit failed: Pre-commit hook failed');
    }

    if (errorMessage.includes('Aborting commit due to empty commit message')) {
      logger.logError({ error: 'Commit message is empty' });
      throw new Error('Commit failed: Empty commit message');
    }

    if (errorMessage.includes('Please tell me who you are')) {
      logger.logError({
        error:
          'Git user configuration missing. Please run: git config --global user.name "Your Name" && git config --global user.email "your.email@example.com"',
      });
      throw new Error('Commit failed: Git user configuration missing');
    }

    if (
      errorMessage.includes('divergent branches') ||
      errorMessage.includes('merge conflict')
    ) {
      logger.logError({
        error: 'Repository has conflicts. Please resolve them first.',
      });
      throw new Error('Commit failed: Repository has conflicts');
    }

    logger.logError({ error: `Commit failed: ${errorMessage}` });
    throw new Error(`Commit failed: ${errorMessage}`);
  }
}

async function pushChanges(cwd: string) {
  if (!(await hasRemote(cwd))) {
    logger.logWarn('No remote repository configured, cannot push');
    return;
  }

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      logger.logAction({
        message:
          attempt > 0
            ? `Push changes to remote repository (attempt ${attempt + 1}/${maxRetries}).`
            : 'Push changes to remote repository.',
      });

      await gitPush(cwd);
      logger.logResult('Changes pushed to remote repository');
      return;
    } catch (error: any) {
      attempt++;
      const errorMessage = error.message || 'Unknown error';

      if (
        errorMessage.includes('Authentication failed') ||
        errorMessage.includes('fatal: Authentication')
      ) {
        logger.logError({
          error:
            'Authentication failed. Please check your credentials or setup SSH keys.',
        });
        throw new Error('Push failed: Authentication error');
      }

      if (errorMessage.includes('rejected')) {
        logger.logError({
          error: 'Push rejected: Remote has newer commits. Please pull first.',
        });
        throw new Error('Push failed: Remote repository has newer commits');
      }

      if (
        errorMessage.includes('Permission denied') ||
        errorMessage.includes('access denied')
      ) {
        logger.logError({
          error: 'Permission denied. Check repository access permissions.',
        });
        throw new Error('Push failed: Permission denied');
      }

      if (
        errorMessage.includes('Network is unreachable') ||
        errorMessage.includes('Connection timed out')
      ) {
        if (attempt < maxRetries) {
          logger.logWarn(
            `Network error, retrying in 2 seconds... (${attempt}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        logger.logError({
          error: 'Network error: Unable to reach remote repository.',
        });
        throw new Error('Push failed: Network connectivity issue');
      }

      if (
        errorMessage.includes('repository not found') ||
        errorMessage.includes('does not exist')
      ) {
        logger.logError({
          error: 'Repository not found. Check the remote URL.',
        });
        throw new Error('Push failed: Repository not found');
      }

      if (attempt >= maxRetries) {
        logger.logError({
          error: `Push failed after ${maxRetries} attempts: ${errorMessage}`,
        });
        throw new Error(`Push failed: ${errorMessage}`);
      }

      logger.logWarn(`Push attempt ${attempt} failed, retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// Handle interactive mode
async function handleInteractiveMode(
  message: string,
  config: {
    context: Context;
    language: string;
  },
) {
  const { cwd } = config.context;

  // Ask user what to do next
  const action = await p.select({
    message: pc.bold(
      pc.blueBright('What do you want to do with this commit message?'),
    ),
    options: [
      { label: 'Copy to clipboard', value: 'copy' },
      { label: 'Commit changes', value: 'commit' },
      { label: 'Commit and push changes', value: 'push' },
      { label: 'Create branch and commit', value: 'checkout' },
      { label: 'Edit commit message', value: 'edit' },
      { label: 'Cancel', value: 'cancel' },
    ],
  });

  if (p.isCancel(action)) {
    logger.logAction({ message: 'Operation cancelled' });
    return;
  }

  // Execute actions based on user selection
  switch (action) {
    case 'copy':
      copyToClipboard(message);
      break;
    case 'commit':
      await commitChanges(cwd, message);
      break;
    case 'push': {
      // Ask if pre-commit hooks should be skipped
      const skipHooksResult = await p.confirm({
        message: pc.bold(pc.blueBright('Should pre-commit hooks be skipped?')),
        active: 'Yes',
        inactive: 'No',
        initialValue: false,
      });

      // Check if the result was cancelled
      if (p.isCancel(skipHooksResult)) {
        logger.logAction({ message: 'Operation cancelled' });
        return;
      }

      // Execute the commit
      await commitChanges(cwd, message, skipHooksResult);
      await pushChanges(cwd);
      break;
    }
    case 'checkout': {
      // Generate branch name and let user preview/edit it
      const stop = logger.spinThink({
        productName: config.context.productName,
      });
      const suggestedBranchName = await generateBranchName({
        commitMessage: message,
        language: config.language,
        context: config.context,
      });
      stop();

      const branchName = await p.text({
        message: pc.bold(pc.blueBright('Branch name:')),
        initialValue: suggestedBranchName,
        placeholder: 'Enter branch name',
      });

      if (p.isCancel(branchName)) {
        logger.logAction({ message: 'Operation cancelled' });
        return;
      }

      // Create branch and commit
      await checkoutNewBranch(cwd, branchName);
      await commitChanges(cwd, message);
      break;
    }
    case 'edit': {
      // Ask user to edit the commit message
      const editedMessage = await p.text({
        message: pc.bold(pc.blueBright('Edit the commit message:')),
        initialValue: message,
      });

      if (p.isCancel(editedMessage)) {
        logger.logAction({ message: 'Operation cancelled' });
        return;
      }

      // Use the edited message again to show the operation options
      await handleInteractiveMode(editedMessage, config);
      break;
    }
    case 'cancel':
      logger.logAction({ message: 'Operation cancelled' });
      break;
  }
}

function checkCommitMessage(message: string, hasAiSuffix = false) {
  // make length check a litter more lenient
  // since sometimes it needs a little more informations
  // e.g.
  // - `build: add dev dependencies for basement, axios, git-repo-info, urllib, and zx`
  // Account for [AI] suffix length (5 characters) when checking limit
  // const maxLength = hasAiSuffix ? 85 : 90;
  // if (message.length > maxLength) {
  //   throw new Error(`Commit message is too long: ${message}`);
  // }
  if (message.length === 0) {
    throw new Error('Commit message is empty');
  }
}

function createCommitSystemPrompt(language: string) {
  return `
You are an expert software engineer that generates concise, one-line Git commit messages based on the provided diffs.

Review the provided context and diffs which are about to be committed to a git repo.
Review the diffs carefully.
Generate a one-line commit message for those changes.
The commit message should be structured as follows: <type>: <description>
Use these for <type>: fix, feat, build, chore, ci, docs, style, refactor, perf, test
Use ${language} to generate the commit message.

Ensure the commit message:
- Starts with the appropriate prefix.
- Is in the imperative mood (e.g., "add feature" not "added feature" or "adding feature").
- Does not exceed 72 characters.

Reply only with the one-line commit message, without any additional text, explanations, \
or line breaks.

## Guidelines

- Use present tense, like "add feature" instead of "added feature"
- Do not capitalize the first letter
- Do not end with a period
- Keep it concise and direct, describing the change content
- Please do not overthink, directly generate commit text that follows the specification
- Must strictly adhere to the above standards, without adding any personal explanations or suggestions
  `;
}

function createBranchSystemPrompt() {
  return `
You are an expert software engineer that generates meaningful Git branch names based on commit messages and code changes.

Review the provided commit message and generate a clean, descriptive Git branch name.

## Branch Naming Rules

1. **Format**: Use conventional format when applicable:
   - For conventional commits: \`<type>/<description>\` (e.g., "feat/user-authentication", "fix/memory-leak")
   - For regular commits: \`<description>\` (e.g., "update-documentation", "refactor-api")

2. **Character Rules**:
   - Use only lowercase letters, numbers, and hyphens
   - No spaces, special characters, or underscores
   - Replace spaces with hyphens
   - Maximum 50 characters
   - No leading or trailing hyphens

3. **Content Guidelines**:
   - Be descriptive but concise
   - Focus on the main feature/change being implemented
   - Remove unnecessary words like "the", "a", "an"
   - Use present tense verbs when applicable

## Examples

Input: "feat: add user authentication system"
Output: feat/add-user-authentication

Input: "fix: resolve memory leak in data processing"
Output: fix/resolve-memory-leak

Input: "Update API documentation for new endpoints"
Output: update-api-documentation

Input: "refactor: simplify database connection logic"
Output: refactor/simplify-database-connection

Input: "Add support for dark mode theme"
Output: add-dark-mode-support

## Instructions

Generate ONLY the branch name, without any additional text, explanations, or formatting.
The branch name should be clean, professional, and follow Git best practices.
  `;
}
