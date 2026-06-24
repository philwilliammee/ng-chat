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
            Create a factory in <code>packages/server/src/lib/tools/</code> that returns a
            <code>CoreTool</code> (use <code>tool(&#123; description, parameters, execute &#125;)</code>
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
          <code>createUseSkillTool(skillsDir)</code> reads skill files from disk and executes them
          via a sub-agent call. The tool name is <code>use_skill</code> and it accepts a
          <code>skill_name</code> parameter. See
          <code>packages/server/src/lib/tools/use-skill.tool.ts</code>.
        </p>
      </section>

      <!-- Development -->
      <section class="doc-section">
        <h2>Development</h2>

        <h3>Start all services</h3>
        <div class="code-block">
          <div class="code-label">Terminal 1 — Hono server</div>
          <pre>npm run server</pre>
          <div class="code-label">Terminal 2 — Angular dev server</div>
          <pre>npm start</pre>
        </div>
        <p>
          The Angular dev server runs on <code>:4202</code> and proxies
          <code>/api/*</code> to the Hono server on <code>:4315</code> via
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
