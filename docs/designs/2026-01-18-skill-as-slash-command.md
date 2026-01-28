# Skill as Slash Command

**Date:** 2026-01-18

## Context

Skills in Neovate Code are reusable prompt templates stored in `SKILL.md` files that can be invoked via the `skill` tool. The motivation was to make skills more accessible by allowing them to be invoked directly as slash commands (e.g., `/frontend-design` instead of requiring the AI to use the skill tool).

Additionally, when skills are used as slash commands, they need context about their base directory to properly reference any associated files or resources.

## Discussion

### Key Questions Addressed

1. **Priority/Override behavior**: Should skills override existing slash commands with the same name, or should existing commands take priority?
   - **Decision**: Existing commands take priority. Skills are only added as slash commands if no command with the same name already exists.

2. **CommandSource for skill-based commands**: Should we add a new `CommandSource.Skill` enum value or reuse existing sources?
   - **Initial approach**: Add new `CommandSource.Skill`
   - **Final decision**: Reuse existing `CommandSource.User` for global skills and `CommandSource.Project` for project skills, maintaining consistency with how other user-defined commands are categorized.

3. **Skill source mapping**: Skills have multiple sources (Plugin, GlobalClaude, Global, ProjectClaude, Project). How to map these to command sources?
   - Global-level skills (`Global`, `GlobalClaude`) → `CommandSource.User`
   - Project-level skills (`Project`, `ProjectClaude`) → `CommandSource.Project`

## Approach

The solution integrates skill loading into the `SlashCommandManager` constructor:

1. After loading all existing commands (builtin, plugin, global, project), iterate through available skills from `SkillManager`
2. For each skill, check if a command with the same name already exists
3. If no conflict, convert the skill to a `PromptCommand` and add it to the commands map
4. The skill's prompt is prefixed with `Base directory for this skill: {{skill dir}}\n\n` to provide context

## Architecture

### Modified Components

**`src/slashCommand.ts`**:
- Added `skillManager?: SkillManager` to `SlashCommandManagerOpts`
- Added step 7 in constructor to load skills as commands after all other command sources
- New private method `#skillToCommandEntry(skill, skillManager)` that:
  - Determines command source based on skill source (global vs project)
  - Creates a `PromptCommand` with async `getPromptForCommand` that reads skill body and prepends base directory
  - Supports parameter placeholders (`$1`, `$2`, `$ARGUMENTS`)

**`SlashCommandManager.create()`**:
- Updated to pass `context.skillManager` to the constructor

### Command Loading Order

1. Builtin commands
2. Plugin commands
3. Global (.claude) commands
4. Global (.{productName}) commands
5. Project (.claude) commands
6. Project (.{productName}) commands
7. **Skills** (new - only if no name conflict)

### Prompt Format for Skill Commands

```
Base directory for this skill: /path/to/skill/directory

[Original skill body content]

Arguments: [user provided args if any]
```

### Description Format

Skills show their source in the description:
- Global skills: `[skill description] (global skill)`
- Project skills: `[skill description] (project skill)`
