# Config Skills Array

**Date:** 2026-01-19

## Context

Users need a way to specify extra SKILL.md files beyond the standard discovery locations (global, project, plugin). The existing skill loading mechanism only discovers skills from predefined directories, limiting flexibility for users who want to reference skills from arbitrary locations on their filesystem.

## Discussion

The key design question was what format the `skills` config should accept:

1. **Absolute paths to SKILL.md files** - Direct references like `/path/to/my-skill/SKILL.md`
2. **Directory paths containing SKILL.md** - References like `/path/to/my-skill` where SKILL.md is expected inside
3. **Both formats supported** - Auto-detect whether the path is a file or directory

The decision was made to support **both formats**, providing maximum flexibility. If a path points to a directory, the system looks for `SKILL.md` inside it. If it points directly to a SKILL.md file, it loads that file directly.

## Approach

Add a new `skills: string[]` configuration option that allows users to specify additional skill paths. These paths are loaded with a new `SkillSource.Config` source type, distinct from plugin, global, and project sources.

The loading happens during the existing `loadSkills()` flow, after plugin skills but before directory-based discovery, giving config-specified skills appropriate priority.

## Architecture

### Config Changes (`src/config.ts`)

- Added `skills?: string[]` to the `Config` type
- Added `'skills'` to `VALID_CONFIG_KEYS` for validation
- Added `'skills'` to `ARRAY_CONFIG_KEYS` for proper array handling in config commands

### Skill Source Enum (`src/skill.ts`)

Added new enum value:
```typescript
export enum SkillSource {
  Plugin = 'plugin',
  Config = 'config',  // NEW
  GlobalClaude = 'global-claude',
  Global = 'global',
  ProjectClaude = 'project-claude',
  Project = 'project',
}
```

### Skill Loading (`src/skill.ts`)

New `loadSkillPath()` method that handles both path formats:
```typescript
private loadSkillPath(skillPath: string, source: SkillSource): void {
  const stat = fs.statSync(skillPath);
  if (stat.isDirectory()) {
    const skillFilePath = path.join(skillPath, 'SKILL.md');
    if (fs.existsSync(skillFilePath)) {
      this.loadSkillFile(skillFilePath, source);
    } else {
      // Error: Directory does not contain SKILL.md
    }
  } else {
    this.loadSkillFile(skillPath, source);
  }
}
```

Loading order in `loadSkills()`:
1. Plugin skills (via hook)
2. **Config skills** (new)
3. Global Claude directory
4. Global directory
5. Project Claude directory
6. Project directory

### UI Updates (`src/commands/skill.tsx`)

Added `SkillSource.Config` to source label and color maps for proper display in skill list.

### Usage

```bash
# Add via CLI
neovate config add skills "/path/to/my-skill/SKILL.md"
neovate config add skills "/path/to/skill-directory"

# Or in config.json
{
  "skills": [
    "/path/to/my-skill/SKILL.md",
    "/path/to/another-skill"
  ]
}
```
