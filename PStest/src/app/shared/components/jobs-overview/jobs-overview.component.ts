// jobs-overview.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, takeUntil, finalize } from 'rxjs/operators';

// Services
import { JobOfferService, JobOffer } from '../../../_services/job-offer.service';
import { TestRhService } from '../../../_services/test-rh.service';
import { TechnicalTestService } from '../../../_services/technical-test.service';
import { SubmissionService, TestSubmission } from '../../../_services/submission.service';
import { CandidateService } from '../../../_services/candidate.service';

export interface CandidateRow {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  location?: string;
  experience?: number;
  score?: number;
  avatarColor?: string;
  aiMatchScore?: number | null;
  preSelected?: boolean;
  applicationStatus: string;
  appliedDate: string;
  cv?: { originalName?: string; uploadedAt?: string };
  cvExtracted?: { skills?: string[] };
}

export interface JobSummary {
  _id: string;
  title: string;
  department?: string;
  location?: string;
  contractType?: string;
  experienceLevel?: string;
  status: string;
  deadline?: string;
  applicationsCount?: number;
  testAssignments?: {
    rhTest: { enabled: boolean; assignedTo: any[]; deadline: string | null };
    technicalTest: { enabled: boolean; assignedTo: any[]; deadline: string | null };
  };
  technicalTests?: any[];
  rhTest?: any;
  techTests?: any[];
  submissions?: TestSubmission[];
  candidates?: CandidateRow[];
  expanded?: boolean;
  loadingSubmissions?: boolean;
  evaluatedRatio?: number;
}

@Component({
  selector: 'app-jobs-overview',
  templateUrl: './jobs-overview.component.html',
  styleUrls: ['./jobs-overview.component.scss']
})
export class JobsOverviewComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  jobs: JobSummary[] = [];
  filteredJobs: JobSummary[] = [];
  loading = true;
  error: string | null = null;

  searchQuery = '';
  statusFilter = 'all';
  testFilter = 'all';

  totalJobs = 0;
  totalSubmissions = 0;
  totalCandidates = 0;
  evaluatedCount = 0;
  pendingCount = 0;

  showCandidateModal = false;
  selectedCandidate: CandidateRow | null = null;
  selectedJob: JobSummary | null = null;

  constructor(
    private jobService: JobOfferService,
    private rhTestService: TestRhService,
    private techTestService: TechnicalTestService,
    private submissionService: SubmissionService,
    private candidateService: CandidateService
  ) {}

  ngOnInit(): void {
    this.loadJobs();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadJobs(): void {
    this.loading = true;
    this.jobService.getJobs()
      .pipe(
        takeUntil(this.destroy$),
        catchError(() => {
          this.error = 'Failed to load jobs.';
          return of([]);
        }),
        finalize(() => (this.loading = false))
      )
      .subscribe((jobs: JobOffer[]) => {
        this.jobs = jobs
          .filter((j): j is JobOffer & { _id: string } => !!j._id)
          .map((j) => ({
            ...j,
            _id: j._id,
            status: j.status || 'draft',
            expanded: false,
            submissions: [],
            candidates: [],
            loadingSubmissions: false,
            evaluatedRatio: 0,
          }));
        this.totalJobs = this.jobs.length;
        this.applyFilters();
        this.preloadAll();
      });
  }

  private preloadAll(): void {
    this.jobs.forEach((job) => this.loadJobData(job));
  }

// jobs-overview.component.ts (extrait corrigé)
loadJobData(job: JobSummary): void {
  if (job.loadingSubmissions) return;
  job.loadingSubmissions = true;

  forkJoin({
    submissions: this.submissionService.getAllSubmissionsForJob(job._id).pipe(catchError(() => of([]))),
    rhTest: this.rhTestService.getTestByJob(job._id).pipe(catchError(() => of(null))),
    techTests: this.techTestService.getTestsByJob(job._id).pipe(catchError(() => of([]))),
    candidates: this.candidateService.getCandidatesByJob(job._id).pipe(catchError(() => of({ candidates: [] }))),
  })
    .pipe(takeUntil(this.destroy$))
    .subscribe(({ submissions, rhTest, techTests, candidates }) => {
      job.rhTest = rhTest;
      job.techTests = techTests || [];
      job.candidates = (candidates as any)?.candidates || [];
      job.submissions = submissions; // déjà filtrées par jobId
      job.loadingSubmissions = false;

      const evaluated = submissions.filter(s => s.status === 'evaluated');
      job.evaluatedRatio = submissions.length ? evaluated.length / submissions.length : 0;

      this.recalcKpis();
    });
}

  private recalcKpis(): void {
    const allSubs = this.jobs.flatMap((j) => j.submissions || []);
    const allCands = this.jobs.flatMap((j) => j.candidates || []);
    this.totalSubmissions = allSubs.length;
    this.totalCandidates = allCands.length;
    this.evaluatedCount = allSubs.filter((s) => s.status === 'evaluated').length;
    this.pendingCount = allSubs.filter((s) => s.status !== 'evaluated').length;
  }

  toggleJob(job: JobSummary): void {
    job.expanded = !job.expanded;
    if (job.expanded && !job.submissions?.length && !job.loadingSubmissions) {
      this.loadJobData(job);
    }
  }

  applyFilters(): void {
    let result = [...this.jobs];

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      result = result.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.department?.toLowerCase().includes(q) ||
          j.location?.toLowerCase().includes(q)
      );
    }
    if (this.statusFilter !== 'all')
      result = result.filter((j) => j.status === this.statusFilter);
    if (this.testFilter === 'rh')
      result = result.filter((j) => j.testAssignments?.rhTest?.enabled);
    else if (this.testFilter === 'technical')
      result = result.filter((j) => j.testAssignments?.technicalTest?.enabled);
    else if (this.testFilter === 'both')
      result = result.filter(
        (j) => j.testAssignments?.rhTest?.enabled && j.testAssignments?.technicalTest?.enabled
      );

    this.filteredJobs = result;
  }

  openCandidateDetail(candidate: CandidateRow, job: JobSummary): void {
    this.selectedCandidate = candidate;
    this.selectedJob = job;
    this.showCandidateModal = true;
  }

  closeModal(): void {
    this.showCandidateModal = false;
    this.selectedCandidate = null;
    this.selectedJob = null;
  }

  getCandidatesForJob(job: JobSummary): CandidateRow[] {
    return job.candidates || [];
  }

  countSubmissionsByKind(subs: TestSubmission[] | undefined, kind: 'rh' | 'technical'): number {
    return (subs || []).filter((s) => s.testKind === kind).length;
  }

  getCandidateRhSub(candidateId: string, subs: TestSubmission[] | undefined): TestSubmission | null {
    return (
      (subs || []).find(
        (s) => s.testKind === 'rh' && String(s.candidate._id) === String(candidateId)
      ) || null
    );
  }

  getCandidateTechSub(candidateId: string, subs: TestSubmission[] | undefined): TestSubmission | null {
    return (
      (subs || []).find(
        (s) => s.testKind === 'technical' && String(s.candidate._id) === String(candidateId)
      ) || null
    );
  }

  getCandidateAvgScore(candidateId: string, subs: TestSubmission[] | undefined): number | null {
    const candSubs = (subs || []).filter(
      (s) => String(s.candidate._id) === String(candidateId) && s.score !== null
    );
    if (!candSubs.length) return null;
    return Math.round(candSubs.reduce((a, s) => a + (s.score ?? 0), 0) / candSubs.length);
  }

  getRhScores(subs: TestSubmission[] | undefined): number[] {
    return (subs || [])
      .filter((s) => s.testKind === 'rh' && s.score !== null)
      .map((s) => s.score!);
  }

  getTechScores(subs: TestSubmission[] | undefined): number[] {
    return (subs || [])
      .filter((s) => s.testKind === 'technical' && s.score !== null)
      .map((s) => s.score!);
  }

  getScoreDist(
    subs: TestSubmission[] | undefined,
    kind: 'rh' | 'technical'
  ): { high: number; mid: number; low: number } {
    const scores = (subs || [])
      .filter((s) => s.testKind === kind && s.score !== null)
      .map((s) => s.score!);
    if (!scores.length) return { high: 0, mid: 0, low: 0 };
    const high = scores.filter((s) => s >= 70).length;
    const mid = scores.filter((s) => s >= 45 && s < 70).length;
    const low = scores.filter((s) => s < 45).length;
    return { high, mid, low };
  }

  getCandidateFunnel(candidates: CandidateRow[]): { label: string; count: number; barHeight: number; colorClass: string }[] {
    const statuses = ['Pending', 'In Review', 'Interview', 'Accepted', 'Rejected'];
    const colors = [
      'funnel-pending',
      'funnel-review',
      'funnel-interview',
      'funnel-accepted',
      'funnel-rejected',
    ];
    const counts = statuses.map((s) => candidates.filter((c) => c.applicationStatus === s).length);
    const max = Math.max(...counts, 1);
    return statuses.map((label, i) => ({
      label,
      count: counts[i],
      barHeight: Math.round((counts[i] / max) * 60) + 8,
      colorClass: colors[i],
    }));
  }

  getBreakdownEntries(breakdown: Record<string, any>): { key: string; value: any }[] {
    if (!breakdown) return [];
    const skip = new Set([
      'total', 'qcm', 'code', 'reason', 'pendingCodeReview', 'allPassed',
      'testsPassed', 'testsTotal', 'complexityTime', 'complexitySpace',
      'timeEfficiency', 'spaceEfficiency', 'manualNotes',
    ]);
    return Object.entries(breakdown)
      .filter(([k, v]) => !skip.has(k) && typeof v === 'number' && v >= 0 && v <= 100)
      .map(([key, value]) => ({ key, value: Math.round(value as number) }));
  }

  getInitials(name: string): string {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }

  dotClass(status: string): string {
    const map: Record<string, string> = {
      open: 'rp-dot--open', draft: 'rp-dot--draft',
      paused: 'rp-dot--paused', closed: 'rp-dot--closed',
    };
    return map[status] ?? 'rp-dot--draft';
  }

  statusTagClass(status: string): string {
    const map: Record<string, string> = {
      open: 'tag--open', draft: 'tag--draft',
      paused: 'tag--paused', closed: 'tag--closed',
    };
    return map[status] ?? 'tag--draft';
  }

  scoreBadgeClass(score: number | null | undefined): string {
    if (score === null || score === undefined) return '';
    if (score >= 70) return 'score--high';
    if (score >= 45) return 'score--mid';
    return 'score--low';
  }

  appStatusClass(status: string): string {
    const map: Record<string, string> = {
      Pending: 'app-pending', 'In Review': 'app-review',
      Interview: 'app-interview', Accepted: 'app-accepted', Rejected: 'app-rejected',
    };
    return map[status] ?? 'app-pending';
  }

  subStatusClass(status: string): string {
    const map: Record<string, string> = {
      evaluated: 'sub--evaluated', submitted: 'sub--submitted', pending_review: 'sub--review',
    };
    return map[status] ?? '';
  }

  trackByJob(_: number, j: JobSummary): string { return j._id; }
  trackByCandidate(_: number, c: CandidateRow): string { return c._id; }
}