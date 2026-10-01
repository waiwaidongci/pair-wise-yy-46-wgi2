export type ClaimStatus = '查勘中' | '待复核' | '退回补件' | '审批中' | '待支付' | '已结案'

export type Attachment = {
  id: string
  name: string
  category: '现场照片' | '修复报告' | '专家意见' | '保单摘录'
  version: number
  uploadedBy: string
  uploadedAt: string
}

export type LossItem = {
  id: string
  category: string
  description: string
  damage: string
  repairQuotes: Array<{ version: number; amount: number; reason: string; operator: string; createdAt: string }>
  salvage: number
  liability: number
  disputed: boolean
  attachments: Attachment[]
  expertNotes: string[]
}

export type ApprovalStatus = '待处理' | '已通过' | '已退回' | '已失效'

/** 报价版本依据：损失科目 id -> 该科目当前最新报价版本号 */
export type QuoteBasis = Record<string, number>

/** 审批提交时携带的依据快照与当前依据不一致的科目 */
export type BasisChange = {
  itemId: string
  category: string
  description: string
  fromVersion: number
  toVersion: number
  fromAmount: number
  toAmount: number
}

export type ApprovalStep = {
  role: string
  threshold: number
  status: ApprovalStatus
  operator?: string
  comment?: string
  completedAt?: string
  /** 批准时依据的报价版本快照（科目 id -> 版本号） */
  basis?: QuoteBasis
  /** 使本步骤失效的报价版本，如 V3 */
  invalidatedBy?: string
  invalidatedAt?: string
  /** 依据变化产生冲突时保留的审批意见 */
  pendingComment?: string
}

export type AuditEvent = {
  id: string
  at: string
  operator: string
  action: string
  detail: string
}

export type ClaimCase = {
  id: string
  policyNo: string
  insured: string
  lossAddress: string
  accidentDate: string
  reportedAt: string
  adjuster: string
  status: ClaimStatus
  riskLevel: '低' | '中' | '高'
  reserve: number
  paid: number
  deductible: number
  lossItems: LossItem[]
  approvals: ApprovalStep[]
  audit: AuditEvent[]
}

export type ClaimFilters = {
  query: string
  status: string
  risk: string
  page: number
  pageSize: number
}

export type PagedClaims = {
  items: ClaimCase[]
  total: number
  page: number
  pageSize: number
}
