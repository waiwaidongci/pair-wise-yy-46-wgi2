import { HttpErrorResponse, HttpHeaders, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import { seedClaims } from './seed'
import type { BasisConflict, ClaimCase } from './models'

let claims = structuredClone(seedClaims)

/** 断网模拟：写操作在服务端生效后响应丢失（客户端收到网络错误），用于验证按原记录号重试不重复追加 */
let offline = false
export function setMockOffline(value: boolean) {
  offline = value
}

const now = () => new Date().toLocaleString('zh-CN')

const replay = (claim: ClaimCase) =>
  of(new HttpResponse({ status: 200, body: claim, headers: new HttpHeaders({ 'X-Idempotent-Replay': 'true' }) })).pipe(delay(120))

/** 已生效的响应因“断网”丢失：状态已落库，但客户端收到 status 0 */
const lostResponse = () => throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Network Error (mock offline)' }))

const alreadyRecorded = (claim: ClaimCase, recordId?: string) => !!recordId && claim.audit.some((event) => event.id === recordId)

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
    const body = request.body as { itemId: string; amount: number; reason: string; recordId?: string; operator?: string }
    const claim = claims.find((entry) => entry.id === id)
    const item = claim?.lossItems.find((loss) => loss.id === body.itemId)
    if (!claim || !item) return throwError(() => new HttpErrorResponse({ status: 404 }))
    if (alreadyRecorded(claim, body.recordId)) return replay(claim)

    const operator = body.operator ?? '当前用户'
    const at = now()
    const from = item.repairQuotes.at(-1)
    const toVersion = item.repairQuotes.length + 1
    item.repairQuotes.push({ version: toVersion, amount: body.amount, reason: body.reason, operator, createdAt: at })

    const revision = claim.quoteRevision + 1
    claim.quoteChanges.push({
      revision,
      itemId: item.id,
      category: item.category,
      fromVersion: from?.version ?? 0,
      toVersion,
      fromAmount: from?.amount ?? 0,
      toAmount: body.amount,
      reason: body.reason,
      operator,
      at,
    })

    // 依据前进后，旧版本上已通过的会签一律失效：决定归档保留，步骤回到待处理
    const invalidatedRoles: string[] = []
    for (const step of claim.approvals) {
      if (step.status === '已通过' && (step.basisRevision ?? 1) < revision) {
        step.history = [
          ...(step.history ?? []),
          {
            status: '已通过',
            operator: step.operator ?? '',
            comment: step.comment ?? '',
            completedAt: step.completedAt ?? '',
            basisRevision: step.basisRevision ?? 1,
            invalidatedByRevision: revision,
          },
        ]
        step.status = '待处理'
        step.operator = undefined
        step.comment = undefined
        step.completedAt = undefined
        step.basisRevision = undefined
        invalidatedRoles.push(step.role)
      }
    }
    claim.quoteRevision = revision
    if (invalidatedRoles.length > 0) claim.status = '待复核'

    claim.audit.push({
      id: body.recordId ?? `A-${Date.now()}`,
      at,
      operator,
      action: '报价调整',
      detail:
        `${item.category} 由 V${from?.version ?? 0} ${from?.amount ?? 0} 元调整为 V${toVersion} ${body.amount} 元；原因：${body.reason}。` +
        (invalidatedRoles.length > 0 ? `本次报价变化（依据 V${revision}）使以下会签步骤失效：${invalidatedRoles.join('、')}，需按新依据重新复核。` : ''),
    })

    if (offline) return lostResponse()
    return of(new HttpResponse({ status: 201, body: claim })).pipe(delay(180))
  }

  if (request.method === 'POST' && request.url.endsWith('/approvals')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { role: string; result: string; comment: string; basisRevision?: number; recordId?: string }
    const claim = claims.find((entry) => entry.id === id)
    if (!claim) return throwError(() => new HttpErrorResponse({ status: 404 }))
    if (alreadyRecorded(claim, body.recordId)) return replay(claim)

    const step = claim.approvals.find((approval) => approval.role === body.role)
    if (!step) return throwError(() => new HttpErrorResponse({ status: 404 }))
    if (step.status !== '待处理') {
      return throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'STEP_ALREADY_DECIDED', message: `「${step.role}」已处理，请勿重复提交。` } }))
    }

    // 审批必须基于页面打开时的报价版本；依据已前进则拒绝，并列出期间变化的损失科目
    if (body.basisRevision !== undefined && body.basisRevision !== claim.quoteRevision) {
      const conflict: BasisConflict = {
        error: 'BASIS_STALE',
        message: `审批依据已由 V${body.basisRevision} 变为 V${claim.quoteRevision}，本次提交未生效，新报价保持不变。`,
        submittedRevision: body.basisRevision,
        currentRevision: claim.quoteRevision,
        changedItems: claim.quoteChanges.filter((change) => change.revision > body.basisRevision!),
      }
      return throwError(() => new HttpErrorResponse({ status: 409, error: conflict })).pipe(delay(120))
    }

    step.status = body.result === '已通过' ? '已通过' : '已退回'
    step.operator = '当前用户'
    step.comment = body.comment
    step.completedAt = now()
    step.basisRevision = claim.quoteRevision
    claim.audit.push({
      id: body.recordId ?? `A-${Date.now()}`,
      at: step.completedAt,
      operator: '当前用户',
      action: `会签${step.status}`,
      detail: `${body.comment}（依据报价版本 V${step.basisRevision}）`,
    })
    claim.status = step.status === '已退回' ? '退回补件' : claim.approvals.every((approval) => approval.status === '已通过') ? '待支付' : '审批中'

    if (offline) return lostResponse()
    return of(new HttpResponse({ status: 200, body: claim })).pipe(delay(180))
  }

  return next(request)
}
