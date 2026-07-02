import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import type { Conversation } from './types';

/**
 * Optional sidebar component that renders a conversation list.
 * Purely presentational — all state lives in ChatHistoryService.
 *
 * Usage:
 *   <ng-chat-sidebar
 *     [conversations]="history.conversations()"
 *     [activeId]="history.activeId()"
 *     [collapsed]="sidebarCollapsed()"
 *     (newConversation)="history.newConversation()"
 *     (selectConversation)="history.selectConversation($event)"
 *     (deleteConversation)="history.deleteConversation($event)"
 *     (toggleCollapse)="sidebarCollapsed.update(v => !v)" />
 */
@Component({
  selector: 'ng-chat-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatIconModule],
  template: `
    <div class="sidebar" [class.collapsed]="collapsed()">

      <!-- Header: new-chat + import + collapse toggle -->
      <div class="sidebar-header">
        @if (!collapsed()) {
          <button class="new-btn" (click)="newConversation.emit()">
            <mat-icon>add</mat-icon>
            <span>New chat</span>
          </button>
          <button class="icon-btn" aria-label="Import conversation" title="Import conversation JSON"
            (click)="importFileRef().nativeElement.click()">
            <mat-icon>upload</mat-icon>
          </button>
        }
        <button
          class="icon-btn toggle-btn"
          (click)="toggleCollapse.emit()"
          [attr.aria-label]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'">
          <mat-icon>{{ collapsed() ? 'chevron_right' : 'chevron_left' }}</mat-icon>
        </button>
      </div>

      <!-- Hidden file input for import -->
      <input #importFileInput type="file" accept=".json" style="display:none" (change)="onImportFile($event)" />

      <!-- Collapsed: icon strip -->
      @if (collapsed()) {
        <div class="icon-strip">
          <button class="icon-btn" aria-label="New chat" title="New chat" (click)="newConversation.emit()">
            <mat-icon>add</mat-icon>
          </button>
        </div>
      } @else {
        <!-- Search -->
        <div class="search-wrap">
          <mat-icon class="search-icon">search</mat-icon>
          <input
            class="search-input"
            type="search"
            placeholder="Search conversations…"
            [value]="searchQuery()"
            (input)="searchQuery.set($any($event.target).value)" />
        </div>

        <!-- Expanded: conversation list -->
        <div class="sidebar-list" role="list">
          @for (conv of filteredConversations(); track conv.id) {
            <div
              class="conv-item"
              role="listitem"
              [class.active]="conv.id === activeId()"
              (click)="selectConversation.emit(conv.id)"
              [attr.aria-current]="conv.id === activeId() ? 'true' : null">
              <div class="conv-body">
                <span class="conv-title">{{ conv.title }}</span>
                <span class="conv-date">{{ conv.updatedAt | date: 'shortDate' }}</span>
              </div>
              @if (conv.messages.length > 0) {
                <button
                  class="conv-close icon-btn"
                  [attr.aria-label]="closingConversationId() === conv.id ? 'Saving memories…' : 'Save memories and close'"
                  [title]="closingConversationId() === conv.id ? 'Saving memories…' : 'Save memories'"
                  [disabled]="closingConversationId() === conv.id"
                  (click)="$event.stopPropagation(); closeConversation.emit(conv.id)">
                  <mat-icon>{{ closingConversationId() === conv.id ? 'hourglass_empty' : 'archive' }}</mat-icon>
                </button>
              }
              <button
                class="conv-delete icon-btn"
                aria-label="Delete conversation"
                (click)="$event.stopPropagation(); deleteConversation.emit(conv.id)">
                <mat-icon>delete_outline</mat-icon>
              </button>
            </div>
          } @empty {
            <p class="empty-hint">{{ searchQuery() ? 'No matches.' : 'No conversations yet.' }}</p>
          }
        </div>
      }

    </div>
  `,
  styles: [`
    .sidebar {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      background: var(--mat-sys-surface-container, #f3eff4);
    }

    /* ── Header ── */
    .sidebar-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant, #cac4d0);
      flex-shrink: 0;
    }
    .sidebar.collapsed .sidebar-header { justify-content: center; }

    /* ── Shared icon button ── */
    .icon-btn {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
      border-radius: 50%;
      color: var(--mat-sys-on-surface-variant, #49454f);
    }
    .icon-btn mat-icon { font-size: 20px; height: 20px; width: 20px; }
    .icon-btn:hover { background: var(--mat-sys-surface-container-high, #ece6f0); }

    /* ── New chat pill button ── */
    .new-btn {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px 7px 10px;
      border: none;
      border-radius: 20px;
      background: var(--mat-sys-primary-container, #eaddff);
      color: var(--mat-sys-on-primary-container, #21005d);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .new-btn mat-icon { font-size: 18px; height: 18px; width: 18px; flex-shrink: 0; }
    .new-btn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .new-btn:hover { filter: brightness(0.95); }

    /* ── Collapsed icon strip ── */
    .icon-strip {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 0;
      gap: 4px;
    }
    .icon-strip .icon-btn { width: 36px; height: 36px; }
    .icon-strip .icon-btn mat-icon { font-size: 22px; height: 22px; width: 22px; }

    /* ── Search ── */
    .search-wrap {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--mat-sys-outline-variant, #cac4d0);
      flex-shrink: 0;
    }
    .search-icon { font-size: 16px; height: 16px; width: 16px; opacity: 0.5; flex-shrink: 0; }
    .search-input {
      flex: 1; border: none; background: none; outline: none;
      font-size: 13px; color: var(--mat-sys-on-surface, #1c1b1f);
    }
    .search-input::placeholder { color: var(--mat-sys-on-surface-variant, #49454f); opacity: 0.6; }

    /* ── Conversation list ── */
    .sidebar-list { flex: 1; overflow-y: auto; padding: 6px 0; }

    .conv-item {
      display: flex;
      align-items: center;
      padding: 9px 6px 9px 14px;
      cursor: pointer;
      gap: 2px;
      border-left: 3px solid transparent;
      min-width: 0;
    }
    .conv-item:hover { background: var(--mat-sys-surface-container-high, #ece6f0); }
    .conv-item.active {
      background: var(--mat-sys-secondary-container, #e8def8);
      border-left-color: var(--mat-sys-primary, #6750a4);
    }

    .conv-body { flex: 1; min-width: 0; overflow: hidden; }
    .conv-title {
      display: block;
      font-size: 13px;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--mat-sys-on-surface, #1c1b1f);
    }
    .conv-date {
      display: block;
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant, #49454f);
      margin-top: 1px;
    }

    .conv-close, .conv-delete {
      opacity: 0;
      transition: opacity 0.12s;
    }
    .conv-close mat-icon, .conv-delete mat-icon { font-size: 16px; height: 16px; width: 16px; }
    .conv-item:hover .conv-close,
    .conv-item:hover .conv-delete { opacity: 0.7; }
    .conv-close:hover {
      opacity: 1 !important;
      background: var(--mat-sys-secondary-container, #e8def8);
      color: var(--mat-sys-on-secondary-container, #1d192b);
    }
    .conv-close:disabled { opacity: 0.5 !important; cursor: default; }
    .conv-delete:hover {
      opacity: 1 !important;
      background: var(--mat-sys-error-container, #f9dedc);
      color: var(--mat-sys-on-error-container, #410e0b);
    }

    .empty-hint {
      padding: 20px 14px;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant, #49454f);
      text-align: center;
    }
  `],
})
export class ChatSidebarComponent {
  readonly conversations = input.required<Conversation[]>();
  readonly activeId = input<string | null>(null);
  readonly collapsed = input(false);

  readonly newConversation = output<void>();
  readonly selectConversation = output<string>();
  readonly deleteConversation = output<string>();
  readonly closeConversation = output<string>();
  readonly toggleCollapse = output<void>();
  readonly importConversation = output<Conversation>();
  /** Id of the conversation currently being closed (shows spinner on that item). */
  readonly closingConversationId = input<string | null>(null);

  protected readonly searchQuery = signal('');
  protected readonly importFileRef = viewChild.required<ElementRef<HTMLInputElement>>('importFileInput');

  protected readonly filteredConversations = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.conversations();
    return this.conversations().filter(c => c.title.toLowerCase().includes(q));
  });

  protected onImportFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as Conversation;
        if (data && Array.isArray(data.messages)) {
          this.importConversation.emit({ ...data, id: data.id ?? crypto.randomUUID() });
        }
      } catch { /* ignore invalid JSON */ }
      (event.target as HTMLInputElement).value = '';
    };
    reader.readAsText(file);
  }
}
