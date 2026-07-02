import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { FileUIPart } from 'ai';

const ACCEPTED_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown', 'text/html',
];

const MAX_FILES = 5;
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGE_PX = 1568; // Anthropic vision limit

export interface SendPayload {
  text: string;
  files: FileUIPart[];
}

@Component({
  selector: 'ng-chat-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div
      class="composer"
      [class.drag-active]="isDragging()"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)">

      @if (pendingFiles().length > 0) {
        <div class="previews">
          @for (f of pendingFiles(); track $index) {
            <div class="preview-item">
              @if (f.mediaType.startsWith('image/')) {
                <img class="preview-img" [src]="f.url" [alt]="f.filename ?? 'image'" />
              } @else {
                <div class="preview-chip">
                  <mat-icon class="chip-icon">{{ fileIcon(f) }}</mat-icon>
                  <span class="chip-name">{{ f.filename ?? f.mediaType }}</span>
                </div>
              }
              <button
                class="remove-btn"
                mat-icon-button
                [matTooltip]="'Remove ' + (f.filename ?? 'file')"
                (click)="removeFile($index)">
                <mat-icon>close</mat-icon>
              </button>
            </div>
          }
        </div>
      }

      <div class="input-row">
        <button
          mat-icon-button
          class="attach-btn"
          matTooltip="Attach file (images, PDF, text)"
          aria-label="Attach file"
          [disabled]="pendingFiles().length >= maxFiles"
          (click)="fileInput.click()">
          <mat-icon>attach_file</mat-icon>
        </button>
        <input
          #fileInput
          id="ng-chat-file-input"
          type="file"
          [accept]="acceptAttr"
          multiple
          hidden
          (change)="onFileSelected($event)" />

        <textarea
          #box
          class="field"
          rows="1"
          aria-label="Message input"
          [placeholder]="placeholder()"
          [value]="draft()"
          (input)="onInput($event)"
          (keydown)="onKeydown($event)"
          (paste)="onPaste($event)"></textarea>

        @if (busy()) {
          <button mat-fab class="action stop" matTooltip="Stop" aria-label="Stop generation" (click)="stop.emit()">
            <mat-icon>stop</mat-icon>
          </button>
        } @else {
          <button
            mat-fab
            class="action send"
            matTooltip="Send"
            aria-label="Send message"
            [disabled]="!canSend()"
            (click)="submit()">
            <mat-icon>arrow_upward</mat-icon>
          </button>
        }
      </div>
    </div>
    <div class="hint">Enter to send · Shift+Enter for a new line</div>
  `,
  styles: [`
    :host { display: block; }
    .composer {
      border: 1px solid var(--mat-sys-outline-variant, #cac4d0);
      border-radius: 18px;
      background: var(--mat-sys-surface, #fff);
      transition: border-color 0.15s, background 0.15s;
    }
    .composer:focus-within { border-color: var(--mat-sys-primary, #6750a4); }
    .composer.drag-active {
      border-color: var(--mat-sys-primary, #6750a4);
      background: var(--mat-sys-primary-container, #e8def8);
    }
    .previews {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px 12px 4px;
    }
    .preview-item {
      position: relative;
      display: inline-flex;
      align-items: center;
    }
    .preview-img {
      width: 72px;
      height: 72px;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid var(--mat-sys-outline-variant, #cac4d0);
      display: block;
    }
    .preview-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 10px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container, #f3edf7);
      border: 1px solid var(--mat-sys-outline-variant, #cac4d0);
      max-width: 160px;
    }
    .chip-icon { font-size: 16px; height: 16px; width: 16px; flex-shrink: 0; }
    .chip-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .remove-btn {
      position: absolute;
      top: -8px;
      right: -8px;
      width: 20px !important;
      height: 20px !important;
      line-height: 20px;
      padding: 0 !important;
      min-width: unset;
      background: var(--mat-sys-surface-container-high, #ece6f0);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .remove-btn mat-icon { font-size: 14px; height: 14px; width: 14px; }
    .input-row {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      padding: 6px 10px;
    }
    .attach-btn { flex-shrink: 0; color: var(--mat-sys-on-surface-variant, #49454f); }
    .field {
      flex: 1;
      align-self: stretch;
      border: none;
      outline: none;
      resize: none;
      background: transparent;
      font: inherit;
      font-size: 14px;
      line-height: 1.5;
      max-height: 200px;
      overflow-y: auto;
      color: var(--mat-sys-on-surface, #1c1b1f);
      padding: 6px 4px;
    }
    .action { box-shadow: none; flex: 0 0 auto; }
    .action.send { --mdc-fab-container-color: var(--mat-sys-primary, #6750a4); color: var(--mat-sys-on-primary, #fff); }
    .hint { font-size: 11px; opacity: 0.5; text-align: center; margin-top: 6px; }
  `],
})
export class MessageInputComponent {
  readonly placeholder = input('Message the assistant…');
  readonly busy = input(false);

  readonly send = output<SendPayload>();
  readonly stop = output<void>();

  protected readonly draft = signal('');
  protected readonly pendingFiles = signal<FileUIPart[]>([]);
  protected readonly isDragging = signal(false);
  protected readonly maxFiles = MAX_FILES;
  protected readonly acceptAttr = ACCEPTED_TYPES.join(',');

  private readonly box = viewChild.required<ElementRef<HTMLTextAreaElement>>('box');

  protected canSend(): boolean {
    return (!!this.draft().trim() || this.pendingFiles().length > 0) && !this.busy();
  }

  protected onInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.draft.set(el.value);
    this.autoGrow(el);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    }
  }

  protected async onPaste(event: ClipboardEvent): Promise<void> {
    const items = event.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      event.preventDefault();
      await this.addFiles(imageFiles);
    }
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    // Ignore leave events that stay inside the composer (child element transitions)
    const related = event.relatedTarget as Node | null;
    if (related && (event.currentTarget as Element).contains(related)) return;
    this.isDragging.set(false);
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.isDragging.set(false);
    const files = event.dataTransfer?.files;
    if (files?.length) await this.addFiles(Array.from(files));
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) await this.addFiles(Array.from(input.files));
    input.value = '';
  }

  protected removeFile(index: number): void {
    this.pendingFiles.update(files => files.filter((_, i) => i !== index));
  }

  protected fileIcon(f: FileUIPart): string {
    return f.mediaType === 'application/pdf' ? 'picture_as_pdf' : 'description';
  }

  protected submit(): void {
    const text = this.draft().trim();
    const files = this.pendingFiles();
    if (!text && files.length === 0) return;
    if (this.busy()) return;
    this.send.emit({ text, files });
    this.draft.set('');
    this.pendingFiles.set([]);
    const el = this.box().nativeElement;
    el.value = '';
    this.autoGrow(el);
  }

  private async addFiles(files: File[]): Promise<void> {
    const remaining = MAX_FILES - this.pendingFiles().length;
    if (remaining <= 0) return;
    const candidates = files
      .filter(f => ACCEPTED_TYPES.includes(f.type))
      .filter(f => f.size <= MAX_SIZE_BYTES)
      .slice(0, remaining);
    const parts = await Promise.all(candidates.map(f => fileToUIPart(f)));
    const valid = parts.filter((p): p is FileUIPart => p !== null);
    if (valid.length > 0) {
      this.pendingFiles.update(prev => [...prev, ...valid]);
    }
  }

  private autoGrow(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.minHeight = 'auto';
    el.style.minHeight = `${Math.min(el.scrollHeight, 200)}px`;
  }
}

async function fileToUIPart(file: File): Promise<FileUIPart | null> {
  try {
    const url = file.type.startsWith('image/')
      ? await resizeImageIfNeeded(file, MAX_IMAGE_PX)
      : await readAsDataUrl(file);
    return { type: 'file', mediaType: file.type, url, filename: file.name };
  } catch {
    return null;
  }
}

function resizeImageIfNeeded(file: File, maxPx: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w <= maxPx && h <= maxPx) {
        readAsDataUrl(file).then(resolve, reject);
        return;
      }
      const ratio = Math.min(maxPx / w, maxPx / h);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      resolve(canvas.toDataURL(outType, 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('load failed')); };
    img.src = objectUrl;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
