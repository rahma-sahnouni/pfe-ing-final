// rh-test-results.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { SubmissionService, TestSubmission} from '../../_services/submission.service';
import { CandidateService } from '../../_services/candidate.service';
import { Router, ActivatedRoute } from '@angular/router';


export interface CriterionScore {
  key:        string;
  label:      string;
  color:      string;
  percentage: number;
}

export interface QaPair {
  question:   string;
  answerType: string;
  answer:     string;
}
interface GroupedByJob {
  jobId: string;
  jobTitle: string;
  department: string;
  candidates: CandidateResult[];
}

interface CandidateResult {
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  avatarColor: string;
  submissions: TestSubmission[];
  latestScore: number | null;
  status: string;
  rhApproved: boolean;
  techApproved: boolean;
}

@Component({
  selector: 'app-rh-test-results',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rh-test-results.component.html',
  styleUrl: './rh-test-results.component.css',
})
export class RhTestResultsComponent implements OnInit {
  grouped:  GroupedByJob[] = [];
  filtered: GroupedByJob[] = [];
  loading = true;
  error: string | null = null;

  searchQuery  = '';
  statusFilter = 'all';

  expandedJobs       = new Set<string>();
  expandedCandidates = new Set<string>();

  /* RH Decision modal (replaces manual scoring) */
  showDecisionModal = false;
  selectedSubmission: TestSubmission | null = null;
  selectedCandidate: CandidateResult | null = null;
  selectedJobId: string | null = null;
  loadingAction = false;

  approving = false;

  private readonly MODEL_CRITERIA_KEYS: Record<string, string[]> = {
    disc:     ['D', 'I', 'S', 'C'],
    mbti:     ['E_I', 'S_N', 'T_F', 'J_P'],
    big_five: ['O', 'E', 'A', 'N'],
    eq_i:     ['self_awareness', 'self_regulation', 'motivation', 'empathy', 'social_skills'],
  };

  private readonly BUILTIN_CRITERIA: Record<string, { label: string; color: string }> = {
    D:   { label: 'Dominance',                    color: '#ef4444' },
    I:   { label: 'Influence',                    color: '#f97316' },
    S:   { label: 'Steadiness',                   color: '#22c55e' },
    C:   { label: 'Conscientiousness',            color: '#3b82f6' },
    E_I: { label: 'Extraversion / Introversion',  color: '#8b5cf6' },
    S_N: { label: 'Sensing / Intuition',          color: '#06b6d4' },
    T_F: { label: 'Thinking / Feeling',           color: '#f59e0b' },
    J_P: { label: 'Judging / Perceiving',         color: '#ec4899' },
    O:   { label: 'Openness',                     color: '#6366f1' },
    E:   { label: 'Extraversion',                 color: '#f97316' },
    A:   { label: 'Agreeableness',                color: '#22c55e' },
    N:   { label: 'Neuroticism',                  color: '#ef4444' },
    self_awareness:  { label: 'Self-Awareness',   color: '#8b5cf6' },
    self_regulation: { label: 'Self-Regulation',  color: '#06b6d4' },
    motivation:      { label: 'Motivation',       color: '#f59e0b' },
    empathy:         { label: 'Empathy',          color: '#ec4899' },
    social_skills:   { label: 'Social Skills',    color: '#22c55e' },
    likert:          { label: 'Likert (global)',  color: '#94a3b8' },
  };

  constructor(
    private submissionSvc: SubmissionService,
    private candidateSvc: CandidateService,
    private http: HttpClient,
      private route: ActivatedRoute,   
      private router: Router

  ) {}

  ngOnInit() {
  this.route.queryParams.subscribe(params => {
    const jobId = params['jobId'];
    if (jobId) {
      this.preFilterJobId = jobId;        // store it
      this.expandedJobs.add(jobId);       // auto-expand that job
    }
    this.loadSubmissions();
  });
}

// Add this property near the top of the class:
preFilterJobId: string | null = null;

  /* ════════ Data loading ════════ */
  loadSubmissions() {
    this.loading = true;
    this.error   = null;
    this.submissionSvc.getRhSubmissions().subscribe({
      next: (submissions) => {
        this.grouped = this.groupByJob(submissions);
        this.loadApprovalStatuses();
        this.applyFilters();
        this.loading = false;
        if (this.grouped.length === 1) this.expandedJobs.add(this.grouped[0].jobId);
      },
      error: (err) => {
        this.error   = err?.error?.message || 'Failed to load submissions.';
        this.loading = false;
      },
    });
  }

private loadApprovalStatuses() {
  for (const job of this.grouped) {
    this.http.get<{ candidates: any[] }>(`http://localhost:3000/api/candidates/by-job/${job.jobId}`)
      .subscribe({
        next: ({ candidates }) => {
          for (const cand of job.candidates) {
            const match = candidates.find(c => c._id === cand.candidateId);
            if (match) {
              // ✅ rhApproved est une string ('pending' | 'approved' | 'rejected')
              cand.rhApproved   = match.rhApproved === 'approved';
              cand.techApproved = match.techStatus  === 'approved';
            }
          }
          this.applyFilters();
        },
        error: (err) => console.warn('[loadApprovalStatuses]', err.message),
      });
  }
}
  private groupByJob(submissions: TestSubmission[]): GroupedByJob[] {
    const map = new Map<string, GroupedByJob>();

    for (const sub of submissions) {
          if (!sub.job?._id || !sub.candidate?._id) continue;

      const jobId = sub.job._id;
      if (!map.has(jobId)) {
        map.set(jobId, { jobId, jobTitle: sub.job.title, department: sub.job.department, candidates: [] });
      }
      const job = map.get(jobId)!;
      const candId = sub.candidate._id;
      let cand = job.candidates.find(c => c.candidateId === candId);
      if (!cand) {
        cand = {
          candidateId:    candId,
          candidateName:  sub.candidate.name || sub.candidate.email,
          candidateEmail: sub.candidate.email,
          avatarColor:    sub.candidate.avatarColor,
          submissions:    [],
          latestScore:    null,
          status:         sub.status,
          rhApproved:     false,
          techApproved:   false,
        };
        job.candidates.push(cand);
      }
      cand.submissions.push(sub);

      const evaluated = cand.submissions.filter(s => s.score !== null);
      if (evaluated.length) {
        cand.latestScore = Math.round(
          evaluated.reduce((sum, s) => sum + (s.score ?? 0), 0) / evaluated.length
        );
      }

      const statuses = cand.submissions.map(s => s.status);
      cand.status = statuses.includes('pending_review') ? 'pending_review'
        : statuses.includes('submitted') ? 'submitted'
        : 'evaluated';
    }

    return Array.from(map.values());
  }

  /* ════════ Filters ════════ */
applyFilters() {
  const q = this.searchQuery.toLowerCase().trim();
  this.filtered = this.grouped
    .filter(job => !this.preFilterJobId || job.jobId === this.preFilterJobId)  // ← add this line
    .map(job => ({
      ...job,
      candidates: job.candidates.filter(c => {
        const matchSearch = !q || c.candidateName.toLowerCase().includes(q)
          || c.candidateEmail.toLowerCase().includes(q)
          || job.jobTitle.toLowerCase().includes(q);
        const matchStatus = this.statusFilter === 'all' || c.status === this.statusFilter;
        return matchSearch && matchStatus;
      }),
    }))
    .filter(job => job.candidates.length > 0);
}
goBack() {
  this.router.navigate(['/rh/job-tests']);
}
  /* ════════ Expand/collapse ════════ */
  toggleJob(jobId: string) {
    this.expandedJobs.has(jobId) ? this.expandedJobs.delete(jobId) : this.expandedJobs.add(jobId);
  }
  toggleCandidate(id: string) {
    this.expandedCandidates.has(id) ? this.expandedCandidates.delete(id) : this.expandedCandidates.add(id);
  }
  isJobExpanded(jobId: string)    { return this.expandedJobs.has(jobId); }
  isCandidateExpanded(id: string) { return this.expandedCandidates.has(id); }

  /* ════════ RH Decision Modal ════════ */
  openDecisionModal(sub: TestSubmission, cand: CandidateResult, jobId: string): void {
    this.selectedSubmission = { ...sub };
    this.selectedCandidate  = { ...cand };
    this.selectedJobId      = jobId;
    this.showDecisionModal  = true;
  }

  closeDecisionModal(): void {
    this.showDecisionModal  = false;
    this.selectedSubmission = null;
    this.selectedCandidate  = null;
    this.selectedJobId      = null;
    this.loadingAction      = false;
  }

  approveFromModal(): void {
    if (!this.selectedCandidate || !this.selectedJobId) return;
    this.loadingAction = true;
    this.candidateSvc.approveTest(this.selectedCandidate.candidateId, this.selectedJobId, 'rh').subscribe({
      next: () => {
        // Optimistic update
        for (const job of this.grouped) {
          if (job.jobId !== this.selectedJobId) continue;
          const cand = job.candidates.find(c => c.candidateId === this.selectedCandidate!.candidateId);
          if (cand) cand.rhApproved = true;
        }
        this.applyFilters();
        this.closeDecisionModal();
        setTimeout(() => this.loadSubmissions(), 500);
      },
      error: (err) => {
        this.loadingAction = false;
        alert(err.error?.message || 'Approval failed.');
      }
    });
  }

  rejectFromModal(): void {
    if (!this.selectedCandidate || !this.selectedJobId) return;
    this.loadingAction = true;
    this.candidateSvc.rejectTest(this.selectedCandidate.candidateId, this.selectedJobId, 'rh').subscribe({
      next: () => {
        this.applyFilters();
        this.closeDecisionModal();
        setTimeout(() => this.loadSubmissions(), 500);
      },
      error: (err) => {
        this.loadingAction = false;
        alert(err.error?.message || 'Rejection failed.');
      }
    });
  }

  /* ════════ Approval (inline buttons, kept for candidate row) ════════ */
  approveCandidate(candidateId: string, jobId: string, testKind: 'rh' | 'technical') {
    const label = testKind === 'rh' ? 'RH' : 'Technical';
    if (!confirm(`Approve this candidate for the ${label} test results?`)) return;

    this.approving = true;
    this.candidateSvc.approveTest(candidateId, jobId, testKind).subscribe({
      next: () => {
        this.approving = false;
        for (const job of this.grouped) {
          if (job.jobId !== jobId) continue;
          const cand = job.candidates.find(c => c.candidateId === candidateId);
          if (cand) {
            if (testKind === 'rh')        cand.rhApproved   = true;
            if (testKind === 'technical') cand.techApproved = true;
          }
        }
        this.applyFilters();
        setTimeout(() => this.loadSubmissions(), 800);
      },
      error: (err) => {
        this.approving = false;
        alert(err.error?.message || 'Approval failed.');
      },
    });
  }

  /* ════════ Criterion bars ════════ */
  getCriterionBreakdown(sub: TestSubmission): CriterionScore[] {
    const breakdown = sub.scoreBreakdown ?? {};
    const result: CriterionScore[] = [];
    const seenKeys = new Set<string>();

    for (const theme of sub.rhTest?.themes ?? []) {
      for (const model of (theme.models ?? [])) {
        if (model.modelType === 'custom') {
          for (const cr of (model.customCriteria ?? [])) {
            if (!cr.key || seenKeys.has(cr.key)) continue;
            seenKeys.add(cr.key);
            result.push({
              key: cr.key,
              label: cr.label ?? cr.key,
              color: cr.color ?? '#6366f1',
              percentage: typeof breakdown[cr.key] === 'number' ? breakdown[cr.key] as number : 0,
            });
          }
        } else {
          for (const key of (this.MODEL_CRITERIA_KEYS[model.modelType] ?? [])) {
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            const meta = this.BUILTIN_CRITERIA[key];
            result.push({
              key,
              label: meta?.label ?? key,
              color: meta?.color ?? '#6366f1',
              percentage: typeof breakdown[key] === 'number' ? breakdown[key] as number : 0,
            });
          }
        }
      }
    }

    // Fallback: no rhTest structure → use scoreBreakdown keys as before
    if (result.length === 0) {
      for (const [key, val] of Object.entries(breakdown)) {
        if (key === 'manualNotes' || typeof val !== 'number') continue;
        const meta = this.BUILTIN_CRITERIA[key];
        result.push({ key, label: meta?.label ?? key, color: meta?.color ?? '#6366f1', percentage: val });
      }
    }

    return result.sort((a, b) => b.percentage - a.percentage);
  }

  getDominant(sub: TestSubmission): CriterionScore | null {
    const bars = this.getCriterionBreakdown(sub).filter(c => c.key !== 'likert');
    return bars[0] ?? null;
  }

  getCandidateQA(sub: TestSubmission): QaPair[] {
    if (!sub.rhTest?.themes?.length || !sub.rhAnswers?.length) return [];
    const qMap = new Map<string, any>();
    for (const theme of sub.rhTest.themes) {
      for (const model of theme.models ?? []) {
        for (const q of model.questions ?? []) {
          qMap.set(String(q._id), q);
        }
      }
    }
    return sub.rhAnswers.map(ans => {
      const q = qMap.get(String(ans.questionId));
      if (!q) return null;
      let answerText: string;
      if (q.answerType === 'likert') {
        answerText = `${Number(ans.value)}/5 — (${q.likertMin || 'Strongly Disagree'} → ${q.likertMax || 'Strongly Agree'})`;
      } else if (q.answerType === 'single_choice') {
        const chosen = q.options?.find((o: any) => o.text === ans.value);
        answerText = chosen?.text ?? String(ans.value);
      } else if (q.answerType === 'multiple_choice') {
        const selected = Array.isArray(ans.value) ? ans.value : [ans.value];
        answerText = q.options?.filter((o: any) => selected.includes(o.text)).map((o: any) => o.text).join(', ') ?? String(ans.value);
      } else if (q.answerType === 'drag_rank') {
        const ranked = Array.isArray(ans.value) ? ans.value : [];
        answerText = ranked.map((text: string, i: number) => `${i + 1}. ${text}`).join(' · ');
      } else {
        answerText = String(ans.value);
      }
      return { question: q.text, answerType: q.answerType, answer: answerText };
    }).filter((x): x is QaPair => x !== null);
  }

  /* ════════ Helpers ════════ */
  getScoreColor(score: number | null): string {
    if (score === null) return '#6b7280';
    if (score >= 75)   return '#22c55e';
    if (score >= 50)   return '#f59e0b';
    return '#ef4444';
  }
  getStatusLabel(status: string): string {
    return ({ evaluated: 'Evaluated', submitted: 'Submitted', pending_review: 'Pending Review' } as any)[status] ?? status;
  }
  getStatusClass(status: string): string {
    return ({ evaluated: 'badge-success', submitted: 'badge-info', pending_review: 'badge-warning' } as any)[status] ?? '';
  }
  getInitials(name: string): string {
    return (name ?? '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
  }
  totalCandidates(job: GroupedByJob)  { return job.candidates.length; }
  evaluatedCount(job: GroupedByJob)   { return job.candidates.filter(c => c.status === 'evaluated').length; }
  avgScore(job: GroupedByJob): number | null {
    const scored = job.candidates.filter(c => c.latestScore !== null);
    if (!scored.length) return null;
    return Math.round(scored.reduce((s, c) => s + (c.latestScore ?? 0), 0) / scored.length);
  }

  /* Dominant trait for modal */
  getDominantFromBreakdown(breakdown: Record<string, any> | undefined): { label: string; color: string } | null {
    if (!breakdown) return null;
    const entries = Object.entries(breakdown)
      .filter(([key, val]) => key !== 'manualNotes' && typeof val === 'number' && key !== 'likert');
    if (!entries.length) return null;
    const [topKey] = entries.sort(([, a], [, b]) => (b as number) - (a as number))[0];
    const meta = this.BUILTIN_CRITERIA[topKey];
    return meta ?? { label: topKey, color: '#6366f1' };
  }
}