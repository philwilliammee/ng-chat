import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

interface ChatConfig {
  model: string;
  contextLimit: number;
  allowedModels: string[];
  tools: string[];
}

@Injectable({ providedIn: 'root' })
export class ChatConfigService {
  readonly allowedModels = signal<string[]>([]);
  readonly defaultModel = signal('');

  private readonly http = inject(HttpClient);
  private loaded = false;

  load(api = '/api/chat'): void {
    if (this.loaded) return;
    // Latched before the request, not in `next`, so two synchronous callers issue
    // one request between them. Released again on failure — otherwise a single
    // failed bootstrap fetch left the picker empty for the life of the page with
    // no retry and nothing logged.
    this.loaded = true;
    this.http.get<ChatConfig>(`${api}/config`).subscribe({
      next: cfg => {
        this.defaultModel.set(cfg.model);
        this.allowedModels.set(cfg.allowedModels ?? [cfg.model]);
      },
      error: (err: unknown) => {
        this.loaded = false;
        console.error(`[chat-config] could not load ${api}/config`, err);
      },
    });
  }
}
