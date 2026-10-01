import { HttpErrorResponse, HttpHeaders, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import { seedClaims } from './seed'
import { basisEquals, currentBasis, diffBasis } from './basis'
import type { ClaimCase } from './models'

let claims: ClaimCase[] = structuredClone(seedClaims)

/** 已生效的请求记录：原记录号 -> 已应用的案件（幂等去重，重试不再追加） */
const processed = new Map<string, ClaimCase>()

const now = () => new Date().toLocaleString('zh-CN')

const ok = (body: unknown, status = 200, replayed = false) =>
  of(
    new HttpResponse({
      status,
      body,
      headers: replayed ? new HttpHeaders({ 'X-Replayed': '1' }) : undefined,
    }),
  ).pipe(delay(160))

const basisLabel = (claim: ClaimCase) =>
  claim.lossItems.map((item) => `${item.category} V${item.repairQuotes.at(-1)?.version ?? 0}`).join('、')

export const mockApiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request)

  if (request.method === 'GET' && request.url === '/api/claims') {
    const query = request.params.get('query')?.toLowerCase() ?? ''
    const status = request.params.get('status') ?? ''
    const risk = request.params.get('risk') ?? ''
    const page = Number(request.params.get('page') ?? 1)
    const pageSize = Number(request.params.get('pageSize') ?? 10)
    const filtered = claims.filter(
      (item) =>
        (!query || `${item.id}${item.insured}${item.policyNo}`.toLowerCase().includes(query)) &&
        (!status || item.status === status) &&
        (!risk || item.riskLevel === risk),
    )
    const start = (page - 1) * pageSize
    return of(new HttpResponse({ status: 200, body: { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize } })).pipe(delay(220))
  }

  if (request.method === 'GET' && request.url.startsWith('/api/claims/')) {
    const id = request.url.split('/').pop()
    const item = claims.find((claim) => claim.id === id)
    return item ? of(new HttpResponse({ status: 200, body: item })).pipe(delay(120)) : throwError(() => new HttpErrorResponse({ status: 404 }))
  }

  if (request.method === 'POST' && request.url.endsWith('/quotes')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { itemId: string; amount: number; reason: string; clientMsgId?: string }
    const claim = claims.find((candidate) => candidate.id === id)
    if (!claim) return throwError(() => new HttpErrorResponse({ status: 404 }))

    // 幂等：同一原记录号重试，直接返回已生效结果，不再追加报价/审计
    if (body.clientMsgId && processed.has(body.clientMsgId)) {
      return ok(structuredClone(processed.get(body.clientMsgId)!), 201, true)
    }

    const item = claim.lossItems.find((loss) => loss.id === body.itemId)
    if (!item) return throwError(() => new HttpErrorResponse({ status: 404 }))

    const fromAmount = item.repairQuotes.at(-1)?.amount ?? 0
    const newVersion = item.repairQuotes.length + 1
    item.repairQuotes.push({
      version: newVersion,
      amount: body.amount,
      reason: body.reason,
      operator: '当前用户',
      createdAt: now(),
    })

    // 报价变化后，已批准但依据不一致的会签步骤立即失效
    const current = currentBasis(claim)
    const invalidated: string[] = []
    for (const step of claim.approvals) {
      if (step.status === '已通过' && step.basis && !basisEquals(step.basis, current)) {
        step.status = '已失效'
        step.invalidatedBy = `V${newVersion}`
        step.invalidatedAt = now()
        invalidated.push(step.role)
      }
    }

    claim.audit.push({
      id: `A-${Date.now()}`,
      at: '刚刚',
      operator: '当前用户',
      action: '报价调整',
      detail:
        `科目「${item.category}」报价由 ${fromAmount.toLocaleString()} 元调整为 ${body.amount.toLocaleString()} 元（V${newVersion}，原因：${body.reason}）。` +
        (invalidated.length
          ? `本次变化使 ${invalidated.join('、')} 的会签依据失效，需按最新报价重新会签。`
          : '后续会签以最新报价版本为依据。'),
    })

    if (body.clientMsgId) processed.set(body.clientMsgId, structuredClone(claim))
    return ok(structuredClone(claim), 201)
  }

  if (request.method === 'POST' && request.url.endsWith('/approvals')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { role: string; result: string; comment: string; basis?: import('./models').QuoteBasis; clientMsgId?: string }
    const claim = claims.find((candidate) => candidate.id === id)
    if (!claim) return throwError(() => new HttpErrorResponse({ status: 404 }))

    // 幂等：同一原记录号重试（含服务端已生效但响应丢失的情况），直接回放已生效结果，不再追加
    if (body.clientMsgId && processed.has(body.clientMsgId)) {
      return ok(structuredClone(processed.get(body.clientMsgId)!), 200, true)
    }

    const step = claim.approvals.find((approval) => approval.role === body.role)
    if (!step) return throwError(() => new HttpErrorResponse({ status: 404 }))

    const current = currentBasis(claim)
    const changes = diffBasis(claim, body.basis)

    // 依据已变化：返回冲突，列出被改动的损失科目，保留审批意见，不覆盖新报价
    if (body.basis && changes.length > 0) {
      step.pendingComment = body.comment
      return of(
        new HttpResponse({
          status: 409,
          body: {
            error: 'basis_changed',
            message: '页面打开后报价依据已变化，审批未提交；被改动科目的新报价未被覆盖，审批意见已保留。',
            changes,
            currentBasis: current,
          },
        }),
      ).pipe(delay(140))
    }

    step.status = body.result === '已通过' ? '已通过' : '已退回'
    step.operator = '当前用户'
    step.comment = body.comment
    step.completedAt = now()
    step.basis = current
    step.pendingComment = undefined
    step.invalidatedBy = undefined
    step.invalidatedAt = undefined

    claim.audit.push({
      id: `A-${Date.now()}`,
      at: '刚刚',
      operator: '当前用户',
      action: body.result === '已通过' ? '会签通过' : '会签退回',
      detail: `${body.role}${body.result}，依据 ${basisLabel(claim)}。意见：${body.comment}`,
    })
    claim.status = body.result === '已通过' ? '审批中' : '退回补件'

    if (body.clientMsgId) processed.set(body.clientMsgId, structuredClone(claim))

    // 模拟断网：服务端已生效但响应丢失，客户端按原记录号重试时走幂等回放
    if (request.headers.has('X-Simulate-Fail')) {
      return throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Network Error' })).pipe(delay(120))
    }
    return ok(structuredClone(claim))
  }

  return next(request)
}
