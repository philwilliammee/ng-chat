import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.use({
  gfm: true,   // tables, strikethrough, task lists
  breaks: false,
});

/**
 * @deprecated Use `<ng-chat-markdown [text]="…" />` (`MarkdownComponent`) instead.
 *
 * A `PipeTransform` cannot be async, so this pipe has to import `marked` and `dompurify`
 * **statically** — importing it pulls ~70 kB into whichever chunk your component lands in,
 * and for a component in an app shell that is the initial bundle. `MarkdownComponent` loads
 * the same renderer through `import()` instead. Kept exported so this is not a breaking
 * change; nothing in this package uses it any more.
 */
@Pipe({ name: 'ngChatMarkdown' })
export class MarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(value: string | null | undefined): SafeHtml {
    const raw = marked.parse(value ?? '') as string;
    const clean = DOMPurify.sanitize(raw);
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }
}
