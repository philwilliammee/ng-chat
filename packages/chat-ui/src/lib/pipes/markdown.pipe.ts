import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

marked.use({
  gfm: true,   // tables, strikethrough, task lists
  breaks: false,
});

@Pipe({ name: 'ngChatMarkdown' })
export class MarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(value: string | null | undefined): SafeHtml {
    const html = marked.parse(value ?? '') as string;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
