# Default Thinking Level Configuration

## Summary

Add a `thinkingLevel` config option to set the default reasoning effort level when a model supports thinking/reasoning variants.

## Config Type

```typescript
type Config = {
  // ...existing
  thinkingLevel?: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'maxOrXhigh';
}
```

- `low`, `medium`, `high`, `max`, `xhigh`: Use the specified level if supported by model
- `maxOrXhigh`: Prefer `xhigh` if available, otherwise `max` (for maximum reasoning)

## Changes Required

| File | Change |
|------|--------|
| `src/config.ts` | Add `thinkingLevel` to Config type and VALID_CONFIG_KEYS |
| `src/nodeBridge/slices/session.ts` | In `session.initialize`: resolve thinkingLevel from config, validate against model variants, return in response |
| `src/nodeBridge/slices/models.ts` | In `models.list`: resolve thinkingLevel from config (same logic), return in response |
| `src/nodeBridge.types.ts` | Add `thinkingLevel` to SessionInitializeOutput and ModelsListOutput |
| `src/ui/store.ts` | Use `response.data.thinkingLevel` in both `initialize` and `setModel` |

## Implementation

### 1. src/config.ts

Add to Config type:
```typescript
thinkingLevel?: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'maxOrXhigh';
```

Add `'thinkingLevel'` to `VALID_CONFIG_KEYS` array.

### 2. src/nodeBridge/slices/session.ts

In `session.initialize` handler, after resolving model:

```typescript
const configuredLevel = context.config.thinkingLevel;
const variants = model?.model.variants;
let thinkingLevel: string | undefined = undefined;

if (variants && Object.keys(variants).length > 0) {
  const availableEfforts = Object.keys(variants);
  
  let targetLevel: string | undefined = configuredLevel;
  if (configuredLevel === 'maxOrXhigh') {
    targetLevel = availableEfforts.includes('xhigh') ? 'xhigh' : 
                  availableEfforts.includes('max') ? 'max' : undefined;
  }
  
  if (targetLevel && availableEfforts.includes(targetLevel)) {
    thinkingLevel = targetLevel;
  } else {
    thinkingLevel = availableEfforts[0];
  }
}
```

Return `thinkingLevel` in response data.

### 3. src/ui/store.ts

Replace the inline thinking computation:
```typescript
thinking: (() => {
  const variants = response.data.model?.model.variants;
  if (variants && Object.keys(variants).length > 0) {
    return { effort: Object.keys(variants)[0] as any };
  }
  return undefined;
})(),
```

With:
```typescript
thinking: response.data.thinkingLevel 
  ? { effort: response.data.thinkingLevel as any } 
  : undefined,
```

## Usage

```json
// .neovate/config.json
{
  "thinkingLevel": "low"
}
```

```json
// Use maximum reasoning available
{
  "thinkingLevel": "maxOrXhigh"
}
```
