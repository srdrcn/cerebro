import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AlertService, markErrorReported } from './alert.service';
import {
  CerebroEnvelope,
  ClusterApiError,
  isSuccessfulEnvelope,
} from './api-envelope';
import { ConnectionService } from './connection.service';

/** A Play endpoint call that Elasticsearch accepted. */
export interface CompletedRequest {
  readonly path: string;
  readonly data: Readonly<Record<string, unknown>>;
}

@Injectable({ providedIn: 'root' })
export class ClusterApiService {
  private readonly http = inject(HttpClient);
  private readonly connection = inject(ConnectionService);
  private readonly alerts = inject(AlertService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly successListeners = new Set<(request: CompletedRequest) => void>();
  /** True while the 401 redirect to Connect is in flight (one for concurrent 401s). */
  private redirectingToSignIn = false;

  async post<T>(
    path: string,
    data: Record<string, unknown> = {},
  ): Promise<T> {
    const envelope = await this.rawPost<T>(path, data);
    if (isSuccessfulEnvelope(envelope)) {
      this.notifySuccess(path, data);
      return envelope.body;
    }
    const error = new ClusterApiError(envelope.status, envelope.body);
    if (envelope.status === 401) {
      // The sign-in form explains it; the page's error toast would outlive it.
      markErrorReported(error);
    }
    throw error;
  }

  /**
   * Calls `listener` after every successful `post()`, before the caller sees
   * the result (used to tell the user's own changes from external ones).
   * Returns the function that removes the listener.
   */
  onSuccess(listener: (request: CompletedRequest) => void): () => void {
    this.successListeners.add(listener);
    return () => this.successListeners.delete(listener);
  }

  private notifySuccess(path: string, data: Record<string, unknown>): void {
    const request: CompletedRequest = { path: this.relativePath(path), data };
    for (const listener of this.successListeners) {
      try {
        listener(request);
      } catch {
        // Listeners are best-effort and must not fail the request.
      }
    }
  }

  async rawPost<T>(
    path: string,
    data: Record<string, unknown> = {},
  ): Promise<CerebroEnvelope<T>> {
    const connection = this.connection.snapshot();
    const requestBody: Record<string, unknown> = { ...data, ...connection };

    let envelope: CerebroEnvelope<T>;
    try {
      envelope = await firstValueFrom(
        this.http.post<CerebroEnvelope<T>>(this.relativePath(path), requestBody),
      );
    } catch (error: unknown) {
      const details =
        error instanceof HttpErrorResponse
          ? (error.error ?? error.message)
          : error;
      this.alerts.error('Error connecting to the server', details);
      // Callers may still pass this error to AlertService.error(); it will
      // not raise a second toast for the same failure.
      markErrorReported(error);
      throw error;
    }

    if (envelope.status === 303) {
      this.document.defaultView?.location.assign('./login');
    } else if (envelope.status === 401) {
      await this.redirectToSignIn();
    }

    return envelope;
  }

  /**
   * Sends the user to the sign-in form of Connect, remembering the page they
   * were on (`returnUrl`) so signing in brings them back. The redirect
   * replaces the history entry (Back must not lead to the page that fails
   * again), happens once for the 401s of concurrent requests, and never
   * from Connect itself (its own requests and the health polling answer 401
   * while the user signs in).
   */
  private async redirectToSignIn(): Promise<void> {
    const target = this.currentTarget();
    if (this.redirectingToSignIn || isConnectUrl(target)) {
      return;
    }
    this.redirectingToSignIn = true;
    try {
      await this.router.navigate(['/connect'], {
        queryParams: {
          host: this.connection.host(),
          unauthorized: true,
          returnUrl: target && target !== '/' ? target : null,
        },
        replaceUrl: true,
      });
    } finally {
      this.redirectingToSignIn = false;
    }
  }

  /** The URL being navigated to (a deep link still loading), else the current one. */
  private currentTarget(): string {
    const navigation = this.router.currentNavigation?.();
    const pending = navigation?.finalUrl ?? navigation?.extractedUrl;
    return pending ? this.router.serializeUrl(pending) : this.router.url;
  }

  private relativePath(path: string): string {
    return path.replace(/^\/+/, '');
  }
}

function isConnectUrl(url: string): boolean {
  return /^\/connect(?:[/?#;]|$)/.test(url);
}
