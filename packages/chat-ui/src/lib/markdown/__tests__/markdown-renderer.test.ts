import { describe, expect, it, vi } from 'vitest';
import { loadMarkdownRenderer, markdownRendererIfLoaded } from '../markdown-renderer';

// What this suite can and cannot cover: the runner is `environment: 'node'` (see
// vitest.config.ts note 3), so there is no DOM and DOMPurify's default export has no
// `sanitize`. Markdown *rendering* is therefore not observable here — it needs a DOM,
// which this repo deliberately does not have. What is covered is the contract
// MarkdownComponent depends on, plus the no-DOM path, which is the one that would
// otherwise emit unsanitized HTML.
describe('markdown renderer', () => {
  it('is not loaded until something asks for it', () => {
    expect(markdownRendererIfLoaded()).toBeNull();
  });

  it('caches one instance, and escapes instead of emitting unsanitized HTML with no DOM', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const render = await loadMarkdownRenderer();

    // No DOM here, so the fail-closed branch: the source is escaped, not parsed.
    expect(render('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(render('# hi')).not.toContain('<h1');
    expect(warn).toHaveBeenCalledOnce();

    // One module-level instance from both accessors and from a second load — this is
    // what lets a message rendered after the first one skip the plain-text pass.
    expect(markdownRendererIfLoaded()).toBe(render);
    expect(await loadMarkdownRenderer()).toBe(render);

    warn.mockRestore();
  });
});
