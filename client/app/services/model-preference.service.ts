import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'ng-chat:model';

@Injectable({ providedIn: 'root' })
export class ModelPreferenceService {
  readonly selected = signal<string | undefined>(readFromStorage());

  setModel(m: string | undefined): void {
    this.selected.set(m);
    try {
      if (m) localStorage.setItem(STORAGE_KEY, m);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

function readFromStorage(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
