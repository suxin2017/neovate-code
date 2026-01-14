# runNeovate Custom Fetch Option

**Date:** 2026-01-14

## Context

Users of the `runNeovate` SDK need to customize the fetch behavior in `createFetchTool` to support internal URLs with authentication. The current implementation uses the global `fetch` function directly, which doesn't allow for custom headers, proxy configuration, or authentication tokens.

Primary use case: Fetching internal URLs that require authentication headers (e.g., Bearer tokens, API keys).

## Discussion

Three approaches were considered:

### Approach A: Custom fetch function in opts (Selected)
Pass a custom fetch function through `runNeovate` opts that flows through Context to tools.

**Pros:**
- Simple, explicit API
- Full control over fetch behavior
- Can customize per-URL logic

**Cons:**
- Requires threading through multiple layers

### Approach B: Plugin hook `modifyFetch`
Add a plugin hook that modifies fetch options before each request.

**Pros:**
- Consistent with existing plugin system
- Composable - multiple plugins can modify

**Cons:**
- More complex than direct option

### Approach C: `fetchRequestInit` option
Simple RequestInit object merged with each fetch call.

**Pros:**
- Simplest implementation

**Cons:**
- Less flexible - can't customize per-URL or replace fetch entirely

**Decision:** Approach A was selected for its simplicity and full control over fetch behavior.

## Approach

Add an optional `fetch` parameter to `runNeovate` opts that accepts a custom fetch function. This function flows through the context system to the fetch tool, where it's used instead of the global `fetch`.

**Type signature:**
```typescript
type FetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;

runNeovate({
  fetch?: FetchFn;
  // ...existing opts
});
```

**Fallback behavior:** If no custom fetch is provided, `globalThis.fetch` is used (current behavior, no breaking change).

## Architecture

### Data Flow

```
runNeovate({ fetch: customFetch })
       ↓
  contextCreateOpts.fetch
       ↓
  Context.fetch (new property)
       ↓
  createFetchTool({ fetch: context.fetch ?? globalThis.fetch })
       ↓
  const response = await opts.fetch(url)
```

### Files to Modify

| File | Change |
|------|--------|
| `src/index.ts` | Add `fetch?` to runNeovate opts type, pass to contextCreateOpts |
| `src/context.ts` | Add `fetch?` to ContextOpts and ContextCreateOpts, store on Context class |
| `src/tools/fetch.ts` | Accept `fetch` in opts, replace `await fetch(url)` with `await (opts.fetch ?? globalThis.fetch)(url)` |
| createFetchTool call site | Pass `context.fetch` to createFetchTool |

### Usage Example

```typescript
import { runNeovate } from '@neovate/code';

runNeovate({
  productName: 'myapp',
  version: '1.0.0',
  plugins: [],
  argv,
  fetch: async (url) => {
    return fetch(url, {
      headers: { Authorization: `Bearer ${process.env.API_TOKEN}` }
    });
  },
});
```
