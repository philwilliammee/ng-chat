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
      // return a plain object — serialised to JSON for the client
      return { result: `processed: ${input}` };
    },
  });
}
```

2. **Register in `server/app.ts`**:

```typescript
import { createMyTool } from '@ng-chat/server';

const router = createChatRouter({
  tools: {
    use_skill: createUseSkillTool(skillsDir),
    get_time: getTimeTool(),
    my_tool: createMyTool(),   // ← add here
  },
});
```

3. **Done.** The client renders tool calls via `ToolCallComponent` showing name, args, and result.

## Tool call lifecycle

States emitted as SSE parts, consumed by `ToolCallComponent`:

| State | Displayed as | Meaning |
|---|---|---|
| `input-streaming` | preparing… | Args are streaming in |
| `input-available` | running… | Args complete, executing |
| `output-available` | done | Execution succeeded |
| `output-error` | failed | Execution threw |

## Built-in tools

| Name | Factory | Description |
|---|---|---|
| `use_skill` | `createUseSkillTool(dir)` | Reads a named skill file and returns its content |
| `get_time` | `getTimeTool()` | Returns current UTC time |

## Location

```
packages/chat-server/src/tools/     ← tool factories
server/app.ts                        ← registration
packages/chat-ui/src/lib/components/tool-call.component.ts  ← client rendering
```
