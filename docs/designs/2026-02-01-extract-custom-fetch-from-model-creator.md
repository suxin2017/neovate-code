# Extract customFetch from createModelCreator

**Date:** 2026-02-01

## Context

The `createModelCreator` function in `utils.ts` had tightly coupled fetch logic that included proxy handling, header merging, and `onRequest`/`onResponse` hooks. When providers like `codex`, `github-copilot`, and `qwen` implemented their own `createModel` methods, they lost access to these features - particularly the hook support for request/response logging.

The goal was to extract the custom fetch logic so that all providers (both built-in and custom) could benefit from the same proxy, header, and hook handling.

## Discussion

**Initial approach considered:** Pass `onRequest`/`onResponse` hooks directly to each provider's `createModel`.

**Revised approach:** Instead of passing hooks to providers, create the `customFetch` in `mCreator` (model.ts) and pass the ready-to-use fetch function to providers. This way:
- Hooks are handled uniformly in one place
- Providers receive a fetch that already includes all functionality
- Custom providers can wrap their own logic around the provided fetch

**Key question:** For providers like codex that modify requests (URL rewriting, auth headers), should hooks see the original or modified request?

**Decision:** Hooks should see the modified request (recommended) - codex wraps around customFetch, so the flow is: `codexLogic → customFetch → actual fetch`

## Approach

1. Extract `createCustomFetch` as a standalone utility in `utils.ts`
2. Refactor `createModelCreator` to accept `customFetch` instead of hooks
3. Update `mCreator` in `model.ts` to create the customFetch and pass it to providers
4. Update all OAuth providers (codex, github-copilot, qwen) to use the provided customFetch

## Architecture

### createCustomFetch (utils.ts)

```typescript
export function createCustomFetch(opts: {
  provider: Provider;
  onRequest?: UtilsOnRequestHook;
  onResponse?: UtilsOnResponseHook;
})
```

Handles:
- Proxy detection and creation via `createProxyFetch`
- Header merging (provider headers + options headers)
- `onRequest` hook invocation before fetch
- `onResponse` hook invocation after fetch

### Flow

```
mCreator (model.ts)
  → createCustomFetch(provider, onRequest, onResponse)
  → pass customFetch to provider.createModel or createModelCreator
      → provider uses customFetch (or wraps it with custom logic)
```

### Updated Files

- `src/provider/providers/utils.ts` - Added `createCustomFetch`, refactored `createModelCreator`
- `src/provider/providers/types.ts` - Updated `CreateModel` type signature
- `src/provider/model.ts` - Updated `mCreator` to create and pass customFetch
- `src/provider/providers/codex.ts` - Uses `options.customFetch ?? fetch` as base
- `src/provider/providers/github-copilot.ts` - Uses `options.customFetch`
- `src/provider/providers/qwen.ts` - Uses `options.customFetch`

### Type Considerations

The `customFetch` type uses a simpler function signature rather than `typeof fetch` to avoid issues with Node.js's `preconnect` method on the global fetch. Type casting is used where the AI SDK expects `typeof fetch`.
