/**
 * Markdown rendering, loaded on demand.
 *
 * `marked` + `dompurify` are ~100 kB and are needed only once a message with text
 * actually renders. A *static* import of them anywhere reachable from `public-api.ts`
 * puts them in whatever chunk the chat UI lands in — which, for a consumer that embeds
 * `<ng-chat>` in its app shell rather than behind a lazy route, is the initial bundle.
 * So the import lives here, behind `import()`, and nothing in this module touches
 * either library at load time.
 *
 * Both the promise and the resolved renderer are cached on the module, so the second
 * message pays nothing and a component that renders after the load can render markdown
 * on its first pass instead of flashing plain text.
 */
export type MarkdownRenderer = (markdown: string) => string;

let pending: Promise<MarkdownRenderer> | null = null;
let renderer: MarkdownRenderer | null = null;

export function loadMarkdownRenderer(): Promise<MarkdownRenderer> {
  pending ??= (async () => {
    const [{ marked }, dompurify] = await Promise.all([import('marked'), import('dompurify')]);
    const DOMPurify = dompurify.default;

    marked.use({
      gfm: true,   // tables, strikethrough, task lists
      breaks: false,
    });

    // DOMPurify needs a DOM. Without one (SSR, a node test runner) its default export
    // is a degraded object with no `sanitize` at all — so *check*, and fall back to
    // escaping the source rather than emitting HTML nothing sanitized. Silently
    // returning unsanitized markdown output here would be an XSS hole in exactly the
    // environment least likely to be looked at.
    const canSanitize = typeof DOMPurify?.sanitize === 'function';
    if (!canSanitize) {
      console.warn('[ng-chat] DOMPurify unavailable (no DOM) — rendering markdown as plain text.');
    }

    renderer = canSanitize
      ? (markdown: string) => DOMPurify.sanitize(marked.parse(markdown) as string)
      : (markdown: string) => escapeHtml(markdown);
    return renderer;
  })();

  return pending;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The renderer if it has already loaded, otherwise `null`. Never triggers a load. */
export function markdownRendererIfLoaded(): MarkdownRenderer | null {
  return renderer;
}
