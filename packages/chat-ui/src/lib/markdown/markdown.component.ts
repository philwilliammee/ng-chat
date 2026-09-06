import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { loadMarkdownRenderer, markdownRendererIfLoaded, type MarkdownRenderer } from './markdown-renderer';

/**
 * Renders markdown, sanitized, with the renderer loaded on demand.
 *
 * This replaces the `ngChatMarkdown` pipe. A `PipeTransform` cannot be async, so a pipe
 * has to import `marked` and `dompurify` statically — see `markdown-renderer.ts` for what
 * that costs a consumer that embeds chat eagerly. A component can own a signal and swap
 * plain text for rendered HTML when the chunk arrives.
 *
 * Until then it shows the raw text with `white-space: pre-wrap`, which is what the *user*
 * half of a message bubble shows anyway. In practice the swap is invisible: the chunk is
 * requested when the first `<ng-chat-markdown>` is constructed, and the module-level cache
 * means every later message renders markdown on its first pass.
 */
@Component({
  selector: 'ng-chat-markdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (html(); as safe) {
      <div [innerHTML]="safe"></div>
    } @else {
      <div class="raw">{{ text() }}</div>
    }
  `,
  styles: [`
    :host { display: block; }
    .raw { white-space: pre-wrap; word-break: break-word; }
  `],
})
export class MarkdownComponent {
  readonly text = input<string | null | undefined>('');

  private readonly sanitizer = inject(DomSanitizer);
  private readonly renderer = signal<MarkdownRenderer | null>(markdownRendererIfLoaded());

  protected readonly html = computed<SafeHtml | null>(() => {
    const render = this.renderer();
    if (render === null) return null;
    return this.sanitizer.bypassSecurityTrustHtml(render(this.text() ?? ''));
  });

  constructor() {
    if (this.renderer() === null) {
      void loadMarkdownRenderer().then(render => this.renderer.set(render));
    }
  }
}
