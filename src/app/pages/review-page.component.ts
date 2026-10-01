import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSlideToggleModule } from '@angular/material/slide-toggle'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatStepperModule } from '@angular/material/stepper'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { distinctUntilChanged, filter } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import type { BasisChange, ClaimCase, QuoteBasis } from '../core/models'
import { selectSelectedClaim, updateClaim, type AppState } from '../core/claims.store'
import { currentBasis, diffBasis, newRecordId } from '../core/basis'
import { OutboxService, type PendingOp } from '../core/outbox.service'
import { StatusChipComponent } from '../shared/status-chip.component'
import { BasisSummaryComponent } from '../shared/basis-summary.component'

type Conflict = { changes: BasisChange[]; comment: string }

@Component({
  selector: 'app-review-page',
  standalone: true,
  imports: [
    CommonModule,
    CurrencyPipe,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSlideToggleModule,
    MatStepperModule,
    StatusChipComponent,
    BasisSummaryComponent,
  ],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">RESERVE APPROVAL / 准备金审批</p>
          <h1>多级会签与赔付方案比较</h1>
          <p class="muted">审批携带页面打开时的报价版本；依据变化时列出改动科目、保留意见，不覆盖新报价。</p>
        </div>
        <div class="head-side">
          <span class="reserve">申请准备金 {{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }}</span>
          <mat-slide-toggle [(ngModel)]="simulateOffline" (ngModelChange)="onOfflineToggle()" color="primary">模拟断网</mat-slide-toggle>
        </div>
      </div>

      <!-- 依据一致性提示 -->
      <div class="basis-banner" [class.stale]="basisStale(claim)">
        <mat-icon>{{ basisStale(claim) ? 'warning_amber' : 'verified' }}</mat-icon>
        <div class="basis-banner-text">
          <strong>{{ basisStale(claim) ? '页面打开后报价依据已变化' : '报价依据与页面打开时一致' }}</strong>
          <span>
            页面打开依据：<ng-container *ngFor="let item of claim.lossItems; let last = last">{{ item.category }} V{{ basisAtOpen[item.id] }}{{ last ? '' : '、' }}</ng-container>
            <ng-container *ngIf="basisStale(claim)"> · 当前依据：<ng-container *ngFor="let item of claim.lossItems; let last = last" class="cur">{{ item.category }} V{{ latestVersion(item) }}{{ last ? '' : '、' }}</ng-container></ng-container>
          </span>
        </div>
      </div>

      <!-- 依据变化冲突面板：列出被改动科目，保留审批意见 -->
      <section class="panel conflict-panel" *ngIf="conflict">
        <div class="panel-head">
          <h3><mat-icon>report_problem</mat-icon> 报价依据已变化，审批未提交</h3>
          <app-status-chip label="未覆盖新报价" tone="warn" />
        </div>
        <p class="conflict-note">以下损失科目在页面打开后产生了新报价版本，本次提交未生效，新报价未被覆盖，审批意见已保留：</p>
        <div class="conflict-list">
          <div *ngFor="let change of conflict.changes" class="conflict-item">
            <mat-icon>price_change</mat-icon>
            <div class="conflict-item-main">
              <strong>{{ change.category }} · {{ change.description }}</strong>
              <span>V{{ change.fromVersion }}（{{ change.fromAmount | currency:'CNY':'symbol':'1.0-0' }}）→ V{{ change.toVersion }}（{{ change.toAmount | currency:'CNY':'symbol':'1.0-0' }}）</span>
            </div>
          </div>
        </div>
        <div class="conflict-opinion">
          <mat-icon>edit_note</mat-icon>
          <div><small>已保留的审批意见</small><p>{{ conflict.comment }}</p></div>
        </div>
        <div class="conflict-actions">
          <button mat-flat-button color="primary" (click)="reloadBasis(claim)"><mat-icon>refresh</mat-icon> 按最新依据重新审批</button>
          <button mat-stroked-button (click)="conflict = null">关闭</button>
        </div>
      </section>

      <!-- 断网暂存/重试队列 -->
      <section class="panel outbox-panel" *ngIf="(outboxPending$ | async)?.length">
        <div class="panel-head">
          <h3><mat-icon>cloud_queue</mat-icon> 断网补录队列（按原记录号重试）</h3>
          <button mat-stroked-button color="primary" (click)="retryAll(claim)"><mat-icon>sync</mat-icon> 全部联网重试</button>
        </div>
        <div class="outbox-list">
          <div *ngFor="let op of outboxPending$ | async" class="outbox-item" [class.conflict]="op.status === 'conflict'">
            <mat-icon>{{ op.status === 'conflict' ? 'report_problem' : 'schedule' }}</mat-icon>
            <div class="outbox-main">
              <strong>{{ op.body.role }} · {{ op.body.result }}</strong>
              <span>原记录号 {{ op.id }} · 已重试 {{ op.attempts }} 次<ng-container *ngIf="op.lastError"> · {{ op.lastError }}</ng-container></span>
              <small>意见：{{ op.body.comment }}</small>
            </div>
            <app-status-chip [label]="op.status === 'conflict' ? '依据变化' : '待联网'" [tone]="op.status === 'conflict' ? 'warn' : 'default'" />
            <button mat-button color="primary" (click)="retryOp(claim, op)">重试</button>
          </div>
        </div>
      </section>

      <div class="review-grid">
        <section class="panel">
          <div class="panel-head"><h3>会签流程</h3><app-status-chip [label]="claim.status" [tone]="claim.status === '退回补件' ? 'warn' : 'good'" /></div>
          <mat-stepper orientation="vertical" [linear]="false" class="approval-stepper">
            <mat-step *ngFor="let step of claim.approvals; let index = index" [completed]="step.status === '已通过'" [state]="step.status === '已失效' ? 'error' : 'number'">
              <ng-template matStepLabel>
                <strong>{{ step.role }}</strong>
                <span class="threshold">触发阈值 {{ step.threshold | currency:'CNY':'symbol':'1.0-0' }}</span>
                <span class="step-state" *ngIf="step.status === '已失效'">已失效 · {{ step.invalidatedBy }}</span>
              </ng-template>
              <div class="step-body">
                <p *ngIf="step.status !== '已失效'">{{ step.comment || (step.status === '待处理' ? '等待当前审核人处理。' : step.status + '。') }}</p>
                <p class="invalidated-note" *ngIf="step.status === '已失效'">
                  <mat-icon>link_off</mat-icon> 该步骤已自 {{ step.invalidatedBy }} 起失效（依据报价版本已变化），原审批结论不再有效，请按最新报价重新审批。
                </p>
                <small *ngIf="step.operator">{{ step.operator }} · {{ step.completedAt }}</small>
                <div class="pending-comment" *ngIf="step.pendingComment">
                  <mat-icon>edit_note</mat-icon><span>已保留意见：{{ step.pendingComment }}</span>
                </div>
                <div class="step-actions" *ngIf="step.status === '待处理' || step.status === '已失效'">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批意见</mat-label><input matInput [(ngModel)]="comments[index]" /></mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!comments[index]?.trim()" (click)="decide(claim, step.role, '已通过', index)">通过</button>
                  <button mat-stroked-button color="warn" [disabled]="!comments[index]?.trim()" (click)="decide(claim, step.role, '退回补件', index)">退回补件</button>
                </div>
              </div>
            </mat-step>
          </mat-stepper>
        </section>

        <aside>
          <app-basis-summary [claim]="claim" />

          <section class="panel">
            <div class="panel-head"><h3>赔付方案对比</h3><span class="muted">自动试算</span></div>
            <div class="plans">
              <mat-card appearance="outlined">
                <span>方案 A · 现状评估</span>
                <strong>{{ planA(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>采用最新报价，全额计入存货库龄风险。</p>
                <button mat-button>设为审批方案</button>
              </mat-card>
              <mat-card appearance="outlined" class="recommended">
                <span>方案 B · 核减待证部分</span>
                <strong>{{ planB(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>暂扣第三方复测与库龄核减争议金额，通过后追加。</p>
                <button mat-flat-button color="primary">推荐方案</button>
              </mat-card>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>争议项定位</h3><span class="muted">{{ disputedCount(claim) }} 项</span></div>
            <div class="disputes">
              <div *ngFor="let item of claim.lossItems" [class.disputed]="item.disputed">
                <mat-icon>{{ item.disputed ? 'report_problem' : 'check_circle' }}</mat-icon>
                <div><strong>{{ item.category }} · {{ item.description }}</strong><p>{{ item.disputed ? '存在证据差异，审批意见不能覆盖原始查勘记录。' : '材料一致，可纳入当前方案。' }}</p></div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .head-side { display: flex; align-items: center; gap: 16px; }
    .reserve { padding: 10px 14px; border-left: 3px solid #2f8191; background: #eaf4f5; color: #175866; font-weight: 800; }
    .basis-banner { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 14px; padding: 11px 14px; border: 1px solid #cfe0e3; border-left: 4px solid #2c7f89; border-radius: 8px; background: #f0f8f8; color: #2c5961; }
    .basis-banner.stale { border-color: #e6c9b3; border-left-color: #ce743e; background: #fff6ee; color: #984313; }
    .basis-banner mat-icon { margin-top: 1px; }
    .basis-banner-text { display: grid; gap: 2px; font-size: 12px; }
    .basis-banner-text span { color: #5c6b73; }
    .basis-banner.stale .basis-banner-text span { color: #8a6a55; }
    .basis-banner-text .cur { color: #b95c2c; font-weight: 700; }
    .conflict-panel { margin-bottom: 14px; padding: 14px 16px; border-left: 4px solid #ce743e; }
    .conflict-note { margin: 8px 0 10px; color: #7a5a44; font-size: 12px; }
    .conflict-list { display: grid; gap: 8px; }
    .conflict-item { display: flex; gap: 9px; padding: 9px 11px; background: #fff6ee; border-radius: 6px; }
    .conflict-item mat-icon { color: #ce743e; }
    .conflict-item-main { display: grid; gap: 2px; }
    .conflict-item-main strong { font-size: 12px; color: #984313; }
    .conflict-item-main span { font-size: 11px; color: #8a6a55; }
    .conflict-opinion { display: flex; gap: 9px; margin-top: 10px; padding: 9px 11px; background: #f4f7f8; border-radius: 6px; }
    .conflict-opinion mat-icon { color: #2c7f89; }
    .conflict-opinion small { color: #7b8790; font-size: 10px; }
    .conflict-opinion p { margin: 2px 0 0; color: #43535c; font-size: 12px; }
    .conflict-actions { display: flex; gap: 8px; margin-top: 12px; }
    .outbox-panel { margin-bottom: 14px; padding: 14px 16px; border-left: 4px solid #2c7f89; }
    .outbox-list { display: grid; gap: 8px; }
    .outbox-item { display: flex; align-items: center; gap: 9px; padding: 9px 11px; background: #f5f8f8; border-radius: 6px; }
    .outbox-item.conflict { background: #fff6ee; }
    .outbox-item > mat-icon { color: #2c7f89; }
    .outbox-item.conflict > mat-icon { color: #ce743e; }
    .outbox-main { display: grid; gap: 2px; flex: 1; min-width: 0; }
    .outbox-main strong { font-size: 12px; }
    .outbox-main span { color: #7b8790; font-size: 10px; }
    .outbox-main small { color: #5c6b73; font-size: 11px; }
    .review-grid { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 14px; align-items: start; }
    .approval-stepper { padding: 18px 22px 22px 8px; background: transparent; }
    mat-step strong, mat-step .threshold { display: block; }
    .threshold { margin-top: 3px; color: #78858d; font-size: 10px; }
    .step-state { display: inline-block; margin-top: 4px; padding: 1px 7px; border-radius: 4px; background: #fff0e4; color: #984313; font-size: 10px; font-weight: 700; }
    .step-body { padding: 4px 0 16px; }
    .step-body p { margin: 0 0 6px; color: #58666f; }
    .step-body small { color: #869198; }
    .invalidated-note { display: flex; gap: 6px; align-items: flex-start; padding: 8px 10px; background: #fff6ee; border-radius: 6px; color: #984313 !important; font-size: 12px; }
    .invalidated-note mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pending-comment { display: flex; gap: 6px; align-items: center; margin: 6px 0; padding: 6px 10px; background: #f4f7f8; border-radius: 6px; color: #43535c; font-size: 11px; }
    .pending-comment mat-icon { font-size: 15px; width: 15px; height: 15px; color: #2c7f89; }
    .step-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .step-actions mat-form-field { flex: 1; min-width: 240px; }
    aside { display: grid; gap: 14px; }
    .plans { display: grid; gap: 10px; padding: 14px; }
    .plans mat-card { padding: 14px; }
    .plans .recommended { border-color: #39828b; background: #f0f8f8; }
    .plans span, .plans p { display: block; color: #69767e; font-size: 12px; }
    .plans strong { display: block; margin: 7px 0; color: #184855; font-size: 22px; }
    .disputes { padding: 6px 14px 14px; }
    .disputes > div { display: flex; gap: 9px; padding: 10px 0; border-bottom: 1px solid #edf0f2; color: #437360; }
    .disputes > div.disputed { color: #b55a2e; }
    .disputes strong { font-size: 12px; }
    .disputes p { margin: 5px 0 0; color: #6d7981; font-size: 11px; line-height: 1.5; }
    @media (max-width: 1050px) { .review-grid { grid-template-columns: 1fr; } }
  `],
})
export class ReviewPageComponent {
  claim$: Observable<ClaimCase>
  comments: Record<number, string> = {}
  basisAtOpen: QuoteBasis = {}
  conflict: Conflict | null = null
  simulateOffline = false
  outboxPending$: Observable<PendingOp[]>
  private current: ClaimCase | null = null

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly snackBar: MatSnackBar,
    private readonly outbox: OutboxService,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
    this.outboxPending$ = this.outbox.pending$
    // 页面打开（或切换案件）时快照报价版本依据
    this.claim$
      .pipe(
        filter((claim): claim is ClaimCase => !!claim),
        distinctUntilChanged((a, b) => a.id === b.id),
      )
      .subscribe((claim) => {
        this.current = claim
        this.basisAtOpen = currentBasis(claim)
        this.conflict = null
      })
  }

  latestVersion(item: { repairQuotes: Array<{ version: number }> }) {
    return item.repairQuotes.at(-1)?.version ?? 0
  }

  basisStale(claim: ClaimCase) {
    return diffBasis(claim, this.basisAtOpen).length > 0
  }

  planA(claim: any) {
    return claim.lossItems.reduce((sum: number, item: any) => sum + Math.max(0, (item.repairQuotes.at(-1)?.amount ?? 0) - item.salvage) * item.liability, 0) - claim.deductible
  }

  planB(claim: any) {
    return this.planA(claim) - claim.lossItems.filter((item: any) => item.disputed).length * 72000
  }

  disputedCount(claim: any) {
    return claim.lossItems.filter((item: any) => item.disputed).length
  }

  /** 按最新报价重新快照依据（冲突后继续审批） */
  reloadBasis(claim: ClaimCase) {
    this.basisAtOpen = currentBasis(claim)
    this.conflict = null
    this.snackBar.open('已按最新报价版本刷新依据，可重新审批', '关闭', { duration: 1800 })
  }

  decide(claim: ClaimCase, role: string, result: string, index: number) {
    const comment = this.comments[index]?.trim()
    if (!comment) return
    const clientMsgId = newRecordId()
    const body = { role, result, comment, basis: this.basisAtOpen, clientMsgId }
    this.service.approve(claim.id, body, this.simulateOffline).subscribe({
      next: ({ claim: updated, replayed }) => {
        this.outbox.remove(clientMsgId)
        this.applyServerClaim(claim, updated)
        this.snackBar.open(
          replayed ? '原记录已生效，未重复追加审批结果' : result === '已通过' ? '会签通过，已流转至下一级' : '案件已退回补件，原始记录未修改',
          '关闭',
          { duration: 2400 },
        )
        this.comments[index] = ''
        this.conflict = null
      },
      error: (err) => {
        if (err.status === 409 && err.error?.error === 'basis_changed') {
          // 依据变化：列出改动科目、保留意见、不覆盖新报价
          this.conflict = { changes: err.error.changes, comment }
          this.persistRetainedOpinion(claim, role, comment)
          this.snackBar.open('报价依据已变化，审批未提交；意见已保留', '关闭', { duration: 2600 })
        } else {
          // 断网：按原记录号暂存，联网后重试
          this.outbox.add({
            id: clientMsgId,
            claimId: claim.id,
            body,
            basisLabel: claim.lossItems.map((item) => `${item.category} V${this.latestVersion(item)}`).join('、'),
            createdAt: Date.now(),
            attempts: 1,
            status: 'pending',
          })
          this.snackBar.open('网络异常，已按原记录号暂存，联网后自动重试', '关闭', { duration: 2600 })
        }
      },
    })
  }

  retryOp(claim: ClaimCase, op: PendingOp) {
    this.outbox.update(op.id, { attempts: op.attempts + 1, lastError: undefined })
    this.service.approve(op.claimId, op.body, false).subscribe({
      next: ({ claim: updated, replayed }) => {
        this.outbox.remove(op.id)
        this.applyServerClaim(claim, updated)
        this.snackBar.open(replayed ? '原记录已生效，未重复追加审批结果' : '补录已提交', '关闭', { duration: 2200 })
      },
      error: (err) => {
        if (err.status === 409 && err.error?.error === 'basis_changed') {
          this.outbox.update(op.id, { status: 'conflict' })
          this.conflict = { changes: err.error.changes, comment: op.body.comment }
        } else {
          this.outbox.update(op.id, { attempts: op.attempts + 1, lastError: '仍无法连接' })
        }
      },
    })
  }

  retryAll(claim: ClaimCase) {
    for (const op of this.outbox.all()) {
      if (op.status === 'pending') this.retryOp(claim, op)
    }
  }

  onOfflineToggle() {
    if (!this.simulateOffline && this.current) {
      // 恢复联网后自动补录暂存记录（同一原记录号，已生效不重复追加）
      this.retryAll(this.current)
    }
  }

  /** 保留审批意见到本地案件（冲突未提交时） */
  private persistRetainedOpinion(claim: ClaimCase, role: string, comment: string) {
    const updated = structuredClone(claim)
    const step = updated.approvals.find((candidate) => candidate.role === role)
    if (step) {
      step.pendingComment = comment
      this.store.dispatch(updateClaim({ claim: updated }))
    }
  }

  /** 合并服务端案件，保留本地编辑（查勘事实/残值/责任比例） */
  private applyServerClaim(local: ClaimCase, server: ClaimCase) {
    const lossItems = server.lossItems.map((serverItem) => {
      const localItem = local.lossItems.find((candidate) => candidate.id === serverItem.id)
      return localItem ? { ...serverItem, damage: localItem.damage, salvage: localItem.salvage, liability: localItem.liability } : serverItem
    })
    this.store.dispatch(updateClaim({ claim: { ...server, lossItems } }))
  }
}
