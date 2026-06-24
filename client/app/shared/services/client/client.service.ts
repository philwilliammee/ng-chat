import { HttpClient, HttpParams } from '@angular/common/http';
import memoryStorage from './storage/MemoryStorage';
import { Observable, of } from 'rxjs';
import { tap, share, switchMap } from 'rxjs/operators';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type StorageType = 'local' | 'session' | 'memory' | null;

type StorageExtended = Storage | null;

interface StorageOptions {
  storageType?: StorageType;
  ttlMS?: number;
}

@Injectable({
  providedIn: 'root',
})
export class ClientService {
  http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);

  get isBrowserOnly(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  public get<T>(
    url: string,
    options?: { params?: HttpParams },
    storageOptions: StorageOptions = {},
  ): Observable<T> {
    return this.request<T>('GET', url, options, storageOptions);
  }

  /**
   * POST that clears the in-memory cache on success.
   * Use for all mutating requests (create, update, or any POST that changes server state).
   * Clearing the cache ensures subsequent GET calls fetch fresh data rather than serving stale results.
   */
  public post<T>(
    url: string,
    body: any,
    options?: { params?: HttpParams },
  ): Observable<T> {
    return this.http
      .request<T>('POST', url, { body, ...options })
      .pipe(tap(() => this.clearMemoryCache()));
  }

  /**
   * POST that caches the response — same behaviour as a cached GET.
   * Use for read-style POST endpoints that require a request body
   * (e.g. a search endpoint that returns data worth caching).
   */
  public postCache<T>(
    url: string,
    body: any,
    options?: { params?: HttpParams },
    storageOptions: StorageOptions = {},
  ): Observable<T> {
    return this.request<T>('POST', url, { body, ...options }, storageOptions);
  }

  public put<T>(
    url: string,
    body: any,
    options?: { params?: HttpParams },
  ): Observable<T> {
    return this.http
      .request<T>('PUT', url, { body, ...options })
      .pipe(tap(() => this.clearMemoryCache()));
  }

  public delete<T>(
    url: string,
    options?: { params?: HttpParams },
  ): Observable<T> {
    return this.http
      .request<T>('DELETE', url, options)
      .pipe(tap(() => this.clearMemoryCache()));
  }

  private request<T>(
    method: 'GET' | 'POST',
    url: string,
    options?: { params?: HttpParams; body?: any },
    storageOptions: StorageOptions = {},
  ): Observable<T> {
    const { storageType, ttlMS } = storageOptions;
    const storage = this.useStorage(storageType);

    const fromStorage$ = storage
      ? this.getStorageItem(url, options?.params, storage)
      : of(null);

    return fromStorage$.pipe(
      switchMap((cachedResponse) => {
        if (cachedResponse) {
          return of(cachedResponse);
        }

        const response$ = this.http
          .request<T>(method, url, options)
          .pipe(share());

        if (storage && this.isBrowserOnly) {
          return response$.pipe(
            tap((response) =>
              this.setStorageItem(
                url,
                options?.params,
                response,
                storage,
                ttlMS,
                storageType,
              ),
            ),
          );
        }

        return response$;
      }),
    );
  }

  /** Clears only the in-process memory cache (survives until page reload). */
  public clearMemoryCache(): void {
    memoryStorage.clear();
  }

  /** Clears all client-side caches: memory, sessionStorage, and localStorage. */
  public clearStorage(): void {
    localStorage.clear();
    sessionStorage.clear();
    memoryStorage.clear();
  }

  private useStorage(storageType?: StorageType) {
    let storage: StorageExtended = null;
    switch (storageType) {
      case 'local':
        storage = localStorage;
        break;
      case 'session':
        storage = sessionStorage;
        break;
      case 'memory':
        storage = memoryStorage;
        break;
      default:
        storage = null;
    }
    return storage;
  }

  private createCacheKey(url: string, params?: HttpParams): string {
    const paramsString = params ? params.toString() : '';
    const key = url + paramsString;
    return btoa(key).replace(/=/g, ''); // Encode to base64 to ensure it's a valid key and remove padding
  }

  private getStorageItem(
    url: string,
    params?: HttpParams,
    storage?: Storage,
  ): Observable<any | null> {
    const key = this.createCacheKey(url, params);
    const cachedResponse = storage?.getItem(key);
    if (cachedResponse) {
      const cachedResponseObj = JSON.parse(cachedResponse);
      const now = new Date().getTime();
      if (cachedResponseObj.time && cachedResponseObj.time - now > 0) {
        return of(cachedResponseObj.data);
      }
    }
    return of(null);
  }

  private setStorageItem(
    url: string,
    params: HttpParams | undefined,
    response: any,
    storage: Storage,
    ttlInMS = 120000,
    storageType: StorageType = null,
  ): void {
    const key = this.createCacheKey(url, params);
    if (response) {
      const cacheResponse = {
        data: response,
        time: new Date().getTime() + ttlInMS,
      };
      storage.setItem(key, JSON.stringify(cacheResponse));
    }
  }
}
