import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Minimal, dependency-free Markdown renderer.
 *
 * Security: the input is HTML-escaped FIRST, then a small, fixed set of inline
 * and block formats is re-introduced. URLs in links/images are restricted to
 * http(s) and root-relative paths. Only then is the result trusted. Swap in
 * `marked` + Shiki later for richer rendering — this keeps Phase 1 zero-dep.
 */
@Pipe({ name: 'ngChatMarkdown' })
export class MarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(value: string | null | undefined): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(render(value ?? ''));
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
  return null;
}

function inline(text: string): string {
  let out = text;
  // inline code
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  // bold then italic
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const u = safeUrl(url);
    return u
      ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label;
  });
  return out;
}

function render(raw: string): string {
  const escaped = escapeHtml(raw);
  const blocks: string[] = [];

  // Extract fenced code blocks first so their contents are never reformatted.
  const withoutFences = escaped.replace(/```([\s\S]*?)```/g, (_m, code) => {
    blocks.push(`<pre><code>${code.replace(/^\n/, '')}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });

  const lines = withoutFences.split('\n');
  const html: string[] = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);

    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet) {
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${inline(bullet[1])}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();

  // Restore code blocks.
  return html
    .join('\n')
    .replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[Number(i)]);
}
