import { Component, OnInit, OnDestroy } from '@angular/core';
import { forkJoin, Subject } from 'rxjs';
import { takeUntil, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

import { JobOfferService, JobOffer } from '../../../_services/job-offer.service';
import { SubmissionService, TestSubmission } from '../../../_services/submission.service';
import { CandidateService } from '../../../_services/candidate.service';

export interface PipelineStage {
  label: string;
  count: number;
  color: string;
}

export interface ProcessStep {
  name: string;
  desc: string;
  count: number;
  color: string;
  bg: string;
}

export interface DashboardMetrics {
  totalCandidates: number;
  openJobs: number;
  totalSubmissions: number;
  pendingReview: number;
  avgRhScore: number;
}

@Component({
  selector: 'app-global-dashboard',
  templateUrl: './global-dashboard.component.html',
  styleUrls: ['./global-dashboard.component.scss'],
})
export class GlobalDashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  loading = true;
  error: string | null = null;

  metrics: DashboardMetrics = {
    totalCandidates: 0,
    openJobs: 0,
    totalSubmissions: 0,
    pendingReview: 0,
    avgRhScore: 0,
  };

  jobs: JobOffer[] = [];
  recentSubmissions: TestSubmission[] = [];

  pipeline: PipelineStage[] = [
    { label: 'Applied',    count: 0, color: '#378ADD' },
    { label: 'Tests sent', count: 0, color: '#7F77DD' },
    { label: 'Submitted',  count: 0, color: '#EF9F27' },
    { label: 'Evaluated',  count: 0, color: '#1D9E75' },
    { label: 'Interview',  count: 0, color: '#639922' },
    { label: 'Accepted',   count: 0, color: '#3B9E3B' },
  ];

  processSteps: ProcessStep[] = [
    { name: 'Job posting',   desc: 'Create & publish offer',   count: 0, color: '#378ADD', bg: '#E6F1FB' },
    { name: 'Applications',  desc: 'Candidates apply',         count: 0, color: '#7F77DD', bg: '#EEEDFE' },
    { name: 'CV screening',  desc: 'AI-powered matching',      count: 0, color: '#EF9F27', bg: '#FAEEDA' },
    { name: 'RH test',       desc: 'Psychometric evaluation',  count: 0, color: '#1D9E75', bg: '#E1F5EE' },
    { name: 'Technical test',desc: 'Code & QCM',               count: 0, color: '#534AB7', bg: '#EEEDFE' },
    { name: 'Interview',     desc: 'Final stage',              count: 0, color: '#639922', bg: '#EAF3DE' },
  ];

  /** Submission status counts for chart */
  statusCounts = { submitted: 0, evaluated: 0, pending_review: 0 };

  /** RH model distribution */
  rhModelCounts: { label: string; count: number; color: string }[] = [
    { label: 'DISC',     count: 0, color: '#7F77DD' },
    { label: 'MBTI',     count: 0, color: '#378ADD' },
    { label: 'Big Five', count: 0, color: '#1D9E75' },
    { label: 'EQ-i',     count: 0, color: '#EF9F27' },
    { label: 'Custom',   count: 0, color: '#888780' },
  ];

  /** Technical test type distribution */
  techTypeCounts: { label: string; count: number; color: string }[] = [
    { label: 'Problem solving', count: 0, color: '#378ADD' },
    { label: 'QCM',             count: 0, color: '#1D9E75' },
    { label: 'Mixed',           count: 0, color: '#EF9F27' },
  ];

  constructor(
    private jobService: JobOfferService,
    private submissionService: SubmissionService,
    private candidateService: CandidateService,
  ) {}

  ngOnInit(): void {
    this.loadDashboard();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadDashboard(): void {
    this.loading = true;

    forkJoin({
      jobs: this.jobService.getJobs().pipe(catchError(() => of([]))),
      submissions: this.submissionService.getRhSubmissions().pipe(catchError(() => of([]))),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ jobs, submissions }) => {
          this.processJobs(jobs);
          this.processSubmissions(submissions);
          this.loading = false;
        },
        error: (err) => {
          this.error = 'Failed to load dashboard data.';
          this.loading = false;
          console.error(err);
        },
      });
  }

  private processJobs(jobs: JobOffer[]): void {
    this.jobs = jobs.slice(0, 7);

    const open = jobs.filter(j => j.status === 'open').length;
    this.metrics.openJobs = open;
    this.metrics.totalCandidates = jobs.reduce((s, j) => s + (j.applicationsCount ?? 0), 0);

    // Pipeline: Applied = total applicants
    this.pipeline[0].count = this.metrics.totalCandidates;

    // Process steps
    this.processSteps[0].count = jobs.length;
    this.processSteps[1].count = this.metrics.totalCandidates;
  }

  private processSubmissions(submissions: TestSubmission[]): void {
    this.recentSubmissions = submissions.slice(0, 6);
    this.metrics.totalSubmissions = submissions.length;

    const pending = submissions.filter(s => s.status === 'pending_review').length;
    const evaluated = submissions.filter(s => s.status === 'evaluated').length;
    const submitted = submissions.filter(s => s.status === 'submitted').length;

    this.metrics.pendingReview = pending;
    this.statusCounts = { submitted, evaluated, pending_review: pending };

    // Avg RH score
    const scored = submissions.filter(s => s.score !== null && s.testKind === 'rh');
    if (scored.length) {
      this.metrics.avgRhScore = Math.round(
        scored.reduce((sum, s) => sum + (s.score ?? 0), 0) / scored.length
      );
    }

    // Pipeline
    this.pipeline[2].count = submissions.length;
    this.pipeline[3].count = evaluated;

    // Process steps
    this.processSteps[3].count = submissions.filter(s => s.testKind === 'rh').length;
    this.processSteps[4].count = submissions.filter(s => s.testKind === 'technical').length;
  }

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      submitted: 'badge-sub',
      evaluated: 'badge-eval',
      pending_review: 'badge-rev',
    };
    return map[status] ?? 'badge-sub';
  }

  getJobStatusClass(status: string | undefined): string {
    const map: Record<string, string> = {
      open: 'badge-open',
      paused: 'badge-paused',
      draft: 'badge-draft',
      closed: 'badge-closed',
    };
    return map[status ?? 'draft'] ?? 'badge-draft';
  }

  getInitials(name: string | undefined): string {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  /** Percentage width for mini score bar */
  scoreWidth(score: number | null): string {
    return `${score ?? 0}%`;
  }

  scoreColor(score: number | null): string {
    if (score === null) return '#D3D1C7';
    if (score >= 80) return '#1D9E75';
    if (score >= 60) return '#EF9F27';
    return '#E24B4A';
  }

  reload(): void {
    this.loadDashboard();
  }
}