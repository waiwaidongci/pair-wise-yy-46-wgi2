import { Component, Input } from '@angular/core'
import { CommonModule } from '@angular/common'
import { MatIconModule } from '@angular/material/icon'
import type { ClaimCase } from '../core/models'
import { StatusChipComponent } from './status-chip.component'
import { currentBasis } from '../core/basis'

@Component({
  selector: 'app-basis-summary',
  standalone: true,
  imports: [CommonModule, MatIconModule, StatusChipComponent],
  template: `
    <section class="panel basis-panel">
      <div class="panel-head">
        <h3>待复核依据</h3>
        <app-status-chip
          [label]="invalidatedSteps.length ? invalidatedSteps.length + ' 步失效' : '依据一致'"
          [tone]="invalidatedSteps.length ? 'warn' : 'good'"
        />
      </div>
      <p class="basis-note">会签以各科目最新报价版本为依据；报价变化后，已批准的步骤自动失效，需按新依据重新会签。</p>
      <div class="basis-list">
        <div *ngFor="let item of claim.lossItems">
          <mat-icon>receipt_long</mat-icon>
          <div class="basis-item-main">
            <strong>{{ item.category }}</strong>
            <small>{{ item.description }}</small>
          </div>
          <span class="basis-version">V{{ latestVersion(item) }}</span>
        </div>
      </div>
      <div class="invalidated" *ngIf="invalidatedSteps.length">
        <p class="invalidated-title"><mat-icon>link_off</mat-icon> 以下会签步骤已因报价变化失效：</p>
        <div *ngFor="let step of invalidatedSteps" class="invalidated-item">
          <strong>{{ step.role }}</strong>
          <span>{{ step.invalidatedBy }} 起失效 · 需按最新报价重新会签</span>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .basis-panel { padding: 14px 16px; }
    .basis-note { margin: 0 0 10px; color: #7a858c; font-size: 11px; line-height: 1.5; }
    .basis-list { display: grid; gap: 6px; }
    .basis-list > div { display: flex; align-items: center; gap: 9px; padding: 7px 8px; background: #f5f8f8; border-radius: 6px; }
    .basis-list mat-icon { color: #2c7f89; font-size: 18px; width: 18px; height: 18px; }
    .basis-item-main { display: grid; min-width: 0; }
    .basis-item-main strong { font-size: 12px; }
    .basis-item-main small { color: #7b8790; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .basis-version { margin-left: auto; color: #1d6670; font-weight: 800; font-size: 12px; }
    .invalidated { margin-top: 12px; padding: 10px 12px; background: #fff3e8; border-left: 3px solid #ce743e; border-radius: 4px; }
    .invalidated-title { display: flex; align-items: center; gap: 6px; margin: 0 0 7px; color: #984313; font-size: 11px; font-weight: 700; }
    .invalidated-title mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .invalidated-item { display: grid; gap: 2px; padding: 5px 0; border-top: 1px dashed #e6c9b3; }
    .invalidated-item strong { color: #984313; font-size: 12px; }
    .invalidated-item span { color: #8a6a55; font-size: 10px; }
  `],
})
export class BasisSummaryComponent {
  @Input() claim!: ClaimCase

  get invalidatedSteps() {
    return this.claim.approvals.filter((step) => step.status === '已失效')
  }

  latestVersion(item: { repairQuotes: Array<{ version: number }> }) {
    return item.repairQuotes.at(-1)?.version ?? 0
  }

  basis() {
    return currentBasis(this.claim)
  }
}
