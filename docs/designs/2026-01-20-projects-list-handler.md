# Projects List Handler

**Date:** 2026-01-20

## Context

The user requested adding a handler to list all projects that have been used with takumi/@neovate/code before. The goal is to provide visibility into which projects have session history, enabling features like project switching, recent projects display, or analytics.

## Discussion

Key questions explored during the design:

1. **Data Source**: Where should the project list come from?
   - Option A: `GlobalData` projects from `~/.neovate/data.json` (stores projects with history and lastAccessed)
   - Option B: Scan `~/.neovate/projects/` directory for session log folders
   - Option C: Combine both sources
   
   **Decision**: Use `GlobalData` projects as the canonical source since it already tracks project history and last accessed timestamps.

2. **Return Data**: What information should be returned?
   - Option A: Basic info only (path, lastAccessed, session count)
   - Option B: Include session details (summaries, message counts)
   - Option C: Include full log paths
   
   **Decision**: Return basic info by default, with an optional `includeSessionDetails` parameter to get full session information when needed.

## Approach

Add a new `projects.list` handler to `nodeBridge.ts` that:

1. Reads all projects from `GlobalData` (stored in `~/.neovate/data.json`)
2. For each project, calculates the session count by checking the project's session directory
3. Optionally includes full session details when `includeSessionDetails=true`
4. Sorts results by `lastAccessed` timestamp (most recent first)
5. Returns a structured response with project metadata

## Architecture

### Handler: `projects.list`

**Location**: `src/nodeBridge.ts`

**Input Parameters**:
```typescript
{
  cwd: string;                      // Required: Current working directory (for context)
  includeSessionDetails?: boolean;  // Optional: Include full session details (default: false)
}
```

**Response Structure**:
```typescript
{
  success: true,
  data: {
    projects: Array<{
      path: string;                   // Project directory path
      lastAccessed: number | null;    // Timestamp of last access
      sessionCount: number;           // Number of sessions for this project
      sessions?: Array<{              // Only when includeSessionDetails=true
        sessionId: string;
        modified: Date;
        created: Date;
        messageCount: number;
        summary: string;
      }>;
    }>
  }
}
```

**Implementation Details**:

1. Uses `GlobalData.readData()` to get all tracked projects
2. Uses `Paths` class to construct project-specific paths and get session info via `getAllSessions()`
3. Checks `existsSync(projectPaths.globalProjectDir)` before attempting to read sessions
4. Sorts projects by `lastAccessed` descending, with null values pushed to the end

**Dependencies**:
- `GlobalData` class from `./globalData`
- `Paths` class from `./paths`
- Node.js `fs.existsSync`
