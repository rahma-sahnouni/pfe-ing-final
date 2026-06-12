import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { CandidateService } from '../../_services/candidate.service'; // Adapter le chemin

export interface QcmOption {
  _id?: string;
  text: string;
  isCorrect: boolean;
}

export interface QcmQuestion {
  _id?: string;
  questionText: string;
  type: 'single_choice' | 'multiple_choice' | 'open';
  options: QcmOption[];
  correctAnswer?: string;
  points: number;
}

export interface TechnicalTest {
  _id: string;
  title: string;
  description?: string;
  testType: 'problem_solving' | 'qcm' | 'mixed';
  difficulty: 'easy' | 'medium' | 'hard';
  timeLimitMinutes: number;
  tags?: string[];
  problemSolving?: {
    examples: { input: string; output: string; explanation?: string }[];
    constraints?: { label: string }[];
    expectedComplexity?: string;
  };
  qcm?: { questions: QcmQuestion[] };
  createdAt?: string;
}

export interface QcmAnswer {
  questionId: string;
  selectedOptions: string[];
  openText?: string;
}

export interface Candidate {
  _id: string;
  name: string;
  email: string;
  avatarColor: string;
}

export interface Job {
  _id: string;
  title: string;
  department: string;
}

export type AntiCheatEventType =
  | 'focus_loss' | 'focus_gain' | 'tab_hidden' | 'tab_visible'
  | 'paste_detected' | 'copy_detected' | 'cut_detected' | 'right_click';

export interface AntiCheatEvent {
  type: AntiCheatEventType;
  timestamp: string;
  timeLabel: string;
  count?: number;
  detail?: string;
}

export interface AntiCheatReport {
  riskLevel: 'low' | 'medium' | 'high';
  totalSuspiciousEvents: number;
  focusLosses: number;
  tabChanges: number;
  pastes: number;
  focusGains: number;
  events: AntiCheatEvent[];
}

export interface Submission {
  _id: string;
  candidate: Candidate;
  job: Job;
  technicalTest: TechnicalTest;
  testKind: string;
  code: string | null;
  language?: string | null;
  qcmAnswers: QcmAnswer[];
  score: number | null;
  maxScore: number | null;
  scoreBreakdown: Record<string, number | string>;
  status: 'submitted' | 'evaluated' | 'pending_review';
  submittedAt: string;
  evaluatedAt: string | null;
  timeSpentSeconds?: number | null;
  antiCheatReport?: AntiCheatReport | null;
  // Champs pour la décision technique
  techStatus?: 'pending' | 'approved' | 'rejected';
  techApproved?: boolean;
  rhApproved?: boolean;
}

@Component({
  selector: 'app-tech-tests-details',
  standalone: false,
  templateUrl: './tech-tests-details.component.html',
  styleUrls: ['./tech-tests-details.component.css']
})
export class TechTestsDetailsComponent implements OnInit {

  test: TechnicalTest | null = null;
  submissions: Submission[] = [];
  selectedSubmission: Submission | null = null;

  loading = true;
  error: string | null = null;
  codeExpanded = false;

  activeTab: 'responses' | 'summary' | 'anticheat' = 'responses';
  activeEventFilter: 'all' | AntiCheatEventType = 'all';

  // Modal décision technique
  showDecisionModal = false;
  decisionSubmission: Submission | null = null;
  loadingAction = false;

  private testId!: string;
  private readonly base = 'http://localhost:3000/api';
  readonly Math = Math;

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router,
    private candidateSvc: CandidateService
  ) {}

  ngOnInit(): void {
    this.testId = this.route.snapshot.paramMap.get('testId')!;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    const test$ = this.http.get<TechnicalTest>(`${this.base}/technical-tests/${this.testId}`);
    const subs$ = this.http.get<Submission[]>(`${this.base}/submissions/technical`);
    forkJoin({ test: test$, subs: subs$ }).subscribe({
      next: ({ test, subs }) => {
        this.test = test;
        this.submissions = subs.filter(
          s => s.technicalTest?._id === this.testId || (s.technicalTest as any) === this.testId
        );
        if (this.submissions.length > 0) this.selectSubmission(this.submissions[0]);
        this.loadApprovalStatuses();
        this.loading = false;
      },
      error: err => {
        this.error = err.error?.message || 'Failed to load data.';
        this.loading = false;
      }
    });
  }

  private loadApprovalStatuses(): void {
    const jobIds = [...new Set(this.submissions.map(s => s.job?._id).filter(Boolean))];
    for (const jobId of jobIds) {
      this.http.get<{ candidates: any[] }>(`${this.base}/candidates/by-job/${jobId}`).subscribe({
        next: ({ candidates }) => {
          this.submissions = this.submissions.map(s => {
            if (s.job?._id !== jobId) return s;
            const match = candidates.find(c => c._id === s.candidate?._id);
            if (!match) return s;
            return {
              ...s,
              techApproved: match.techStatus === 'approved',
              techStatus: match.techStatus ?? 'pending',
              rhApproved: match.rhApproved === 'approved',
            };
          });
          if (this.showDecisionModal && this.decisionSubmission) {
            const updated = this.submissions.find(s => s._id === this.decisionSubmission!._id);
            if (updated) this.decisionSubmission = { ...updated };
          }
          if (this.selectedSubmission) {
            const updatedSelected = this.submissions.find(s => s._id === this.selectedSubmission!._id);
            if (updatedSelected) this.selectedSubmission = { ...updatedSelected };
          }
        },
        error: (err) => console.warn('[loadApprovalStatuses]', err.message),
      });
    }
  }

  selectSubmission(sub: Submission): void {
    this.selectedSubmission = sub;
    this.codeExpanded = false;
    this.showDecisionModal = false;
    this.decisionSubmission = null;
    this.activeTab = 'responses';
    this.activeEventFilter = 'all';
  }

  // ── QCM ─────────────────────────────────────────────────────────────────────

  getQuestionAnswer(q: QcmQuestion): QcmAnswer | undefined {
    if (!this.selectedSubmission || !q._id) return undefined;
    return this.selectedSubmission.qcmAnswers.find(a => a.questionId === q._id);
  }

  isOptionSelected(q: QcmQuestion, opt: QcmOption): boolean {
    const ans = this.getQuestionAnswer(q);
    if (!ans || !opt._id) return false;
    return ans.selectedOptions.includes(opt._id);
  }

  isQuestionCorrect(q: QcmQuestion): boolean | null {
    if (q.type === 'open') return null;
    const ans = this.getQuestionAnswer(q);
    if (!ans) return null;
    const correctIds = q.options.filter(o => o.isCorrect).map(o => o._id!);
    const selected   = ans.selectedOptions ?? [];
    return (
      correctIds.length === selected.length &&
      correctIds.every(id => selected.includes(id)) &&
      selected.every(id => correctIds.includes(id))
    );
  }

  getQuestionPoints(q: QcmQuestion): { earned: number; max: number } {
    const correct = this.isQuestionCorrect(q);
    return { earned: correct === true ? (q.points ?? 1) : 0, max: q.points ?? 1 };
  }

  // ── Score ────────────────────────────────────────────────────────────────────

  getScoreColor(score: number | null): string {
    if (score === null) return '#888780';
    if (score >= 80) return '#1D9E75';
    if (score >= 60) return '#EF9F27';
    if (score >= 40) return '#f97316';
    return '#E24B4A';
  }

  getScoreLabel(score: number | null): string {
    if (score === null) return 'N/A';
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Poor';
  }

  getDiffColor(d: string): string {
    return ({ easy: '#1D9E75', medium: '#EF9F27', hard: '#E24B4A' } as any)[d] ?? '#888780';
  }

  getDiffBg(d: string): string {
    return ({ easy: '#E1F5EE', medium: '#FAEEDA', hard: '#FCEBEB' } as any)[d] ?? '#F1EFE8';
  }

  // ── Summary ──────────────────────────────────────────────────────────────────

  isTopCandidate(sub: Submission): boolean {
    if (sub.score === null) return false;
    const scored = this.submissions.filter(s => s.score !== null);
    if (!scored.length) return false;
    return sub.score === Math.max(...scored.map(s => s.score!));
  }

  getRank(sub: Submission): number | null {
    if (sub.score === null) return null;
    const sorted = [...this.submissions]
      .filter(s => s.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const idx = sorted.findIndex(s => s._id === sub._id);
    return idx === -1 ? null : idx + 1;
  }

  getTimeSpent(sub: Submission): string {
    if (!sub.timeSpentSeconds) return '—';
    const m   = Math.floor(sub.timeSpentSeconds / 60);
    const sec = sub.timeSpentSeconds % 60;
    return `${m} min ${sec}s`;
  }

  hasBreakdown(bd: Record<string, number | string>): boolean {
    return Object.keys(bd).length > 0;
  }

  getTestsPassedPct(bd: Record<string, number | string>): number {
    const passed = Number(bd['testsPassed'] ?? 0);
    const total  = Number(bd['testsTotal']  ?? 0);
    return total > 0 ? Math.round((passed / total) * 100) : 0;
  }

  // ── Anti-cheat ───────────────────────────────────────────────────────────────

  get antiCheatReport(): AntiCheatReport | null {
    return this.selectedSubmission?.antiCheatReport ?? null;
  }

  get antiCheatRisk(): 'none' | 'low' | 'medium' | 'high' {
    const r = this.antiCheatReport;
    if (!r || r.totalSuspiciousEvents === 0) return 'none';
    return r.riskLevel;
  }

  get antiCheatRiskLabel(): string {
    const map: Record<string, string> = {
      none: 'AUCUN RISQUE DÉTECTÉ', low: 'RISQUE FAIBLE',
      medium: 'RISQUE MOYEN', high: 'RISQUE ÉLEVÉ',
    };
    return map[this.antiCheatRisk] ?? '';
  }

  get filteredEvents(): AntiCheatEvent[] {
    const events = this.antiCheatReport?.events ?? [];
    if (this.activeEventFilter === 'all') return events;
    return events.filter(e => e.type === this.activeEventFilter);
  }

  getAntiCheatRisk(sub: Submission): 'none' | 'low' | 'medium' | 'high' {
    const r = sub.antiCheatReport;
    if (!r || r.totalSuspiciousEvents === 0) return 'none';
    return r.riskLevel;
  }

  getRiskLabel(risk: string): string {
    const map: Record<string, string> = {
      low: 'Faible', medium: 'Moyen', high: 'HIGH', none: ''
    };
    return map[risk] ?? risk;
  }

  getEventLabel(type: AntiCheatEventType): string {
    const map: Record<AntiCheatEventType, string> = {
      focus_loss: 'Perte de focus', focus_gain: 'Regain de focus',
      tab_hidden: "Changement d'onglet", tab_visible: 'Onglet visible',
      paste_detected: 'Collage détecté', copy_detected: 'Copie détectée',
      cut_detected: 'Couper détecté', right_click: 'Clic droit',
    };
    return map[type] ?? type;
  }

  getEventIconClass(type: AntiCheatEventType): string {
    const map: Partial<Record<AntiCheatEventType, string>> = {
      focus_loss: 'icon-loss', tab_hidden: 'icon-tab',
      focus_gain: 'icon-gain', tab_visible: 'icon-tab',
      paste_detected: 'icon-paste', copy_detected: 'icon-copy',
      cut_detected: 'icon-copy', right_click: 'icon-click',
    };
    return map[type] ?? '';
  }

  getEventEmoji(type: AntiCheatEventType): string {
    const map: Record<AntiCheatEventType, string> = {
      focus_loss: '👁‍🗨', focus_gain: '👁', tab_hidden: '🗂', tab_visible: '🗂',
      paste_detected: '📋', copy_detected: '📄', cut_detected: '✂', right_click: '🖱',
    };
    return map[type] ?? '⚠';
  }

  // ── Modal décision technique ─────────────────────────────────────────────────

  openDecisionModal(sub: Submission): void {
    const latest = this.submissions.find(s => s._id === sub._id);
    if (!latest) return;
    this.decisionSubmission = { ...latest };
    this.showDecisionModal = true;
  }

  closeDecisionModal(): void {
    this.showDecisionModal = false;
    this.decisionSubmission = null;
    this.loadingAction = false;
  }

  approveFromModal(): void {
    if (!this.decisionSubmission) return;
    const candId = this.decisionSubmission.candidate?._id;
    const jobId = this.decisionSubmission.job?._id;
    if (!candId || !jobId) {
      alert('Missing candidate or job information.');
      return;
    }
    this.loadingAction = true;
    this.candidateSvc.approveTest(candId, jobId, 'technical').subscribe({
      next: () => {
        this.updateLocalStatus(candId, jobId, 'approved');
        this.closeDecisionModal();
        setTimeout(() => this.loadApprovalStatuses(), 500);
      },
      error: (err) => {
        this.loadingAction = false;
        alert(err.error?.message || 'Approval failed.');
      }
    });
  }

  rejectFromModal(): void {
    if (!this.decisionSubmission) return;
    const candId = this.decisionSubmission.candidate?._id;
    const jobId = this.decisionSubmission.job?._id;
    if (!candId || !jobId) {
      alert('Missing candidate or job information.');
      return;
    }
    this.loadingAction = true;
    this.candidateSvc.rejectTest(candId, jobId, 'technical').subscribe({
      next: () => {
        this.updateLocalStatus(candId, jobId, 'rejected');
        this.closeDecisionModal();
        setTimeout(() => this.loadApprovalStatuses(), 500);
      },
      error: (err) => {
        this.loadingAction = false;
        alert(err.error?.message || 'Rejection failed.');
      }
    });
  }

  private updateLocalStatus(candidateId: string, jobId: string, status: 'approved' | 'rejected'): void {
    this.submissions = this.submissions.map(s => {
      if (s.candidate?._id === candidateId && s.job?._id === jobId) {
        return { ...s, techStatus: status, techApproved: status === 'approved' };
      }
      return s;
    });
    if (this.selectedSubmission && this.selectedSubmission.candidate?._id === candidateId && this.selectedSubmission.job?._id === jobId) {
      this.selectedSubmission = { ...this.selectedSubmission, techStatus: status, techApproved: status === 'approved' };
    }
  }

  // ── Misc ─────────────────────────────────────────────────────────────────────

  getInitials(name: string): string {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }

  formatDate(d: string): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  formatTime(d: string): string {
    if (!d) return '';
    return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  getTypeIcon(type: string): string {
    return ({ problem_solving: '⌨', qcm: '☑', mixed: '⚡' } as any)[type] || '📝';
  }

  getTypeLabel(type: string): string {
    return ({ problem_solving: 'Problem Solving', qcm: 'QCM', mixed: 'Mixed' } as any)[type] || type;
  }

  get pendingCount(): number {
    return this.submissions.filter(s => s.status === 'pending_review').length;
  }

  get qcmScore(): { earned: number; max: number } {
    if (!this.test?.qcm?.questions || !this.selectedSubmission) return { earned: 0, max: 0 };
    return this.test.qcm.questions.reduce(
      (acc, q) => {
        const pts = this.getQuestionPoints(q);
        return { earned: acc.earned + pts.earned, max: acc.max + pts.max };
      },
      { earned: 0, max: 0 }
    );
  }

  get qcmPercent(): number {
    const s = this.qcmScore;
    return s.max > 0 ? Math.round((s.earned / s.max) * 100) : 0;
  }

  get strokeDashoffset(): number {
    const score = this.selectedSubmission?.score ?? 0;
    return 201.06 - (201.06 * score / 100);
  }

  goBack(): void {
    this.router.navigate(['/tech/jobs'], { relativeTo: this.route });
  }
}