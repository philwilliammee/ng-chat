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
          ng-chat is a monorepo with an Angular SPA client, a Hono HTTP server, and two shared
          TypeScript source packages: <code>@ng-chat/ui</code> (Angular components) and
          <code>@ng-chat/server</code> (Hono router factory + tool registry).
        </p>

        <pre class="mermaid">
flowchart LR
  subgraph Browser
    SPA["Angular SPA\n@ng-chat/ui components"]
  end
  subgraph Dev["Dev (proxy)"]
    Proxy[":4202 → :4315"]
  end
  subgraph HonoServer["Hono Server :4315"]
    Router["createChatRouter\n@ng-chat/server"]
    Tools["ToolRegistry\nuse_skill · get_time"]
  end
  subgraph AI
    SDK["Vercel AI SDK\nstreamText"]
    Provider["AI Gateway\n(GATEWAY_BASE_URL)"]
  end

  SPA -- "POST /api/chat" --> Proxy
  Proxy --> Router
  Router --> Tools
  Router --> SDK
  SDK --> Provider
  Provider -. "SSE token chunks" .-> SDK
  SDK -. "SSE stream" .-> SPA
        </pre>
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
          <strong>Fix:</strong> <code>NgChatState</code> (in <code>packages/chat-ui/src/lib/ng-chat-state.ts</code>)
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

      <!-- Tool System -->
      <section class="doc-section">
        <h2>Tool System</h2>
        <p>
          Tools are registered on the server via <code>ToolRegistry</code> and sent to
          <code>streamText</code>. The client receives tool calls as message parts and renders
          them with <code>ToolCallComponent</code>.
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
            <code>CoreTool</code> (use <code>tool(&#123; description, inputSchema, execute &#125;)</code>
            from <code>ai</code>).
          </li>
          <li>
            Register it in <code>server/app.ts</code> by passing it to <code>createChatRouter</code>'s
            <code>tools</code> option.
          </li>
          <li>
            The client renders it automatically via <code>ToolCallComponent</code>; no client changes
            needed unless custom UI is required.
          </li>
        </ol>

        <h3>use_skill tool</h3>
        <p>
          <code>createUseSkillTool(skillsDir)</code> reads skill files from disk and returns their
          content to the model. The tool name is <code>use_skill</code> and it accepts a
          <code>name</code> parameter. See
          <code>packages/chat-server/src/tools/use-skill.ts</code>.
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

        <h3>Transport</h3>
        <p>
          Files travel as <code>FileUIPart[]</code> in the AI SDK's standard JSON message body —
          no <code>multipart/form-data</code> endpoint required. The server's
          <code>convertToModelMessages()</code> call maps them to provider-level file/image parts
          automatically.
        </p>

        <h3>Rendering in history</h3>
        <p>
          Sent files appear above the message text in the user bubble:
          image files as thumbnails (<code>max 240 × 180 px</code>), PDF and text files as labelled chips.
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
          Output is trusted via <code>DomSanitizer.bypassSecurityTrustHtml()</code>
          — suitable for controlled AI model output.
        </p>
      </section>

      <!-- Development -->
      <section class="doc-section">
        <h2>Development</h2>

        <h3>Start all services</h3>
        <div class="code-block">
          <pre>npm run dev</pre>
        </div>
        <p>
          Starts the Angular dev server on <code>:4200</code> and the Hono server on <code>:4315</code>
          concurrently. Angular proxies <code>/api/*</code> to <code>:4315</code> via
          <code>proxy.conf.json</code>.
        </p>

        <h3>Build for production</h3>
        <div class="code-block">
          <pre>npm run build</pre>
        </div>
        <p>
          Outputs to <code>dist/client/browser/</code>. The Hono server serves this directory via
          <code>serveStatic</code> in production.
        </p>

        <h3>Package structure</h3>
        <table class="info-table">
          <thead>
            <tr><th>Path</th><th>Package</th><th>Contents</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>packages/chat-ui/</code></td>
              <td><code>&#64;ng-chat/ui</code></td>
              <td>ChatComponent, MessageComponent, ToolCallComponent, MessageInputComponent, NgChatState, NgChat</td>
            </tr>
            <tr>
              <td><code>packages/server/</code></td>
              <td><code>&#64;ng-chat/server</code></td>
              <td>createChatRouter, ToolRegistry, built-in tools (use_skill, get_time)</td>
            </tr>
            <tr>
              <td><code>client/</code></td>
              <td>—</td>
              <td>Angular admin app (this app)</td>
            </tr>
            <tr>
              <td><code>server/</code></td>
              <td>—</td>
              <td>Hono entry point, mounts createChatRouter</td>
            </tr>
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
      margin: 4px 0 0;
    }

    .code-label {
      font-size: 11px;
      color: #888;
      margin-top: 8px;
      font-family: 'Courier New', monospace;
    }

    .code-label:first-child {
      margin-top: 0;
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
