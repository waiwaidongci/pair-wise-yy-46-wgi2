import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { map } from 'rxjs'
import type { ClaimCase, ClaimFilters, PagedClaims } from './models'

export type MutationResult = { claim: ClaimCase; replayed: boolean }

@Injectable({ providedIn: 'root' })
export class ClaimsService {
  constructor(private readonly http: HttpClient) {}

  list(filters: ClaimFilters) {
    const params = new HttpParams()
      .set('query', filters.query)
      .set('status', filters.status)
      .set('risk', filters.risk)
      .set('page', filters.page)
      .set('pageSize', filters.pageSize)
    return this.http.get<PagedClaims>('/api/claims', { params })
  }

  get(id: string) {
    return this.http.get<ClaimCase>(`/api/claims/${id}`)
  }

  addQuote(claimId: string, body: { itemId: string; amount: number; reason: string; recordId: string; operator?: string }) {
    return this.http
      .post<ClaimCase>(`/api/claims/${claimId}/quotes`, body, { observe: 'response' })
      .pipe(map((response) => ({ claim: response.body!, replayed: response.headers.get('X-Idempotent-Replay') === 'true' })))
  }

  approve(claimId: string, body: { role: string; result: string; comment: string; basisRevision: number; recordId: string }) {
    return this.http
      .post<ClaimCase>(`/api/claims/${claimId}/approvals`, body, { observe: 'response' })
      .pipe(map((response) => ({ claim: response.body!, replayed: response.headers.get('X-Idempotent-Replay') === 'true' })))
  }
}
