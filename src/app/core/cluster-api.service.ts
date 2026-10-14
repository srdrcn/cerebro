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

@Injectable({ providedIn: 'root' })
export class ClusterApiService {
  private readonly http = inject(HttpClient);
  private readonly connection = inject(ConnectionService);
  private readonly alerts = inject(AlertService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  async post<T>(
    path: string,
    data: Record<string, unknown> = {},
  ): Promise<T> {
    const envelope = await this.rawPost<T>(path, data);
    if (isSuccessfulEnvelope(envelope)) {
      return envelope.body;
    }
    throw new ClusterApiError(envelope.status, envelope.body);
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
      await this.router.navigate(['/connect'], {
        queryParams: {
          host: this.connection.host(),
          unauthorized: true,
        },
      });
    }

    return envelope;
  }

  private relativePath(path: string): string {
    return path.replace(/^\/+/, '');
  }
}
