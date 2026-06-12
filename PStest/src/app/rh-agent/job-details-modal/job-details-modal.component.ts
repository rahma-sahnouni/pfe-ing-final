import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { JobOffer, JobOfferService } from '../../_services/job-offer.service';
import { JobTest, TestRhService } from '../../_services/test-rh.service';
// job-details-modal.component.ts
import { TechnicalTestService, TechnicalTest, QcmQuestion, QcmOption } from '../../_services/technical-test.service';
@Component({
  selector: 'app-job-details-modal',
  templateUrl: './job-details-modal.component.html',
  styleUrls: ['./job-details-modal.component.css']
})
export class JobDetailsModalComponent implements OnInit {

  @Input() job!: JobOffer;
  @Output() closed       = new EventEmitter<void>();
  @Output() jobUpdated   = new EventEmitter<JobOffer>();
  @Output() editRequested = new EventEmitter<JobOffer>();

  rhTest: JobTest | null = null;
  technicalTests: TechnicalTest[] = [];

  loadingRh   = false;
  loadingTech = false;
  publishing  = false;
  changingStatus = false;

  rhError   = false;
  techError = false;

  activeTab: 'overview' | 'rh' | 'technical' = 'overview';

  showStatusMenu     = false;
  statusSaveSuccess  = false;
  statusSaveError    = false;

  readonly statusOptions: { value: NonNullable<JobOffer['status']>; label: string; icon: string }[] = [
    { value: 'draft',  label: 'Draft',  icon: '📝' },
    { value: 'open',   label: 'Open',   icon: '🟢' },
    { value: 'paused', label: 'Paused', icon: '⏸'  },
    { value: 'closed', label: 'Closed', icon: '🔴' },
  ];

constructor(
  private jobService:      JobOfferService,
  private testRhService:   TestRhService,
  private techTestService: TechnicalTestService
) {}

  ngOnInit(): void {
    console.log('[JobDetailsModal] Component initialized');
    console.log('[JobDetailsModal] Job received:', this.job);

    this.loadRhTest();
    this.loadTechnicalTests();
  }
getCriterionLabel(model: any, criterionKey: string): string {
  const criterion = model.customCriteria?.find((c: any) => c.key === criterionKey);
  return criterion ? criterion.label : criterionKey;
}
  // ── Loaders ────────────────────────────────────────────────────────────────

  loadRhTest(): void {

    if (!this.job._id) {
      console.warn('[RH Test] Job ID is missing');
      return;
    }

    console.log('[RH Test] Loading RH test for job:', this.job._id);

    this.loadingRh = true;
    this.rhError   = false;

    this.testRhService.getTestByJob(this.job._id).subscribe({

      next: (test) => {
        console.log('[RH Test] RH test loaded successfully:', test);
        this.rhTest = test;
        this.loadingRh = false;
      },

      error: (err) => {
        console.error('[RH Test] Error loading RH test:', err);
        this.loadingRh = false;
        this.rhError = true;
      }

    });
  }

  loadTechnicalTests(): void {

    if (!this.job._id) {
      console.warn('[Technical Tests] Job ID is missing');
      return;
    }

    console.log('[Technical Tests] Loading technical tests for job:', this.job._id);

    this.loadingTech = true;
    this.techError   = false;

    this.techTestService.getTestsByJob(this.job._id).subscribe({

      next: (tests) => {
        console.log('[Technical Tests] Technical tests loaded:', tests);
        this.technicalTests = tests;
        this.loadingTech = false;
      },

      error: (err) => {
        console.error('[Technical Tests] Error loading technical tests:', err);
        this.loadingTech = false;
        this.techError = true;
      }

    });
  }

  // ── Publish shortcut ───────────────────────────────────────────────────────

  publishJob(): void {
    console.log('[Publish] Publishing job:', this.job._id);
    this.changeStatus('open');
  }

  // ── Generic status change ──────────────────────────────────────────────────

  changeStatus(newStatus: NonNullable<JobOffer['status']>): void {

    console.log('[Status Change] Requested:', newStatus);
    console.log('[Status Change] Current status:', this.job.status);

    if (!this.job._id || this.changingStatus || this.job.status === newStatus) {
      console.warn('[Status Change] Change ignored', {
        jobId: this.job._id,
        changing: this.changingStatus,
        sameStatus: this.job.status === newStatus
      });
      this.showStatusMenu = false;
      return;
    }

    this.changingStatus   = true;
    this.showStatusMenu   = false;
    this.statusSaveSuccess = false;
    this.statusSaveError   = false;

    const updated: JobOffer = { ...this.job, status: newStatus };

    console.log('[Status Change] Sending update request:', updated);

    this.jobService.updateJob(this.job._id, updated).subscribe({

      next: (saved) => {
        console.log('[Status Change] Job updated successfully:', saved);

        this.job = saved;
        this.changingStatus  = false;
        this.statusSaveSuccess = true;

        this.jobUpdated.emit(saved);

        setTimeout(() => this.statusSaveSuccess = false, 3000);
      },

      error: (err) => {
        console.error('[Status Change] Failed to update job status:', err);

        this.changingStatus = false;
        this.statusSaveError = true;

        setTimeout(() => this.statusSaveError = false, 3000);
      }

    });
  }

  toggleStatusMenu(event: Event): void {
    event.stopPropagation();
    this.showStatusMenu = !this.showStatusMenu;

    console.log('[UI] Status menu toggled:', this.showStatusMenu);
  }

  closeStatusMenu(): void {
    console.log('[UI] Status menu closed');
    this.showStatusMenu = false;
  }

  // ── Close / Edit ───────────────────────────────────────────────────────────

  close(): void {
    console.log('[UI] Closing job details modal');
    this.closed.emit();
  }

  requestEdit(): void {
    console.log('[UI] Edit requested for job:', this.job);
    this.editRequested.emit(this.job);
  }

  // ── Computed helpers ───────────────────────────────────────────────────────

  get canPublish(): boolean {
    const result = this.job.status === 'draft';
    console.log('[Computed] canPublish:', result);
    return result;
  }

  get totalRhQuestions(): number {

    if (!this.rhTest) return 0;

    const total = this.rhTest.themes.reduce((sum, theme) =>
      sum + theme.models.reduce((s, m) => s + (m.questions?.length ?? 0), 0), 0);

    console.log('[Computed] Total RH questions:', total);

    return total;
  }

  get totalTechQuestions(): number {

    const total = this.technicalTests.reduce((sum, t) =>
      sum + (t.qcm?.questions?.length ?? 0), 0);

    console.log('[Computed] Total Technical questions:', total);

    return total;
  }
  // ── Format helper — safely stringify objects (fixes [object Object] in examples) ──
  formatValue(val: any): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return JSON.stringify(val);
  }
 
  testTypeIcon(type?: string): string {

    const map: Record<string, string> = {
      problem_solving: '💡',
      qcm: '📝',
      mixed: '🔀'
    };

    const icon = map[type ?? ''] ?? '📋';

    console.log('[Helper] Test type icon:', type, '→', icon);

    return icon;
  }

  categoryIcon(cat?: string): string {

    const map: Record<string, string> = {
      personality: '🧠',
      motivation: '🎯',
      behavior: '👥',
      logical_reasoning: '🔢',
      emotional_intelligence: '❤️',
      custom: '⚙️'
    };

    const icon = map[cat ?? ''] ?? '📋';

    console.log('[Helper] Category icon:', cat, '→', icon);

    return icon;
  }

  difficultyColor(d?: string): string {

    const map: Record<string, string> = {
      easy: 'success',
      medium: 'warning',
      hard: 'danger'
    };

    const color = map[d ?? ''] ?? 'secondary';

    console.log('[Helper] Difficulty color:', d, '→', color);

    return color;
  }

  rhStatusColor(status?: string): string {

    const map: Record<string, string> = {
      active: 'success',
      draft: 'warning',
      archived: 'danger'
    };

    const color = map[status ?? ''] ?? 'secondary';

    console.log('[Helper] RH status color:', status, '→', color);

    return color;
  }
}