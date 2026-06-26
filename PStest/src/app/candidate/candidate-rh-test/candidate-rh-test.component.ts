import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, CurrentUser } from '../../_services/auth.service';
import {
  CandidateService,
  RhTest,
  Question,
  JobOfferRef,
} from '../../_services/candidate.service';
import { SubmissionService } from '../../_services/submission.service';
import { AntiCheatService } from '../../_services/anti-cheat.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-candidate-rh-test',
  templateUrl: './candidate-rh-test.component.html',
  styleUrl: './candidate-rh-test.component.css',
})
export class CandidateRhTestComponent implements OnInit, AfterViewInit, OnDestroy {
  currentUser: CurrentUser | null = null;

  loading    = true;
  error      = '';
  submitted  = false;
  submitting = false;
  allDone    = false;

  elapsedSeconds = 0;
  private timerRef: any = null;

  jobId:  string = '';
  testId: string = '';

  rhTest: RhTest | null = null;
jobOffer: JobOfferRef | null = null;

  rhAnswers: Record<string, any> = {};
  dragRankOrder: Record<string, string[]> = {};
  private draggedItem: string | null = null;

  antiCheatCount = 0;
  antiCheatRisk: 'low' | 'medium' | 'high' = 'low';
  private destroy$ = new Subject<void>();

  constructor(
    private route:        ActivatedRoute,
    private router:       Router,
    private authService:  AuthService,
    private testsService: CandidateService,
    private submissionService: SubmissionService,
    private antiCheat: AntiCheatService,
  ) {}

  ngOnInit(): void {
    this.authService.getMe().subscribe({
      next:  (res) => { this.currentUser = res.user; },
      error: ()    => { this.currentUser = null; },
    });

    this.jobId  = this.route.snapshot.paramMap.get('jobId')  ?? '';
    this.testId = this.route.snapshot.paramMap.get('testId') ?? '';
    this.loadTest();
  }

  ngAfterViewInit(): void {
    this.antiCheat.start();
    this.antiCheat.event$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      const report = this.antiCheat.getReport();
      this.antiCheatCount = report.totalSuspiciousEvents;
      this.antiCheatRisk  = report.riskLevel;
    });
  }

  // ── Data Loading ────────────────────────────────────────────────────────────

  private loadTest(): void {
    this.testsService.getMyTests().subscribe({
      next: (data) => {
        const job = data.jobs.find((j: any) => j.jobOffer._id === this.jobId);
        if (!job) {
          this.error   = 'Job not found.';
          this.loading = false;
          return;
        }
        this.jobOffer = job.jobOffer;
        const test = job.rhTests.find((t: RhTest) => t._id === this.testId);
        if (!test) {
          this.error   = 'RH test not found.';
          this.loading = false;
          return;
        }
        this.rhTest   = test;
        this.submitted = job.submittedRhIds?.includes(this.testId) ?? false;
        this.loading   = false;
        if (!this.submitted) this.startTimer();
      },
      error: (err) => {
        this.error   = err.message || 'Failed to load test.';
        this.loading = false;
      },
    });
  }

  // ── Answers ─────────────────────────────────────────────────────────────────

  getRhAnswer(questionId: string): any { return this.rhAnswers[questionId]; }

  setRhAnswer(questionId: string, value: any): void {
    this.rhAnswers[questionId] = value;
  }

  likertValue(questionId: string): number {
    return this.rhAnswers[questionId] ?? 0;
  }

  setLikert(questionId: string, val: number): void {
    this.rhAnswers[questionId] = val;
  }

  isMultiSelected(questionId: string, optionText: string): boolean {
    return (this.rhAnswers[questionId] as string[] ?? []).includes(optionText);
  }

  toggleMulti(questionId: string, optionText: string): void {
    let arr: string[] = this.rhAnswers[questionId] ?? [];
    arr = arr.includes(optionText)
      ? arr.filter(x => x !== optionText)
      : [...arr, optionText];
    this.rhAnswers[questionId] = arr;
  }

  rhProgress(): number {
    if (!this.rhTest) return 0;
    const allQs = this.rhTest.themes.flatMap(t => t.models.flatMap(m => m.questions));
    if (!allQs.length) return 100;
    const answered = allQs.filter(q => {
      const a = this.rhAnswers[q._id ?? ''];
      return a !== undefined && a !== null && a !== '' && !(Array.isArray(a) && !a.length);
    }).length;
    return Math.round((answered / allQs.length) * 100);
  }

  // ── Drag & Rank ─────────────────────────────────────────────────────────────

  initDragRank(question: Question): string[] {
    const id = question._id ?? '';
    if (!this.dragRankOrder[id]) {
      this.dragRankOrder[id] = question.options.map(o => o.text);
    }
    return this.dragRankOrder[id];
  }

  onDragStart(item: string): void { this.draggedItem = item; }

  onDragOver(event: DragEvent): void { event.preventDefault(); }

  onDrop(questionId: string, targetItem: string): void {
    if (!this.draggedItem || this.draggedItem === targetItem) return;
    const order   = [...this.dragRankOrder[questionId]];
    const fromIdx = order.indexOf(this.draggedItem);
    const toIdx   = order.indexOf(targetItem);
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, this.draggedItem!);
    this.dragRankOrder[questionId] = order;
    this.rhAnswers[questionId]     = order;
    this.draggedItem               = null;
  }

  // ── Submission ──────────────────────────────────────────────────────────────

  submit(): void {
    if (!this.rhTest || this.submitted || this.submitting) return;
    this.submitting = true;

    const payload = {
      answers: Object.entries(this.rhAnswers).map(([questionId, value]) => ({ questionId, value })),
    };

    this.submissionService.submitRhAnswers(this.rhTest._id, payload).subscribe({
      next: () => {
        this.submitted  = true;
        this.submitting = false;
        this.stopTimer();
        setTimeout(() => this.router.navigate(['/candidate/my-journey']), 1500);
      },
      error: (err) => {
        console.error('RH submit error', err);
        this.submitting = false;
      },
    });
  }

  // ── Timer ────────────────────────────────────────────────────────────────────

  // ── Timer ────────────────────────────────────────────────────────────────────

  get hasLimit(): boolean { return (this.rhTest?.timeLimitMinutes ?? 0) > 0; }

  private get totalSeconds(): number {
    return (this.rhTest?.timeLimitMinutes ?? 0) * 60;
  }

  get remainingSeconds(): number {
    return Math.max(0, this.totalSeconds - this.elapsedSeconds);
  }

  get timerProgress(): number {
    if (!this.totalSeconds) return 100;
    return (this.remainingSeconds / this.totalSeconds) * 100;
  }

  get timerWarning(): boolean {
    return this.hasLimit && this.remainingSeconds <= this.totalSeconds * 0.25;
  }

  get timerDanger(): boolean {
    return this.hasLimit && this.remainingSeconds <= this.totalSeconds * 0.1;
  }

  formatRemaining(): string {
    const rem = this.remainingSeconds;
    const m = Math.floor(rem / 60).toString().padStart(2, '0');
    const s = (rem % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  private startTimer(): void {
    this.timerRef = setInterval(() => {
      this.elapsedSeconds++;
      if (this.hasLimit && this.elapsedSeconds >= this.totalSeconds) {
        this.stopTimer();
        this.submit();
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerRef) { clearInterval(this.timerRef); this.timerRef = null; }
  }

  ngOnDestroy(): void {
    this.stopTimer();
    this.antiCheat.stop();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  trackByIdx(i: number): number { return i; }

  goBack(): void {
    this.router.navigate(['/candidate/my-journey']);
  }
}