import { afterNextRender, ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-documentation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="docs">

      <h1 class="docs-title">ng-chat Documentation</h1>

      <!-- Architecture -->
      <section class="doc-section">
        <h2>System Architecture</h2>
        <p>
          ng-chat is a monorepo with an Angular SPA client, a Hono HTTP server, and three shared
          TypeScript source packages consumed via path aliases — no separate build step.
        </p>

        <pre class="mermaid">
flowchart LR
  subgraph Browser
    SPA["Angular SPA\n@ng-chat/ui\n@ng-chat/storage"]
    IDB[("IndexedDB\nConversationStore")]
  end
  subgraph HonoServer["Hono Server :4315"]
    Router["createChatRouter\n@ng-chat/server"]
    Tools["ToolRegistry\nuse_skill · get_time\nread_file · search_files · write_file"]
    Skills["skills/\n*.md + memories/"]
  end
  subgraph AI
    SDK["Vercel AI SDK\nstreamText / generateText"]
    Provider["AI Gateway\n(GATEWAY_BASE_URL)"]
  end

  SPA -- "POST /api/chat\nPOST /compact · /close" --> Router
  SPA <--> IDB
  Router --> Tools
  Router --> SDK
  Tools --> Skills
  SDK --> Provider
  Provider -. "SSE token chunks" .-> SDK
  SDK -. "UI Message Stream" .-> SPA
        </pre>

        <h3>Packages</h3>
        <table class="info-table">
          <thead><tr><th>Path</th><th>Package</th><th>Contents</th></tr></thead>
          <tbody>
            <tr>
              <td><code>packages/chat-ui/</code></td>
              <td><code>&#64;ng-chat/ui</code></td>
              <td>ChatComponent, MessageComponent, ToolCallComponent, MessageInputComponent, NgChatState, NgChat</td>
            </tr>
            <tr>
              <td><code>packages/chat-server/</code></td>
              <td><code>&#64;ng-chat/server</code></td>
              <td>createChatRouter, ToolRegistry, built-in tools (use_skill, get_time, read_file, search_files, write_file)</td>
            </tr>
            <tr>
              <td><code>packages/chat-storage/</code></td>
              <td><code>&#64;ng-chat/storage</code></td>
              <td>ChatHistoryService, ChatSidebarComponent, ConversationStore (IndexedDB)</td>
            </tr>
            <tr>
              <td><code>client/</code></td>
              <td>—</td>
              <td>Angular admin app (this app)</td>
            </tr>
            <tr>
              <td><code>server/</code></td>
              <td>—</td>
              <td>Hono entry point — mounts createChatRouter, registers tools</td>
            </tr>
            <tr>
              <td><code>skills/</code></td>
              <td>—</td>
              <td>Skill markdown files; <code>skills/memories/</code> is gitignored (runtime-generated)</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Streaming -->
      <section class="doc-section">
        <h2>Streaming Implementation</h2>
        <p>
          Angular's <code>OnPush</code> change detection only re-renders when a signal input receives
          a new object reference. The AI SDK mutates a single message object in place on every SSE
          chunk, so the default <code>AngularChatState</code> never triggers re-renders mid-stream.
        </p>
        <p>
          <strong>Fix:</strong> <code>NgChatState</code> (<code>packages/chat-ui/src/lib/ng-chat-state.ts</code>)
          shallow-clones the message AND every part on each <code>replaceMessage</code> call,
          guaranteeing a new object reference at both levels.
        </p>

        <pre class="mermaid">
sequenceDiagram
  participant U as User
  participant NC as NgChat
  participant NCS as NgChatState
  participant MC as MessageComponent

  U->>NC: sendMessage(text)
  NC->>NCS: pushMessage(userMsg)
  Note over NC: POST /api/chat — SSE begins
  loop Each SSE chunk
    NC->>NCS: replaceMessage(i, message)
    NCS->>NCS: signal.update([...msgs,&nbsp;&#123;...msg, parts:[...parts.map(p=>&#123;...p&#125;)]&#125;])
    NCS-->>MC: new reference → signal fires
    MC->>MC: OnPush re-render
  end
  NC->>NCS: status = 'ready'
        </pre>

        <h3>Key rule</h3>
        <p>
          Do not replace <code>NgChat</code>/<code>NgChatState</code> with <code>Chat</code> from
          <code>&#64;ai-sdk/angular</code>. The upstream implementation does not clone parts,
          which breaks streaming for both text and tool-call state transitions.
        </p>
      </section>

      <!-- Context Management -->
      <section class="doc-section">
        <h2>Context Management</h2>
        <p>
          <strong>Two complementary strategies</strong> keep conversations within the provider's context window —
          automatic server-side clipping for every request, and on-demand LLM summarization triggered by the user.
        </p>

        <table class="info-table">
          <thead><tr><th>Strategy</th><th>When</th><th>How</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Context clipping</strong></td>
              <td>Every POST /api/chat</td>
              <td>
                <code>clipHistory()</code> drops the oldest user-turn boundaries until the estimated
                token count fits within <code>contextLimit − 8 000</code>.
                Uses <code>gpt-tokenizer</code> (cl100k_base BPE) for accurate counts; adds 1 000 tokens
                per inline image.
              </td>
            </tr>
            <tr>
              <td><strong>Compact</strong></td>
              <td>User clicks compact button (&gt;70% fill)</td>
              <td>
                Client POSTs to <code>POST /api/chat/compact</code>. Server calls <code>generateText</code>
                for a 3–6 sentence neutral summary. Client replaces the full message list with the
                summary turn and resets the token ring.
              </td>
            </tr>
          </tbody>
        </table>

        <h3>Token ring</h3>
        <p>
          A circular SVG progress indicator in the composer status bar shows real-time context fill.
          Token counts come from <code>messageMetadata</code> on the SSE finish event — accurate BPE
          counts, not estimates. Ring colour shifts amber at 75% and red at 90%.
          Compact button appears automatically when fill exceeds 70%.
        </p>

        <h3>Image stripping</h3>
        <p>
          <code>stripInlineFiles()</code> in <code>ChatComponent</code> removes base64 <code>data:</code>
          URL file parts from user messages before they are emitted to the host (and saved to IDB).
          In-session display is unaffected — the live <code>chat.messages</code> signal retains the
          original parts. This prevents large images from being re-sent on every future turn.
        </p>

        <h3>Key config</h3>
        <table class="info-table">
          <thead><tr><th>Env var</th><th>Default</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td><code>CHAT_CONTEXT_LIMIT</code></td><td>200 000</td><td>Window size (tokens); sent to client via GET /config to scale the ring</td></tr>
            <tr><td><code>MAX_TOOL_ROUNDS</code></td><td>8</td><td>Max agentic tool-call steps before the loop stops</td></tr>
          </tbody>
        </table>
      </section>

      <!-- Tool System -->
      <section class="doc-section">
        <h2>Tool System</h2>
        <p>
          Tools are registered on the server via <code>ToolRegistry</code> and passed to
          <code>streamText</code>. The client renders them automatically via <code>ToolCallComponent</code>.
        </p>

        <h3>Tool call lifecycle</h3>
        <pre class="mermaid">
stateDiagram-v2
  direction LR
  [*] --> input_streaming : tool invoked\n(args streaming)
  input_streaming --> input_available : args complete
  input_available --> output_available : execution success
  input_available --> output_error : execution failed
  output_available --> [*]
  output_error --> [*]
        </pre>

        <h3>Adding a new tool</h3>
        <ol>
          <li>
            Create a factory in <code>packages/chat-server/src/tools/</code> that returns a
            <code>CoreTool</code> — use <code>tool(&#123; description, inputSchema, execute &#125;)</code>
            from <code>ai</code>.
          </li>
          <li>
            Register it in <code>server/app.ts</code> via <code>ToolRegistry</code>:
            <div class="code-block" style="margin-top:8px">
              <pre>const tools = new ToolRegistry()
  .register('my_tool', createMyTool());</pre>
            </div>
          </li>
          <li>
            The client renders it automatically via <code>ToolCallComponent</code>; no client changes
            needed unless custom UI is required.
          </li>
        </ol>

        <h3>Built-in tools</h3>
        <table class="info-table">
          <thead><tr><th>Name</th><th>Factory</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>use_skill</code></td><td><code>createUseSkillTool(dir)</code></td><td>Reads a named skill file and returns its content to the model</td></tr>
            <tr><td><code>get_time</code></td><td><code>getTimeTool</code></td><td>Returns current UTC time</td></tr>
            <tr><td><code>read_file</code></td><td><code>createReadFileTool(dir)</code></td><td>Reads a file within <code>CONTENT_DIR</code>; path-traversal protected via <code>realpathSync</code></td></tr>
            <tr><td><code>search_files</code></td><td><code>createSearchFilesTool(dir)</code></td><td>Case-insensitive grep across <code>.md/.txt/.mdx</code>; returns matching lines + 2-line context</td></tr>
            <tr><td><code>write_file</code></td><td><code>createWriteFileTool(dir)</code></td><td>Creates or overwrites a file within <code>CONTENT_DIR</code>; auto-creates parent directories</td></tr>
          </tbody>
        </table>
        <p>
          <code>read_file</code>, <code>search_files</code>, and <code>write_file</code> are all scoped
          to the <code>CONTENT_DIR</code> environment variable (defaults to <code>./skills</code>).
          Paths outside this directory are rejected with an access-denied error.
        </p>
      </section>

      <!-- Memory & Knowledge -->
      <section class="doc-section">
        <h2>Memory &amp; Knowledge</h2>
        <p>
          <strong>File-based persistent memory</strong> — no vector database or embeddings required.
          The model reads and writes plain markdown files via the file tools. Memory persists across
          sessions; it is never committed to git.
        </p>

        <h3>Skills</h3>
        <p>
          Skills are markdown files in <code>skills/</code>. Drop a <code>.md</code> file in that
          directory — no code changes needed. The model calls <code>use_skill</code> to load them on demand.
        </p>
        <table class="info-table">
          <thead><tr><th>File</th><th>Load with</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td><code>skills/memory.md</code></td><td><code>use_skill: memory</code></td><td>Recall — load <code>memories/_index.md</code> then relevant leaf files for past context</td></tr>
            <tr><td><code>skills/close.md</code></td><td><code>use_skill: close</code></td><td>Save — scan conversation, write facts to <code>memories/</code>, update <code>_index.md</code></td></tr>
            <tr><td><code>skills/greeting.md</code></td><td><code>use_skill: greeting</code></td><td>Demo greeting behaviour</td></tr>
          </tbody>
        </table>

        <h3>Memory workflow</h3>
        <pre class="mermaid">
sequenceDiagram
  participant U as User
  participant SB as Sidebar
  participant CP as ChatPage
  participant SRV as POST /close
  participant FS as skills/memories/

  U->>SB: click archive button
  SB->>CP: closeConversation(id)
  CP->>SRV: POST &#123; messages &#125;
  SRV->>SRV: load close.md skill
  SRV->>SRV: build transcript
  loop generateText tool loop
    SRV->>FS: write_file(memories/*.md)
  end
  SRV-->>CP: &#123; filesWritten &#125;
  CP->>U: inject chat notification
        </pre>

        <h3>Memory file structure</h3>
        <p>
          Memory files live in <code>skills/memories/</code> (within <code>CONTENT_DIR</code>).
          Each topic gets its own leaf file; <code>_index.md</code> holds one-line cluster summaries.
          The model navigates via <code>read_file</code> / <code>search_files</code>.
        </p>
        <div class="code-block">
          <pre>skills/memories/
├── _index.md         ← cluster index (maintained by model)
├── user-prefs.md     ← leaf: user preferences
└── project-ctx.md    ← leaf: project context</pre>
        </div>
        <p style="margin-top:8px">
          All files in <code>skills/memories/</code> are gitignored — runtime data, not source.
          The folder is kept in the repo via <code>.gitkeep</code>.
        </p>
      </section>

      <!-- Conversation History -->
      <section class="doc-section">
        <h2>Conversation History</h2>
        <p>
          <strong><code>&#64;ng-chat/storage</code></strong> provides IndexedDB-backed conversation
          persistence. <code>ChatHistoryService</code> manages all state; <code>ChatSidebarComponent</code>
          is purely presentational — it emits events and reads inputs.
        </p>

        <h3>Sidebar features</h3>
        <table class="info-table">
          <thead><tr><th>Feature</th><th>How to trigger</th></tr></thead>
          <tbody>
            <tr><td>New conversation</td><td>Button top-left of sidebar</td></tr>
            <tr><td>Search</td><td>Client-side title filter via search input</td></tr>
            <tr><td>Import</td><td>Upload button — accepts exported <code>.json</code> conversation files</td></tr>
            <tr><td>Archive (save memories)</td><td>Archive icon per conversation (hover to reveal) — calls POST /api/chat/close</td></tr>
            <tr><td>Delete</td><td>Trash icon per conversation (hover to reveal)</td></tr>
            <tr><td>Collapse / expand</td><td>Chevron button top-right</td></tr>
          </tbody>
        </table>

        <h3>Wire-up</h3>
        <div class="code-block">
          <pre>&lt;ng-chat-sidebar
  [conversations]="history.conversations()"
  [activeId]="history.activeId()"
  [closingConversationId]="closingId()"
  (selectConversation)="history.selectConversation($event)"
  (deleteConversation)="history.deleteConversation($event)"
  (closeConversation)="onCloseConversation($event)"
  (importConversation)="history.importConversation($event)"
  (newConversation)="history.newConversation()" /&gt;

&lt;ng-chat
  [messages]="history.activeMessages()"
  [conversationId]="history.activeId() ?? undefined"
  (finish)="history.saveConversation($event)" /&gt;</pre>
        </div>

        <h3>Export / import</h3>
        <p>
          The download button (toolbar, top-right of chat) exports the current conversation as
          <code>chat-YYYY-MM-DD-HH-mm-ss.json</code>. The import button in the sidebar accepts the
          same format — conversation id is preserved or regenerated if missing.
        </p>
      </section>

      <!-- File Upload -->
      <section class="doc-section">
        <h2>File Upload</h2>
        <p>
          The chat composer accepts images, PDFs, and text files alongside the message text.
          Files are encoded client-side and sent inline as base64 <code>FileUIPart</code> objects
          — no separate upload endpoint is needed.
        </p>

        <h3>Entry points</h3>
        <table class="info-table">
          <thead><tr><th>Method</th><th>Behaviour</th></tr></thead>
          <tbody>
            <tr><td>Attach button (📎)</td><td>Opens native file picker; accepts all supported types</td></tr>
            <tr><td>Drag-and-drop</td><td>Drop files onto the composer; border highlights on drag-over</td></tr>
            <tr><td>Paste</td><td>Ctrl/Cmd+V with image data on clipboard (screenshots, copy from browser)</td></tr>
          </tbody>
        </table>

        <h3>Limits &amp; accepted types</h3>
        <table class="info-table">
          <thead><tr><th>Type</th><th>MIME types</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td>Images</td><td><code>image/png</code> <code>image/jpeg</code> <code>image/gif</code> <code>image/webp</code></td><td>Resized client-side to ≤ 1568 px before encoding (Anthropic vision limit)</td></tr>
            <tr><td>PDF</td><td><code>application/pdf</code></td><td>Passed as-is; Anthropic natively supports document blocks</td></tr>
            <tr><td>Text</td><td><code>text/plain</code> <code>text/csv</code> <code>text/markdown</code> <code>text/html</code></td><td>Base64-encoded and sent with MIME type</td></tr>
          </tbody>
        </table>
        <p>Max <strong>5 files</strong> per message · <strong>10 MB</strong> per file. Attach button disables at cap.</p>
        <p>
          <strong>Image stripping:</strong> base64 file parts are removed from user messages before
          IDB persistence (via <code>stripInlineFiles()</code> in <code>onFinish</code>) to prevent
          large files from being re-sent on every subsequent turn. Display in the current session is unaffected.
        </p>
      </section>

      <!-- Markdown Rendering -->
      <section class="doc-section">
        <h2>Markdown Rendering</h2>
        <p>
          Assistant messages are rendered via <code>MarkdownPipe</code>
          (<code>packages/chat-ui/src/lib/pipes/markdown.pipe.ts</code>) using
          <a href="https://marked.js.org" target="_blank" rel="noopener">marked</a> in GFM mode.
        </p>

        <h3>Supported syntax</h3>
        <table class="info-table">
          <thead><tr><th>Feature</th><th>Example</th></tr></thead>
          <tbody>
            <tr><td>Tables</td><td><code>| col | col |</code> with separator row</td></tr>
            <tr><td>Fenced code blocks</td><td><code>&#96;&#96;&#96;lang … &#96;&#96;&#96;</code></td></tr>
            <tr><td>Inline code</td><td><code>&#96;code&#96;</code></td></tr>
            <tr><td>Bold / italic</td><td><code>**bold**</code> / <code>*italic*</code></td></tr>
            <tr><td>Headings</td><td><code># h1</code> through <code>### h3</code></td></tr>
            <tr><td>Unordered lists</td><td><code>- item</code> or <code>* item</code></td></tr>
            <tr><td>Links</td><td><code>[text](url)</code></td></tr>
            <tr><td>Strikethrough</td><td><code>~~text~~</code></td></tr>
            <tr><td>Task lists</td><td><code>- [ ] todo</code> / <code>- [x] done</code></td></tr>
          </tbody>
        </table>
        <p>
          Output is sanitized by <strong>DOMPurify</strong> before being trusted via
          <code>DomSanitizer.bypassSecurityTrustHtml()</code> — XSS-safe for AI model output.
        </p>
      </section>

      <!-- Development -->
      <section class="doc-section">
        <h2>Development</h2>

        <h3>Commands</h3>
        <table class="info-table">
          <thead><tr><th>Command</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>npm run dev</code></td><td>Angular :4200 + Hono :4315 with hot reload; <code>/api/*</code> proxied via <code>proxy.conf.json</code></td></tr>
            <tr><td><code>npm run check</code></td><td>Type-check server TS + full Angular production build</td></tr>
            <tr><td><code>npm run build</code></td><td>Production Angular build → <code>dist/client/browser/</code></td></tr>
            <tr><td><code>npm run run:local</code></td><td>Build client then serve via the Hono server</td></tr>
          </tbody>
        </table>

        <h3>Environment variables</h3>
        <p>Copy <code>.env.example</code> to <code>.env</code> and set <code>GATEWAY_API_KEY</code>.</p>
        <table class="info-table">
          <thead><tr><th>Variable</th><th>Default</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td><code>GATEWAY_BASE_URL</code></td><td><code>https://api.openai.com/v1</code></td><td>Any OpenAI-compatible endpoint</td></tr>
            <tr><td><code>GATEWAY_API_KEY</code></td><td>—</td><td>Required — bearer token for the gateway</td></tr>
            <tr><td><code>CHAT_MODEL</code></td><td><code>gpt-4o-mini</code></td><td>Default model id</td></tr>
            <tr><td><code>CHAT_CONTEXT_LIMIT</code></td><td><code>200000</code></td><td>Context window (tokens); scales the client token ring</td></tr>
            <tr><td><code>MAX_TOOL_ROUNDS</code></td><td><code>8</code></td><td>Max agentic tool-call steps per turn</td></tr>
            <tr><td><code>SKILLS_DIR</code></td><td><code>./skills</code></td><td>Directory for use_skill markdown files</td></tr>
            <tr><td><code>CONTENT_DIR</code></td><td><code>./skills</code></td><td>Root for read_file / search_files / write_file (path-traversal boundary)</td></tr>
            <tr><td><code>THINKING_DEFAULT_LEVEL</code></td><td><code>disabled</code></td><td>Server-side thinking fallback: <code>disabled | low | medium | high</code></td></tr>
            <tr><td><code>ALLOWED_MODELS</code></td><td>—</td><td>Comma-separated model allowlist for the in-UI picker; defaults to <code>CHAT_MODEL</code></td></tr>
            <tr><td><code>RATE_LIMIT_MAX</code></td><td><code>60</code></td><td>Max requests per IP per window; set to 0 to disable</td></tr>
            <tr><td><code>RATE_LIMIT_WINDOW_MS</code></td><td><code>60000</code></td><td>Rate limit window in milliseconds</td></tr>
          </tbody>
        </table>
      </section>

    </div>
  `,
  styles: [`
    :host { display: block; }

    .docs {
      max-width: 860px;
      margin: 0 auto;
      padding: 16px;
    }

    .docs-title {
      font-size: 28px;
      margin-bottom: 24px;
      color: var(--color-primary, #2d668e);
      border-bottom: 2px solid var(--color-primary, #2d668e);
      padding-bottom: 8px;
    }

    .doc-section {
      margin-bottom: 40px;
    }

    .doc-section h2 {
      font-size: 20px;
      color: var(--color-primary, #2d668e);
      margin: 0 0 12px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--color-border, #e0e0e0);
    }

    .doc-section h3 {
      font-size: 15px;
      font-weight: 600;
      margin: 16px 0 8px;
    }

    .doc-section p {
      line-height: 1.6;
      margin: 0 0 12px;
    }

    .doc-section ol {
      padding-left: 20px;
      line-height: 1.8;
    }

    code {
      background: #f5f5f5;
      border: 1px solid #e0e0e0;
      border-radius: 3px;
      padding: 1px 5px;
      font-family: 'Courier New', monospace;
      font-size: 0.88em;
    }

    .mermaid {
      background: #fafafa;
      border: 1px solid var(--color-border, #e0e0e0);
      border-radius: 6px;
      padding: 16px;
      margin: 12px 0;
      overflow-x: auto;
      text-align: center;
    }

    .code-block {
      background: #1e1e1e;
      border-radius: 6px;
      padding: 12px 16px;
      margin: 8px 0 12px;
    }

    .code-block pre {
      color: #d4d4d4;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      margin: 0;
    }

    .info-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .info-table th {
      background: var(--color-primary, #2d668e);
      color: #fff;
      padding: 8px 12px;
      text-align: left;
      font-weight: 600;
    }

    .info-table td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--color-border, #e0e0e0);
      vertical-align: top;
    }

    .info-table tr:last-child td {
      border-bottom: none;
    }

    .info-table tr:nth-child(even) td {
      background: #f9f9f9;
    }
  `],
})
export class DocumentationComponent {
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
}
