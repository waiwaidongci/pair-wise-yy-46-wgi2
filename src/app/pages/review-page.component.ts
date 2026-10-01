import { Component, OnInit } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatStepperModule } from '@angular/material/stepper'
import { Store } from '@ngrx/store'
import { take, type Observable } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import type { BasisConflict, ClaimCase } from '../core/models'
import { basisNoticeText, describeChange } from '../core/basis'
import { selectSelectedClaim, updateClaim, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

type ApprovalPayload = { role: string; result: string; comment: string; basisRevision: number; recordId: string }

@Component({
  selector: 'app-review-page',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatStepperModule, StatusChipComponent],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">RESERVE APPROVAL / 准备金审批</p>
          <h1>多级会签与赔付方案比较</h1>
          <p class="muted">按金额、科目和风险阈值逐级审批；退回必须说明补充材料。</p>
        </div>
        <span class="reserve">申请准备金 {{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }}</span>
      </div>

      <div class="basis-banner" [class.stale]="claim.quoteRevision !== basisAtOpen">
        <mat-icon>{{ claim.quoteRevision !== basisAtOpen ? 'sync_problem' : 'verified' }}</mat-icon>
        <div>
          <strong>待复核依据：报价版本 V{{ claim.quoteRevision }}</strong>
          <p>{{ basisText(claim) }}</p>
          <small *ngIf="claim.quoteRevision === basisAtOpen">本页打开时依据为 V{{ basisAtOpen }}，提交将携带该版本；若期间报价被改动，提交会被拒并保留您的意见。</small>
          <small *ngIf="claim.quoteRevision !== basisAtOpen" class="stale-hint">页面打开时依据为 V{{ basisAtOpen }}，服务器已前进到 V{{ claim.quoteRevision }}，请核对变动科目后再提交。</small>
        </div>
        <button mat-stroked-button type="button" (click)="simulateSurveyorChange(claim)"><mat-icon>compare_arrows</mat-icon> 模拟查勘员并发改价</button>
      </div>

      <div class="retry-bar" *ngIf="pendingRetry">
        <mat-icon>cloud_off</mat-icon>
        <span>网络异常，提交结果未确认（记录号 {{ pendingRetry.payload.recordId }}）。请按原记录号重试，已生效的结果不会重复追加。</span>
        <button mat-flat-button color="primary" (click)="retryPending()">按原记录号重试</button>
      </div>

      <div class="review-grid">
        <section class="panel">
          <div class="panel-head"><h3>会签流程</h3><app-status-chip [label]="claim.status" [tone]="claim.status === '退回补件' || claim.status === '待复核' ? 'warn' : 'good'" /></div>
          <mat-stepper orientation="vertical" [linear]="false" class="approval-stepper">
            <mat-step *ngFor="let step of claim.approvals; let index = index" [completed]="step.status === '已通过'">
              <ng-template matStepLabel>
                <strong>{{ step.role }}</strong>
                <span class="threshold">触发阈值 {{ step.threshold | currency:'CNY':'symbol':'1.0-0' }}</span>
              </ng-template>
              <div class="step-body">
                <div class="invalidated" *ngIf="step.history?.length as historyCount">
                  <mat-icon>history</mat-icon>
                  <span>
                    原{{ step.history![historyCount - 1].status }}（依据 V{{ step.history![historyCount - 1].basisRevision }} · {{ step.history![historyCount - 1].operator }} · {{ step.history![historyCount - 1].completedAt }}）因报价 V{{ step.history![historyCount - 1].invalidatedByRevision }} 失效；意见保留：「{{ step.history![historyCount - 1].comment }}」
                  </span>
                </div>
                <p>{{ step.comment || (step.status === '待处理' ? '等待当前审核人处理。' : step.status + '。') }}</p>
                <small *ngIf="step.operator">{{ step.operator }} · {{ step.completedAt }} · 依据 V{{ step.basisRevision }}</small>
                <div class="conflict" *ngIf="conflicts[index] as conflict">
                  <strong><mat-icon>error_outline</mat-icon> 提交未生效：审批依据已由 V{{ conflict.submittedRevision }} 变为 V{{ conflict.currentRevision }}</strong>
                  <ul>
                    <li *ngFor="let change of conflict.changedItems">{{ changeText(change) }}</li>
                  </ul>
                  <p>您的审批意见已保留在输入框，确认新依据后请重新提交；新报价不会被顶回。</p>
                </div>
                <div class="step-actions" *ngIf="step.status === '待处理'">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批意见</mat-label><input matInput [(ngModel)]="comments[index]" /></mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!comments[index]?.trim()" (click)="decide(claim.id, step.role, '已通过', index)">通过</button>
                  <button mat-stroked-button color="warn" [disabled]="!comments[index]?.trim()" (click)="decide(claim.id, step.role, '退回补件', index)">退回补件</button>
                </div>
              </div>
            </mat-step>
          </mat-stepper>
        </section>

        <aside>
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
    .reserve { padding: 10px 14px; border-left: 3px solid #2f8191; background: #eaf4f5; color: #175866; font-weight: 800; }
    .basis-banner { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; padding: 12px 16px; border: 1px solid #c8dde1; border-left: 4px solid #2f8191; border-radius: 8px; background: #eef6f7; }
    .basis-banner.stale { border-color: #e4c9a6; border-left-color: #ce743e; background: #fff6ec; }
    .basis-banner > mat-icon { color: #2f8191; }
    .basis-banner.stale > mat-icon { color: #b55a2e; }
    .basis-banner > div { flex: 1; }
    .basis-banner strong { font-size: 13px; color: #184855; }
    .basis-banner p { margin: 4px 0; color: #4d6069; font-size: 12px; }
    .basis-banner small { color: #7d8b93; font-size: 11px; }
    .basis-banner .stale-hint { color: #a5511f; font-weight: 700; }
    .retry-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding: 10px 16px; border: 1px solid #e5b8b8; border-left: 4px solid #c05353; border-radius: 8px; background: #fdf0f0; color: #8c3a3a; font-size: 12px; }
    .retry-bar span { flex: 1; }
    .review-grid { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 14px; align-items: start; }
    .approval-stepper { padding: 18px 22px 22px 8px; background: transparent; }
    mat-step strong, mat-step .threshold { display: block; }
    .threshold { margin-top: 3px; color: #78858d; font-size: 10px; }
    .step-body { padding: 4px 0 16px; }
    .step-body p { margin: 0 0 6px; color: #58666f; }
    .step-body small { color: #869198; }
    .invalidated { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 10px; padding: 9px 11px; border-left: 3px solid #ce743e; border-radius: 4px; background: #fff3e8; color: #763f20; font-size: 11px; line-height: 1.55; }
    .invalidated mat-icon { font-size: 16px; width: 16px; height: 16px; margin-top: 1px; }
    .conflict { margin: 10px 0; padding: 11px 13px; border: 1px solid #e4c9a6; border-left: 3px solid #ce743e; border-radius: 6px; background: #fff8ef; }
    .conflict strong { display: flex; align-items: center; gap: 6px; color: #8f4a17; font-size: 12px; }
    .conflict strong mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .conflict ul { margin: 8px 0; padding-left: 18px; color: #6b5638; font-size: 12px; }
    .conflict li { margin-bottom: 3px; }
    .conflict p { margin: 0; color: #7d6a4d; font-size: 11px; }
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
export class ReviewPageComponent implements OnInit {
  claim$: Observable<ClaimCase>
  comments: Record<number, string> = {}
  conflicts: Record<number, BasisConflict> = {}
  basisAtOpen = 0
  pendingRetry: { claimId: string; payload: ApprovalPayload; index: number } | null = null

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
  }

  ngOnInit() {
    // 打开会签页时从服务器刷新一次，并固定本次会话的审批依据版本
    this.claim$.pipe(take(1)).subscribe((claim) => {
      this.service.get(claim.id).subscribe((fresh) => {
        this.store.dispatch(updateClaim({ claim: fresh, silent: true }))
        this.basisAtOpen = fresh.quoteRevision
      })
    })
  }

  basisText(claim: ClaimCase) {
    return basisNoticeText(claim)
  }

  changeText(change: BasisConflict['changedItems'][number]) {
    return describeChange(change)
  }

  planA(claim: ClaimCase) {
    return claim.lossItems.reduce((sum, item) => sum + Math.max(0, (item.repairQuotes.at(-1)?.amount ?? 0) - item.salvage) * item.liability, 0) - claim.deductible
  }

  planB(claim: ClaimCase) {
    return this.planA(claim) - claim.lossItems.filter((item) => item.disputed).length * 72000
  }

  disputedCount(claim: ClaimCase) {
    return claim.lossItems.filter((item) => item.disputed).length
  }

  decide(claimId: string, role: string, result: string, index: number) {
    const comment = this.comments[index]?.trim()
    if (!comment) return
    this.submitApproval(claimId, { role, result, comment, basisRevision: this.basisAtOpen, recordId: this.newRecordId() }, index)
  }

  retryPending() {
    const pending = this.pendingRetry
    if (pending) this.submitApproval(pending.claimId, pending.payload, pending.index)
  }

  simulateSurveyorChange(claim: ClaimCase) {
    const item = claim.lossItems[0]
    const latest = item.repairQuotes.at(-1)?.amount ?? 0
    const amount = Math.round((latest * 1.04) / 1000) * 1000
    this.service
      .addQuote(claim.id, { itemId: item.id, amount, reason: '第三方复测后补充调整（并发模拟）', recordId: this.newRecordId(), operator: '陈立 / 公估' })
      .subscribe(({ claim: updated }) => {
        this.store.dispatch(updateClaim({ claim: updated, silent: true }))
        this.snackBar.open(`查勘员已将「${item.category}」调整为 ${amount.toLocaleString('zh-CN')} 元，服务器依据前进到 V${updated.quoteRevision}`, '关闭', { duration: 3200 })
      })
  }

  private submitApproval(claimId: string, payload: ApprovalPayload, index: number) {
    this.service.approve(claimId, payload).subscribe({
      next: ({ claim, replayed }) => {
        this.store.dispatch(updateClaim({ claim, silent: true }))
        this.basisAtOpen = claim.quoteRevision
        delete this.conflicts[index]
        this.pendingRetry = null
        this.comments[index] = ''
        this.snackBar.open(
          replayed ? `记录 ${payload.recordId} 已生效，未重复追加` : payload.result === '已通过' ? '会签通过，已流转至下一级' : '案件已退回补件，原始记录未修改',
          '关闭',
          { duration: 2400 },
        )
      },
      error: (error) => {
        if (error.status === 409 && error.error?.error === 'BASIS_STALE') {
          const conflict = error.error as BasisConflict
          // 意见不清空，跟随新依据刷新页面数据，新报价保持不变
          this.conflicts[index] = conflict
          this.basisAtOpen = conflict.currentRevision
          this.service.get(claimId).subscribe((fresh) => this.store.dispatch(updateClaim({ claim: fresh, silent: true })))
          return
        }
        if (error.status === 0) {
          this.pendingRetry = { claimId, payload, index }
          return
        }
        this.snackBar.open(error.error?.message ?? '提交失败，请稍后重试', '关闭', { duration: 2600 })
      },
    })
  }

  private newRecordId() {
    return `R-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  }
}
