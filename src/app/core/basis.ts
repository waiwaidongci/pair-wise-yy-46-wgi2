import type { BasisChange, ClaimCase, QuoteBasis } from './models'

/** 取案件当前的报价版本依据：每个损失科目的最新报价版本号 */
export function currentBasis(claim: ClaimCase): QuoteBasis {
  const basis: QuoteBasis = {}
  for (const item of claim.lossItems) {
    basis[item.id] = item.repairQuotes.at(-1)?.version ?? 0
  }
  return basis
}

/** 比较两份依据，返回版本号发生变化的科目（含金额前后差异） */
export function diffBasis(claim: ClaimCase, basis: QuoteBasis | undefined | null): BasisChange[] {
  const changes: BasisChange[] = []
  for (const item of claim.lossItems) {
    const current = item.repairQuotes.at(-1)
    const toVersion = current?.version ?? 0
    const fromVersion = basis?.[item.id] ?? 0
    if (fromVersion !== toVersion) {
      const fromAmount = item.repairQuotes.find((quote) => quote.version === fromVersion)?.amount ?? 0
      changes.push({
        itemId: item.id,
        category: item.category,
        description: item.description,
        fromVersion,
        toVersion,
        fromAmount,
        toAmount: current?.amount ?? 0,
      })
    }
  }
  return changes
}

/** 判断两份依据是否完全一致 */
export function basisEquals(a: QuoteBasis | undefined | null, b: QuoteBasis | undefined | null): boolean {
  if (!a || !b) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if ((a[key] ?? 0) !== (b[key] ?? 0)) return false
  }
  return true
}

/** 生成审批/报价请求的原记录号（幂等键） */
export function newRecordId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `MSG-${rand}`
}
