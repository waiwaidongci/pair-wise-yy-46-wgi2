import { Injectable } from '@angular/core'
import { BehaviorSubject } from 'rxjs'
import type { ApproveBody } from './claims.service'

export type PendingOp = {
  /** 原记录号（幂等键），重试时保持不变 */
  id: string
  claimId: string
  body: ApproveBody
  /** 页面打开时的报价版本依据快照（用于冲突提示） */
  basisLabel: string
  createdAt: number
  attempts: number
  /** pending=待联网重试；conflict=依据已变化需人工处理；done=已生效 */
  status: 'pending' | 'conflict' | 'done'
  lastError?: string
}

const STORAGE_KEY = 'property-claims-outbox-v1'

function load(): PendingOp[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

@Injectable({ providedIn: 'root' })
export class OutboxService {
  private ops: PendingOp[] = load()
  private readonly changes$ = new BehaviorSubject<PendingOp[]>(this.ops)

  get pending$() {
    return this.changes$.asObservable()
  }

  get pendingCount() {
    return this.ops.filter((op) => op.status === 'pending').length
  }

  all() {
    return [...this.ops]
  }

  add(op: PendingOp) {
    if (!this.ops.some((existing) => existing.id === op.id)) {
      this.ops.push(op)
      this.persist()
    }
  }

  update(id: string, patch: Partial<PendingOp>) {
    const target = this.ops.find((op) => op.id === id)
    if (target) {
      Object.assign(target, patch)
      this.persist()
    }
  }

  remove(id: string) {
    this.ops = this.ops.filter((op) => op.id !== id)
    this.persist()
  }

  get(id: string) {
    return this.ops.find((op) => op.id === id)
  }

  private persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ops))
    this.changes$.next([...this.ops])
  }
}
