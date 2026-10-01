import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { map } from 'rxjs'
import type { ClaimCase, ClaimFilters, PagedClaims, QuoteBasis } from './models'

export type ApproveBody = {
  role: string
  result: string
  comment: string
  /** 页面打开时的报价版本依据快照 */
  basis: QuoteBasis
  /** 原记录号（幂等键），断网重试时保持不变 */
  clientMsgId: string
}

export type AddQuoteBody = {
  itemId: string
  amount: number
  reason: string
  clientMsgId: string
}

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

  addQuote(claimId: string, body: AddQuoteBody) {
    return this.http.post<ClaimCase>(`/api/claims/${claimId}/quotes`, body)
  }

  approve(claimId: string, body: ApproveBody, simulateOffline = false) {
    const options: { headers?: Record<string, string> } = {}
    if (simulateOffline) options.headers = { 'X-Simulate-Fail': '1' }
    return this.http
      .post<ClaimCase>(`/api/claims/${claimId}/approvals`, body, { ...options, observe: 'response' })
      .pipe(map((response) => ({ claim: response.body as ClaimCase, replayed: response.headers.has('X-Replayed') })))
  }
}

