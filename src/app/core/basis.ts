import type { ClaimCase, QuoteChange } from './models'

const amount = new Intl.NumberFormat('zh-CN')

export function latestQuoteChange(claim: ClaimCase): QuoteChange | undefined {
  return claim.quoteChanges?.at(-1)
}

/** 被当前依据版本的报价变化失效、仍待重新复核的会签角色 */
export function invalidatedRoles(claim: ClaimCase): string[] {
  return claim.approvals
    .filter((step) => step.status === '待处理' && step.history?.some((entry) => entry.invalidatedByRevision === claim.quoteRevision))
    .map((step) => step.role)
}

/** 曾因任意报价变化失效、至今未按新依据重签的会签角色 */
export function pendingReReviewRoles(claim: ClaimCase): string[] {
  return claim.approvals.filter((step) => step.status === '待处理' && (step.history?.length ?? 0) > 0).map((step) => step.role)
}

/** 案件总览、会签页、审计时间线共用的同一段待复核依据描述 */
export function basisNoticeText(claim: ClaimCase): string {
  const change = latestQuoteChange(claim)
  if (!change) return `当前待复核依据：初始报价 V${claim.quoteRevision}，暂无报价变化。`
  const base = `报价 V${change.revision}（${change.category} ${amount.format(change.fromAmount)} → ${amount.format(change.toAmount)} 元，${change.operator}）`
  const roles = invalidatedRoles(claim)
  if (roles.length) return `${base}使「${roles.join('、')}」会签失效，需按新依据重新复核。`
  const pending = pendingReReviewRoles(claim)
  if (pending.length) return `${base}为当前待复核依据；「${pending.join('、')}」此前会签已失效，仍待按新依据复核。`
  return `${base}为当前待复核依据。`
}

export function describeChange(change: QuoteChange): string {
  return `${change.category} V${change.fromVersion} → V${change.toVersion}，${amount.format(change.fromAmount)} → ${amount.format(change.toAmount)} 元（${change.operator}：${change.reason}）`
}
