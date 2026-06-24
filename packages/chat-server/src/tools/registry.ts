import type { Tool } from 'ai';

/**
 * A thin, pluggable registry over AI SDK tools.
 *
 * Tools are plain AI SDK `tool({ description, inputSchema, execute })` values.
 * The agentic loop is handled by the AI SDK (`streamText` + `stopWhen`), so a
 * "tool" here is just a named capability the model may invoke. Extend the chat
 * agent by registering more tools — no protocol or engine changes required.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  /** Register (or replace) a tool by name. Returns `this` for chaining. */
  register(name: string, tool: Tool): this {
    this.tools.set(name, tool);
    return this;
  }

  /** Register many tools at once from a name→tool map. */
  registerAll(tools: Record<string, Tool>): this {
    for (const [name, tool] of Object.entries(tools)) this.register(name, tool);
    return this;
  }

  /** Remove a tool by name. */
  unregister(name: string): this {
    this.tools.delete(name);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** Shape the registry into the `Record<string, Tool>` that `streamText` expects. */
  toAiTools(): Record<string, Tool> {
    return Object.fromEntries(this.tools);
  }
}
