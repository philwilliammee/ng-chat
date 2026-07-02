---
name: tool-registry
description: >
  How to add AI tools to the ng-chat server. TRIGGER when: user asks to add a new tool,
  modify an existing tool, or understand the tool execution lifecycle.
  DO NOT TRIGGER when: editing UI components that only render tool results.
---

# Tool Registry

Tools are registered on the Hono server and passed to `streamText`. The client renders them
automatically via `ToolCallComponent` — no client changes needed for a standard tool.

## Adding a new tool — checklist

1. **Create the tool factory** in `packages/chat-server/src/tools/`:

```typescript
// packages/chat-server/src/tools/my-tool.ts
import { tool } from 'ai';
import { z } from 'zod';

export function createMyTool() {
  return tool({
    description: 'What this tool does',
    inputSchema: z.object({
      input: z.string().describe('The input value'),
    }),
    execute: async ({ input }) => {
      return { result: `processed: ${input}` };
    },
  });
}
```

2. **Export from `packages/chat-server/src/index.ts`**:

```typescript
export { createMyTool } from './tools/my-tool.js';
```

3. **Register in `server/app.ts`** via `ToolRegistry`:

```typescript
import { createMyTool } from '@ng-chat/server';

const tools = new ToolRegistry()
  .register('use_skill', await createUseSkillTool({ skillsDir: config.skillsDir }))
  .register('get_time', getTimeTool)
  .register('my_tool', createMyTool());   // ← add here
```

4. **Done.** The client renders tool calls via `ToolCallComponent` showing name, args, and result.

## Tool call lifecycle

States emitted as SSE parts, consumed by `ToolCallComponent`:

| State | Displayed as | Meaning |
|---|---|---|
| `input-streaming` | preparing… | Args are streaming in |
| `input-available` | running… | Args complete, executing |
| `output-available` | done | Execution succeeded |
| `output-error` | failed | Execution threw |

## Built-in tools

| Name | Factory | Scoped to |
|---|---|---|
| `use_skill` | `createUseSkillTool({ skillsDir })` | `SKILLS_DIR` |
| `get_time` | `getTimeTool` | — |
| `read_file` | `createReadFileTool(contentDir)` | `CONTENT_DIR` |
| `search_files` | `createSearchFilesTool(contentDir)` | `CONTENT_DIR` |
| `write_file` | `createWriteFileTool(contentDir)` | `CONTENT_DIR` |

`read_file`, `search_files`, and `write_file` validate paths via `realpathSync` prefix-check —
any path outside `CONTENT_DIR` returns an access-denied error, never a filesystem error.

## Location

```
packages/chat-server/src/tools/     ← tool factories
server/app.ts                        ← registration (ToolRegistry)
packages/chat-ui/src/lib/components/tool-call.component.ts  ← client rendering
```
