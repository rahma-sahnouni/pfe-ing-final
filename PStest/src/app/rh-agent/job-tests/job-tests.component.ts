import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, of, interval, Subscription } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { JobOfferService } from '../../_services/job-offer.service';
import { JobTest, TestRhService } from '../../_services/test-rh.service';
import { HttpClient } from '@angular/common/http';

interface JobTestCard {
  jobId: string;
  jobTitle: string;
  department: string;
  testName: string;
  status: 'active' | 'draft' | 'archived';
  themeCount: number;
  questionCount: number;
  candidateCount?: number;
  completionRate?: number;
  hasTest: boolean;
  test?: JobTest;
  deadline: Date | null;          // ← NEW: RH test deadline from testAssignments
  daysUntilDeadline: number | null; // ← NEW: computed
  deadlineUrgency: 'ok' | 'soon' | 'critical' | 'missed' | null; // ← NEW
}

@Component({
  selector: 'app-job-tests',
  templateUrl: './job-tests.component.html',
  styleUrls: ['./job-tests.component.scss'],
})
export class JobTestsComponent implements OnInit, OnDestroy {
  cards: JobTestCard[] = [];
  loading = true;
  filterStatus: 'all' | 'active' | 'draft' | 'archived' = 'all';
  searchQuery = '';

  totalTests = 0;
  activeTests = 0;
  draftTests = 0;
  candidatesTested = 0;

  // ── Missed deadlines banner ──────────────────────────────────────────────
  get missedDeadlineCards(): JobTestCard[] {
    return this.cards.filter(c => !c.hasTest && c.deadlineUrgency === 'missed');
  }

  get upcomingDeadlineCards(): JobTestCard[] {
    return this.cards.filter(
      c => !c.hasTest && (c.deadlineUrgency === 'soon' || c.deadlineUrgency === 'critical')
    );
  }

  showMissedBanner = true;   // user can dismiss per session
  showUpcomingBanner = true;

  // ── Tick every minute to keep "days remaining" accurate ──────────────────
  private tickSub?: Subscription;

  // ── Modals ───────────────────────────────────────────────────────────────
  showNoResultsModal = false;
  pendingCard: JobTestCard | null = null;

  constructor(
    private jobTestService: TestRhService,
    private jobOfferService: JobOfferService,
    private router: Router,
    private http: HttpClient,
  ) {}

  ngOnInit() {
    this.loadData();
    // refresh deadline labels every minute
    this.tickSub = interval(60_000).subscribe(() => this.refreshDeadlines());
  }

  ngOnDestroy() {
    this.tickSub?.unsubscribe();
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  loadData() {
    this.loading = true;
    this.jobOfferService.getMyRhTestJobs().subscribe({
      next: (jobs) => {
        if (!jobs.length) { this.loading = false; return; }

        const requests = jobs.map(job =>
          this.jobTestService.getTestByJob(job._id!).pipe(
            map(test => ({ job, test })),
            catchError(() => of({ job, test: null as JobTest | null }))
          )
        );

        forkJoin(requests).subscribe(results => {
          this.cards = results.map(({ job, test }) => this.toCard(job, test));
          this.computeStats();
          this.loading = false;
        });
      },
      error: () => { this.loading = false; }
    });
  }

  toCard(job: any, test: JobTest | null): JobTestCard {
    const qCount = test
      ? test.themes.reduce((sum, t) => sum + t.models.reduce((s, m) => s + m.questions.length, 0), 0)
      : 0;

    // Pull deadline from the job's testAssignments.rhTest.deadline
    const rawDeadline = job.testAssignments?.rhTest?.deadline ?? null;
    const deadline = rawDeadline ? new Date(rawDeadline) : null;
    const { days, urgency } = this.computeDeadlineInfo(deadline, !!test);

    return {
      jobId: job._id,
      jobTitle: job.title,
      department: job.department,
      testName: test?.name ?? '',
      status: (test?.status as any) ?? 'draft',
      themeCount: test?.themes?.length ?? 0,
      questionCount: qCount,
      candidateCount: 0,
      completionRate: 0,
      hasTest: !!test,
      test: test ?? undefined,
      deadline,
      daysUntilDeadline: days,
      deadlineUrgency: urgency,
    };
  }

  /**
   * Returns days until deadline (negative = overdue) and an urgency level.
   * Urgency is null when the test is already created (deadline no longer matters).
   */
  private computeDeadlineInfo(
    deadline: Date | null,
    hasTest: boolean,
  ): { days: number | null; urgency: JobTestCard['deadlineUrgency'] } {
    if (!deadline) return { days: null, urgency: null };
    if (hasTest)   return { days: null, urgency: null }; // done — no warning needed

    const now  = new Date();
    const diff = deadline.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    let urgency: JobTestCard['deadlineUrgency'];
    if (days < 0)      urgency = 'missed';
    else if (days <= 2) urgency = 'critical';
    else if (days <= 5) urgency = 'soon';
    else                urgency = 'ok';

    return { days, urgency };
  }

  /** Called every minute by the interval ticker */
  refreshDeadlines() {
    this.cards = this.cards.map(c => {
      const { days, urgency } = this.computeDeadlineInfo(c.deadline, c.hasTest);
      return { ...c, daysUntilDeadline: days, deadlineUrgency: urgency };
    });
  }

  computeStats() {
    this.totalTests       = this.cards.filter(c => c.hasTest).length;
    this.activeTests      = this.cards.filter(c => c.status === 'active').length;
    this.draftTests       = this.cards.filter(c => c.status === 'draft').length;
    this.candidatesTested = this.cards.reduce((s, c) => s + (c.candidateCount ?? 0), 0);
  }

  get filtered(): JobTestCard[] {
    return this.cards.filter(c => {
      const matchStatus = this.filterStatus === 'all' || c.status === this.filterStatus;
      const matchSearch = !this.searchQuery ||
        c.jobTitle.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
        c.testName.toLowerCase().includes(this.searchQuery.toLowerCase());
      return matchStatus && matchSearch;
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  configure(card: JobTestCard) {
    this.router.navigate(['/rh/job-tests', card.jobId]);
  }

  createTest(card: JobTestCard) {
    this.jobTestService.createTest(card.jobId, {
      name: `${card.jobTitle} — Assessment`,
    }).subscribe(test => {
      card.hasTest = true;
      card.test = test;
      card.status = test.status as any;
      card.deadlineUrgency = null; // test created — deadline resolved
      card.daysUntilDeadline = null;
      this.router.navigate(['/rh/job-tests', card.jobId]);
    });
  }

  viewResults(card: JobTestCard) {
    this.http.get<any[]>(`http://localhost:3000/api/submissions/rh`)
      .subscribe({
        next: (submissions) => {
          const hasResults = submissions.some(s => s.job?._id === card.jobId);
          if (hasResults) {
            this.router.navigate(['/rh/job-tests-results'], { queryParams: { jobId: card.jobId } });
          } else {
            this.pendingCard = card;
            this.showNoResultsModal = true;
          }
        },
        error: () => {
          this.router.navigate(['/rh/job-tests-results'], { queryParams: { jobId: card.jobId } });
        }
      });
  }

  closeNoResultsModal() {
    this.showNoResultsModal = false;
    this.pendingCard = null;
  }

  goToConfigure() {
    if (this.pendingCard) {
      this.router.navigate(['/rh/job-tests', this.pendingCard.jobId]);
    }
    this.closeNoResultsModal();
  }

  // ── Deadline helpers (used in template) ──────────────────────────────────

  deadlineLabel(card: JobTestCard): string {
    if (!card.deadline) return '';
    const days = card.daysUntilDeadline!;
    if (days < 0)  return `Overdue by ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''}`;
    if (days === 0) return 'Due today!';
    if (days === 1) return 'Due tomorrow!';
    return `${days} days left`;
  }

  deadlineDate(card: JobTestCard): string {
    if (!card.deadline) return '';
    return card.deadline.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}