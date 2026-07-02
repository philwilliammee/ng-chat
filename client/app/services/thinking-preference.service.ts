import { Injectable, signal } from '@angular/core';

export type ThinkingLevel = 'disabled' | 'low' | 'medium' | 'high';

const STORAGE_KEY = 'ng-chat:thinkingLevel';
const DEFAULT_LEVEL: ThinkingLevel = 'disabled';

function readFromStorage(): ThinkingLevel {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'disabled' || v === 'low' || v === 'medium' || v === 'high') return v;
  } catch {
    // localStorage unavailable (SSR, sandboxed)
  }
  return DEFAULT_LEVEL;
}

@Injectable({ providedIn: 'root' })
export class ThinkingPreferenceService {
  readonly level = signal<ThinkingLevel>(readFromStorage());

  setLevel(l: ThinkingLevel): void {
    this.level.set(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }
}
