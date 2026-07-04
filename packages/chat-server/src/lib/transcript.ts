import type { UIMessage } from 'ai';

export function buildTranscript(
  messages: UIMessage[],
  options: { includeTools?: boolean; toolOutputCap?: number } = {},
): string {
  const { includeTools = false, toolOutputCap = 200 } = options;

  return messages
    .map(m => {
      const parts = (m.parts ?? []) as Array<Record<string, unknown>>;

      const textLines = parts
        .filter(p => p['type'] === 'text' && typeof p['text'] === 'string')
        .map(p => p['text'] as string)
        .join(' ');

      const toolLines = includeTools
        ? parts
          .filter(p => {
            const t = p['type'] as string;
            return t === 'tool-invocation' || t === 'dynamic-tool' || t.startsWith('tool-');
          })
          .map(p => {
            const toolName =
              (p['toolName'] as string | undefined) ??
              ((p['toolInvocation'] as Record<string, unknown> | undefined)?.['toolName'] as string | undefined) ??
              String(p['type']);
            const input = p['input'] ?? (p['toolInvocation'] as Record<string, unknown> | undefined)?.['args'];
            const output = p['output'] ?? (p['toolInvocation'] as Record<string, unknown> | undefined)?.['result'];
            const inputStr = input !== undefined ? JSON.stringify(input).slice(0, toolOutputCap) : '';
            const outputStr = output !== undefined ? String(output).slice(0, toolOutputCap) : '';
            return `[tool] ${toolName}(${inputStr}) → ${outputStr}`;
          })
          .join('\n')
        : '';

      const combined = [textLines, toolLines].filter(Boolean).join('\n');
      return combined ? `${m.role}: ${combined}` : null;
    })
    .filter(Boolean)
    .join('\n');
}
