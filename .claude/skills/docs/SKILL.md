---
name: docs
description: >
  Documentation strategy for ng-chat. TRIGGER when: creating or updating documentation, adding
  admin docs page content, or explaining the documentation file organization.
  DO NOT TRIGGER when: user is editing source code that isn't documentation.
---

# Documentation Strategy

**Two audiences** — developer docs live in `.claude/skills/`, user-facing docs live in the Angular admin app.

## File hierarchy

```
.claude/skills/
├── docs/SKILL.md                    ← this file (meta-docs + strategy)
├── chat-streaming/SKILL.md          ← NgChatState/NgChat streaming pattern
├── tool-registry/SKILL.md           ← adding tools to the server
└── context-management/SKILL.md      ← context clipping, /compact, /close, token ring, memory save flow
```

## Angular documentation component

Every project has a documentation page at:
```
client/app/features/admin/documentation/documentation.component.ts
```

Route: `admin/docs` (registered in `client/app/admin.routes.ts`)

**When any documentation changes, update the Angular component too.** The component is the user-facing view; `.claude/skills/` files are the developer reference.

## Mermaid diagrams

Load Mermaid from CDN at runtime — no npm dependency needed.

```typescript
constructor() {
  afterNextRender(() => this.loadMermaid());
}

private loadMermaid(): void {
  if (document.getElementById('mermaid-cdn')) return;
  const s = document.createElement('script');
  s.id = 'mermaid-cdn';
  s.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
  s.onload = () => {
    (window as any).mermaid.initialize({ startOnLoad: false, theme: 'default' });
    (window as any).mermaid.run();
  };
  document.head.appendChild(s);
}
```

Use `<pre class="mermaid">` blocks in the template — Mermaid 10 auto-detects them.

## Writing style

- **Bold lead** + bullets — summary statement then specifics
- Fragments over full sentences
- Code over prose — show exact patterns, not descriptions
- Tables for comparisons and structured data
- No fluff; every line earns its place
