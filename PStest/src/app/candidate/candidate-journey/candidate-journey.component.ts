import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  CandidateService,
  JourneyItem,
  RhTestSummary,
  TechTestSummary,
  TestSubmissionSummary,
} from '../../_services/candidate.service';

export interface PipelineStage {
  id:          number;
  key:         string;
  label:       string;
  icon:        string;
  description: string;
  state:       'done' | 'active' | 'locked';
  badge:       string;
  badgeClass:  string;
}

@Component({
  selector: 'app-candidate-journey',
  templateUrl: './candidate-journey.component.html',
  styleUrl: './candidate-journey.component.css'
})
export class CandidateJourneyComponent implements OnInit {
  loading  = true;
  error    = '';

  allJourneyItems:  JourneyItem[] = [];
  selectedIndex     = 0;
  current:          JourneyItem | null = null;

  stages:           PipelineStage[] = [];
  expandedStages:   Set<number>     = new Set();

  showPreSelectionModal    = false;
  showRhFirstModal         = false;
  showTestPeriodErrorModal = false;
  testPeriodErrorMessage   = '';

  constructor(
    private journeyService: CandidateService,
    private router:         Router,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  // ── Data loading ────────────────────────────────────────────────────────

  load(): void {
    this.loading = true;
    this.journeyService.getJourney().subscribe({
      next: (res) => {
        this.allJourneyItems = res.journey;
        if (this.allJourneyItems.length) {
          this.selectJob(0);
        } else {
          this.error = 'No applications found yet. Apply to a job to start your journey.';
        }
        this.loading = false;
      },
      error: (err) => {
        this.error   = err.message || 'Failed to load journey.';
        this.loading = false;
      },
    });
  }

  selectJob(index: number): void {
    this.selectedIndex = index;
    this.current       = this.allJourneyItems[index];
    this.stages        = this.buildStages(this.current);
    this.expandedStages.clear();
    const active = this.stages.find(s => s.state === 'active');
    if (active) this.expandedStages.add(active.id);
  }

  // ── Pipeline builder ─────────────────────────────────────────────────────

  private areRhTestsApproved(item: JourneyItem): boolean {
    if (item.rhApproved === 'approved') return true;
    if (item.rhTests.length === 0) return item.currentStage > 2;
    return false;
  }

  private areTechTestsApproved(item: JourneyItem): boolean {
    if (item.techStatus === 'approved') return true;
    if (item.technicalTests.length === 0) return item.currentStage > 3;
    return false;
  }

  private buildStages(item: JourneyItem): PipelineStage[] {
    const cs = item.currentStage;

    const rhActuallyDone   = item.rhTests.length > 0 && item.rhTests.every(t => t.submitted);
    const techActuallyDone = item.technicalTests.length > 0 && item.technicalTests.every(t => t.submitted);

    // Shared approval check (mirrors isRhTestsComplete / isTechTestsComplete)
    const rhOk = (): boolean =>
      item.rhApproved === 'approved' ||
      (item.rhTests.length === 0 && cs > 2) ||
      rhActuallyDone;

    const techOk = (): boolean =>
      item.techStatus === 'approved' ||
      (item.technicalTests.length === 0 && cs > 3) ||
      techActuallyDone;

    const stateFor = (stageId: number): PipelineStage['state'] => {
      if (stageId === 6) {
        if (item.applicationStatus === 'Accepted' || item.applicationStatus === 'Rejected') return 'done';
        return cs >= 6 ? 'active' : 'locked';
      }
      if (stageId > cs)   return 'locked';
      if (stageId === cs) return 'active';
      return 'done';
    };

    const rhState = (): PipelineStage['state'] => {
      if (!item.rhTests.length) {
        return cs > 2 ? 'done' : cs === 2 ? 'done' : 'locked';
      }
      if (rhActuallyDone) return 'done';
      if (cs === 2 && item.preSelected) return 'active';
      return 'locked';
    };

    const techState = (): PipelineStage['state'] => {
      if (!item.technicalTests.length) {
        return cs > 3 ? 'done' : cs === 3 ? 'done' : 'locked';
      }
      if (techActuallyDone) return 'done';
      if (item.rhTests.length > 0 && !rhActuallyDone) return 'locked';
      if (cs === 3) return 'active';
      return 'locked';
    };

    // Stage 4: done only when both tests are APPROVED (not just submitted)
    const reviewState = (): PipelineStage['state'] => {
      const rhApproved = this.areRhTestsApproved(item);
      const techApproved = this.areTechTestsApproved(item);

      if (rhApproved && techApproved) return 'done';

      // If tests are submitted but not yet approved -> stage is active (in progress)
      const rhSubmitted = item.rhTests.length > 0 && item.rhTests.every(t => t.submitted);
      const techSubmitted = item.technicalTests.length > 0 && item.technicalTests.every(t => t.submitted);
      if ((rhSubmitted || item.rhTests.length === 0) &&
          (techSubmitted || item.technicalTests.length === 0) &&
          (item.rhApproved !== 'rejected' && item.techStatus !== 'rejected')) {
        return 'active';
      }

      return 'locked';
    };

    // Stage 5: active only when stage 4 is done (i.e., tests approved)
    const interviewState = (): PipelineStage['state'] => {
      const status = item.applicationStatus;
      if (status === 'Accepted' || status === 'Rejected') return 'done';
      if (status === 'RH Interview' || status === 'Tech Interview') return 'active';
      if (cs > 5) return 'done';

      // Unlock as active only once both tests are APPROVED
      if (this.areRhTestsApproved(item) && this.areTechTestsApproved(item)) return 'active';
      return 'locked';
    };

    const decisionState = (): PipelineStage['state'] => {
      if (item.applicationStatus === 'Accepted' || item.applicationStatus === 'Rejected') return 'done';
      if (cs < 6) return 'locked';
      return 'active';
    };

    const badgeFromState = (state: PipelineStage['state'], customLabel?: string): string => {
      if (customLabel) return customLabel;
      if (state === 'done')   return 'Completed';
      if (state === 'active') return 'In progress';
      return 'Upcoming';
    };

    const badgeClassFromState = (state: PipelineStage['state']): string => {
      if (state === 'done')   return 'badge-done';
      if (state === 'active') return 'badge-active';
      return 'badge-locked';
    };

    const finalBadge = (): string => {
      if (item.applicationStatus === 'Accepted') return 'Accepted';
      if (item.applicationStatus === 'Rejected') return 'Rejected';
      return 'Upcoming';
    };

    const finalBadgeClass = (): string => {
      if (item.applicationStatus === 'Accepted') return 'badge-done';
      if (item.applicationStatus === 'Rejected') return 'badge-danger';
      return 'badge-locked';
    };

    const s1 = stateFor(1);
    const s2 = rhState();
    const s3 = techState();
    const s4 = reviewState();
    const s5 = interviewState();
    const s6 = decisionState();

    return [
      {
        id: 1, key: 'screening',
        label:       'Application & AI screening',
        icon:        'smart_toy',
        description: 'Your CV was parsed and matched against the job requirements by our AI engine.',
        state: s1, badge: badgeFromState(s1), badgeClass: badgeClassFromState(s1),
      },
      {
        id: 2, key: 'rh-test',
        label:       'Psychometric (RH) test',
        icon:        'psychology',
        description: item.rhTests.length
          ? 'Complete the personality and motivation assessment assigned by HR.'
          : 'No psychometric test required for this position.',
        state: s2, badge: badgeFromState(s2), badgeClass: badgeClassFromState(s2),
      },
      {
        id: 3, key: 'tech-test',
        label:       'Technical test',
        icon:        'code',
        description: item.technicalTests.length
          ? 'Complete the coding challenge and/or QCM assigned by the technical team.'
          : 'No technical test required for this position.',
        state: s3, badge: badgeFromState(s3), badgeClass: badgeClassFromState(s3),
      },
      {
        id: 4, key: 'review',
        label:       'Results review',
        icon:        'rate_review',
        description: 'The hiring team is reviewing your test results and application.',
        state: s4,
        badge: badgeFromState(s4, s4 === 'active' ? 'Under review' : undefined),
        badgeClass: badgeClassFromState(s4),
      },
      {
        id: 5, key: 'interview',
        label:       'Interview',
        icon:        'groups',
        description: item.interview?.scheduledAt
          ? `Your interview is scheduled for ${this.formatDate(item.interview.scheduledAt)}.`
          : 'If selected, you will be invited to an interview with the team.',
        state: s5,
        badge: badgeFromState(
          s5,
          s5 === 'active' && item.interview?.scheduledAt ? 'Scheduled' :
          s5 === 'active' ? 'Awaiting scheduling' : undefined
        ),
        badgeClass: badgeClassFromState(s5),
      },
      {
        id: 6, key: 'decision',
        label:       'Final decision',
        icon:        'verified',
        description: item.applicationStatus === 'Accepted'
          ? 'Congratulations! You have been selected for this position.'
          : item.applicationStatus === 'Rejected'
          ? 'Thank you for your participation. Unfortunately, your application was not successful.'
          : 'The final hiring decision will be communicated here.',
        state: s6, badge: finalBadge(), badgeClass: finalBadgeClass(),
      },
    ];
  }

  // ── UI helpers ───────────────────────────────────────────────────────────

  toggleStage(id: number): void {
    if (this.expandedStages.has(id)) {
      this.expandedStages.delete(id);
    } else {
      this.expandedStages.add(id);
    }
  }

  isExpanded(id: number): boolean {
    return this.expandedStages.has(id);
  }

  closeModal(): void {
    this.showPreSelectionModal = false;
    this.showRhFirstModal      = false;
  }

  closeTestPeriodErrorModal(): void {
    this.showTestPeriodErrorModal = false;
    this.testPeriodErrorMessage   = '';
  }

  // ── Test period ──────────────────────────────────────────────────────────

  private getTestPeriodErrorType(): 'not_started' | 'expired' | null {
    if (!this.current) return null;
    const period = this.current.testPeriod;
    if (!period) return null;
    const now = new Date();
    if (period.start && new Date(period.start) > now) return 'not_started';
    if (period.end   && new Date(period.end)   < now) return 'expired';
    return null;
  }

  get testPeriodErrorType(): 'not_started' | 'expired' | null {
    return this.getTestPeriodErrorType();
  }

  private isTestPeriodValid(): boolean {
    if (!this.current) return false;
    const period = this.current.testPeriod;
    if (!period || (!period.start && !period.end)) return true;
    return this.getTestPeriodErrorType() === null;
  }

  private getTestPeriodError(): string {
    if (!this.current) return '';
    const type   = this.getTestPeriodErrorType();
    const period = this.current.testPeriod!;
    if (type === 'not_started') {
      return `The test period has not started yet. Tests will be available from ${this.formatDate(period.start)}.`;
    }
    if (type === 'expired') {
      return `You missed the test window, which closed on ${this.formatDate(period.end)}.`;
    }
    return '';
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  goToNextPendingTest(): void {
    if (!this.current) return;
    const pendingRh = this.current.rhTests.find(t => !t.submitted);
    if (pendingRh) {
      this.goToRhTest(this.current.jobOffer._id, pendingRh._id);
      return;
    }
    const pendingTech = this.current.technicalTests.find(t => !t.submitted);
    if (pendingTech) {
      this.goToTechTest(this.current.jobOffer._id, pendingTech._id);
    }
  }

  goToRhTest(jobId: string, testId: string): void {
    if (!this.current?.preSelected) {
      this.showPreSelectionModal = true;
      return;
    }
    if (!this.isTestPeriodValid()) {
      this.testPeriodErrorMessage   = this.getTestPeriodError();
      this.showTestPeriodErrorModal = true;
      return;
    }
    this.router.navigate(['/candidate/rh-test', jobId, testId]);
  }

  goToTechTest(jobId: string, testId: string): void {
    if (!this.current?.preSelected) {
      this.showPreSelectionModal = true;
      return;
    }
    const rhPending = this.current.rhTests.length > 0 &&
                      !this.current.rhTests.every(t => t.submitted);
    if (rhPending) {
      this.showRhFirstModal = true;
      return;
    }
    if (!this.isTestPeriodValid()) {
      this.testPeriodErrorMessage   = this.getTestPeriodError();
      this.showTestPeriodErrorModal = true;
      return;
    }
    this.router.navigate(['/candidate/tech-test', jobId, testId]);
  }

  // ── Score & display helpers ──────────────────────────────────────────────

  trackByStageId(_: number, s: PipelineStage): number { return s.id; }
  trackByIdx(i: number): number { return i; }

  scoreClass(score: number | null): string {
    if (score === null) return 'score-na';
    if (score >= 70)    return 'score-high';
    if (score >= 45)    return 'score-mid';
    return 'score-low';
  }

  scoreLabel(score: number | null): string {
    if (score === null) return 'Pending';
    return `${score}%`;
  }

  difficultyLabel(d: string): string {
    return ({ easy: 'Easy', medium: 'Medium', hard: 'Hard' } as Record<string, string>)[d] ?? d;
  }

  difficultyClass(d: string): string {
    return ({ easy: 'diff-easy', medium: 'diff-medium', hard: 'diff-hard' } as Record<string, string>)[d] ?? '';
  }


  get progressPercent(): number {
    if (!this.current) return 0;
    const done = this.stages.filter(s => s.state === 'done').length;
    return Math.round((done / this.stages.length) * 100);
  }

  get overallStageLabel(): string {
    if (!this.current) return '';
    const active = this.stages.find(s => s.state === 'active');
    return active ? active.label : this.stages[this.stages.length - 1].label;
  }

  get isAllDone(): boolean {
    return !!this.current && (
      this.current.applicationStatus === 'Accepted' ||
      this.current.applicationStatus === 'Rejected'
    );
  }

  get hasAnyTest(): boolean {
    return !!this.current && (
      this.current.rhTests.length > 0 ||
      this.current.technicalTests.length > 0
    );
  }

  get pendingTestCount(): number {
    if (!this.current) return 0;
    const rhPending   = this.current.rhTests.filter(t => !t.submitted).length;
    const techPending = this.current.technicalTests.filter(t => !t.submitted).length;
    return rhPending + techPending;
  }

  // ── Stage 4 check helpers (used by HTML template) ────────────────────────

  isRhTestsComplete(): boolean {
    if (!this.current) return false;
    if (this.current.rhApproved === 'approved') return true;
    if (this.current.rhTests.length === 0) return this.current.currentStage > 2;
    return false;
  }

  isTechTestsComplete(): boolean {
    if (!this.current) return false;
    if (this.current.techStatus === 'approved') return true;
    if (this.current.technicalTests.length === 0) return this.current.currentStage > 3;
    return false;
  }

  isOverallDecisionDone(): boolean {
    return this.isRhTestsComplete() && this.isTechTestsComplete();
  }
  formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
}