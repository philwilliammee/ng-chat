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
    this.loaded = true;
    this.http.get<ChatConfig>(`${api}/config`).subscribe({
      next: cfg => {
        this.defaultModel.set(cfg.model);
        this.allowedModels.set(cfg.allowedModels ?? [cfg.model]);
      },
    });
  }
}
