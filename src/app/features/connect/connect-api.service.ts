import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  CerebroEnvelope,
  ClusterApiError,
  isSuccessfulEnvelope,
} from '../../core/api-envelope';

export interface ConnectCredentials {
  readonly host: string;
  readonly username?: string;
  readonly password?: string;
}

@Injectable({ providedIn: 'root' })
export class ConnectApiService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  async getHosts(): Promise<readonly string[]> {
    const envelope = await firstValueFrom(
      this.http.get<CerebroEnvelope<readonly string[]>>('connect/hosts'),
    );
    if (envelope.status === 303) {
      this.redirectToLogin();
      return [];
    }
    if (!isSuccessfulEnvelope(envelope)) {
      throw new ClusterApiError(envelope.status, envelope.body);
    }
    return envelope.body;
  }

  async testConnection(
    credentials: ConnectCredentials,
  ): Promise<CerebroEnvelope<unknown>> {
    const envelope = await firstValueFrom(
      this.http.post<CerebroEnvelope<unknown>>('connect', credentials),
    );
    if (envelope.status === 303) {
      this.redirectToLogin();
    }
    return envelope;
  }

  private redirectToLogin(): void {
    this.document.defaultView?.location.assign('./login');
  }
}
