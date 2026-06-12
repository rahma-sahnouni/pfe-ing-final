import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, CurrentUser } from '../../_services/auth.service';
import {
  TechnicalTest,
  JobOfferRef,
  CandidateService,
} from '../../_services/candidate.service';
import { CodeEditorComponent, ProblemExample } from '../code-editor/code-editor.component';
import { SupportedLanguage, ComplexityResult, TestCaseResult } from '../../_services/code-runner.service';
import { AntiCheatReport } from '../../_services/anti-cheat.service';
import { SubmissionService } from '../../_services/submission.service';

@Component({
  selector: 'app-candidate-tech-test',
  templateUrl: './candidate-tech-test.component.html',
  styleUrl: './candidate-tech-test.component.css',
})
export class CandidateTechTestComponent implements OnInit, OnDestroy {
  currentUser: CurrentUser | null = null;

  loading    = true;
  error      = '';
  submitted  = false;
  submitting = false;

  jobId:  string = '';
  testId: string = '';

  techTest:  TechnicalTest | null = null;
  jobOffer:  JobOfferRef | null   = null;

  // ← FIX: pre-computed once, not re-built on every change detection cycle
  examples: ProblemExample[] = [];

  techAnswers: Record<string, any> = {};

  private antiCheatReport: AntiCheatReport | null = null;

  timer: { remaining: number; intervalId: any; expired: boolean } | null = null;

  constructor(
    private route:             ActivatedRoute,
    private router:            Router,
    private authService:       AuthService,
    private testsService:      CandidateService,
    private submissionService: SubmissionService
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

  ngOnDestroy(): void {
    if (this.timer?.intervalId) clearInterval(this.timer.intervalId);
  }

  // ── Data Loading ─────────────────────────────────────────────────────────────

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

        const test = job.technicalTests.find((t: TechnicalTest) => t._id === this.testId);
        if (!test) {
          this.error   = 'Technical test not found.';
          this.loading = false;
          return;
        }

        this.techTest = test;

        // ← FIX: build examples ONCE here, after techTest is assigned
        this.examples = this.buildExamples();

        this.submitted = job.submittedTechIds?.includes(this.testId) ?? false;
        this.loading   = false;

        if (!this.submitted) {
          this.initTimer();
          this.startTimer();
        }
      },
      error: (err) => {
        this.error   = err.message || 'Failed to load test.';
        this.loading = false;
      },
    });
  }

  // ── Timer ────────────────────────────────────────────────────────────────────

  private initTimer(): void {
    const limitSec = (this.techTest?.timeLimitMinutes ?? 30) * 60;
    this.timer = { remaining: limitSec, intervalId: null, expired: false };
  }

  private startTimer(): void {
    if (!this.timer || this.timer.intervalId || this.timer.expired) return;
    this.timer.intervalId = setInterval(() => {
      this.timer!.remaining--;
      if (this.timer!.remaining <= 0) {
        this.timer!.expired = true;
        clearInterval(this.timer!.intervalId);
        this.autoSubmit();
      }
    }, 1000);
  }

  formatTime(seconds: number): string {
    const abs = Math.abs(seconds);
    const m   = Math.floor(abs / 60).toString().padStart(2, '0');
    const s   = (abs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  get timerDanger(): boolean {
    return (this.timer?.remaining ?? 9999) < 300;
  }

  // ── Answers ──────────────────────────────────────────────────────────────────

  techCode(): string {
    return this.techAnswers['__code'] ?? '';
  }

  isQcmSelected(questionId: string, optionId: string): boolean {
    return (this.techAnswers[questionId] as string[] ?? []).includes(optionId);
  }

  toggleQcmOption(questionId: string, optionId: string, type: string): void {
    const current: string[] = this.techAnswers[questionId] ?? [];
    const next = type === 'single_choice'
      ? current.includes(optionId) ? [] : [optionId]
      : current.includes(optionId)
        ? current.filter(x => x !== optionId)
        : [...current, optionId];
    this.techAnswers = { ...this.techAnswers, [questionId]: next };
  }

  getOpenAnswer(questionId: string): string {
    return this.techAnswers[questionId] ?? '';
  }

  setOpenAnswer(questionId: string, value: string): void {
    this.techAnswers = { ...this.techAnswers, [questionId]: value };
  }

  techProgress(): number {
    if (!this.techTest) return 0;
    const hasPS = this.techTest.testType === 'problem_solving' || this.techTest.testType === 'mixed';
    const qcmQs = this.techTest.qcm?.questions ?? [];
    const total  = qcmQs.length + (hasPS ? 1 : 0);
    if (!total) return 100;

    let answered = qcmQs.filter(q => {
      const val = this.techAnswers[q._id ?? ''];
      return Array.isArray(val) ? val.length > 0 : !!val;
    }).length;
    if (hasPS && this.techCode()) answered++;
    return Math.round((answered / total) * 100);
  }

  // ── Code Editor handlers ──────────────────────────────────────────────────────

  onCodeChange(event: {
    code:        string;
    language:    SupportedLanguage;
    complexity:  ComplexityResult | null;
    testResults: TestCaseResult[];
    score:       number | null;
    allPassed:   boolean;
    antiCheat:   AntiCheatReport | null;
  }): void {
    this.techAnswers = {
      ...this.techAnswers,
      __code:        event.code,
      __language:    event.language,
      __complexity:  event.complexity  ?? null,
      __testResults: event.testResults ?? [],
      __score:       event.score       ?? null,
      __allPassed:   event.allPassed   ?? false,
    };

    if (event.antiCheat !== null && event.antiCheat !== undefined) {
      this.antiCheatReport = event.antiCheat;
    }
  }

  onCodeSolution(event: { code: string; language: SupportedLanguage }): void {
    this.techAnswers = {
      ...this.techAnswers,
      __code:     event.code,
      __language: event.language,
    };
  }

  // ← FIX: now private, called once in loadTest() — not from the template
  private buildExamples(): ProblemExample[] {
    return (this.techTest?.problemSolving?.examples ?? []).map(ex => {
      let parsedInput: Record<string, any>;

      try {
        const raw = typeof ex.input === 'string' ? JSON.parse(ex.input) : ex.input;
        parsedInput = (typeof raw === 'object' && !Array.isArray(raw)) ? raw : { input: raw };
      } catch {
        parsedInput = { input: ex.input };
      }

      // Rétrocompatibilité : si un champ est une chaîne multiligne, le transformer en tableau
      for (const [key, val] of Object.entries(parsedInput)) {
        if (typeof val === 'string' && val.includes('\n')) {
          parsedInput[key] = val.split('\n').map((line: string) => line.trimEnd());
        }
      }

      let parsedOutput: any;
      try {
        parsedOutput = typeof ex.output === 'string' ? JSON.parse(ex.output) : ex.output;
      } catch {
        const arrMatch = String(ex.output).match(/^\[(-?\d+(?:,\s*-?\d+)*)\]$/);
        parsedOutput = arrMatch
          ? arrMatch[1].split(',').map(s => parseInt(s.trim(), 10))
          : ex.output;
      }

      return { input: parsedInput, output: parsedOutput, explanation: ex.explanation };
    });
  }

  // ── Submission ───────────────────────────────────────────────────────────────

  submit(): void {
    if (!this.techTest || this.submitted || this.submitting) return;
    this.submitting = true;

    const totalSeconds     = (this.techTest.timeLimitMinutes) * 60;
    const timeSpentSeconds = this.timer
      ? Math.max(0, totalSeconds - this.timer.remaining)
      : null;

    const payload = {
      code:             this.techAnswers['__code']        ?? null,
      language:         this.techAnswers['__language']    ?? 'javascript',
      complexity:       this.techAnswers['__complexity']  ?? null,
      testResults:      this.techAnswers['__testResults'] ?? [],
      score:            this.techAnswers['__score']       ?? 0,
      allPassed:        this.techAnswers['__allPassed']   ?? false,
      timeSpentSeconds,
      antiCheatReport:  this.antiCheatReport,
      qcmAnswers: Object.entries(this.techAnswers)
        .filter(([k]) => !k.startsWith('__'))
        .map(([questionId, selectedOptions]) => ({ questionId, selectedOptions })),
    };

    this.submissionService.submitTechnicalAnswers(this.testId, payload).subscribe({
      next: () => {
        if (this.timer?.intervalId) clearInterval(this.timer.intervalId);
        this.submitted  = true;
        this.submitting = false;
        setTimeout(() => this.router.navigate(['/candidate/my-journey']), 1500);
      },
      error: err => {
        console.error('Tech submit error', err);
        this.submitting = false;
      },
    });
  }

  private autoSubmit(): void {
    if (!this.submitted) this.submit();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  difficultyLabel(d: string): string {
    return ({ easy: 'Facile', medium: 'Moyen', hard: 'Difficile' } as Record<string, string>)[d] ?? d;
  }

  difficultyClass(d: string): Record<string, boolean> {
    return {
      'ct-badge-easy':   d === 'easy',
      'ct-badge-medium': d === 'medium',
      'ct-badge-hard':   d === 'hard',
    };
  }

  trackByIdx(i: number): number { return i; }

  goBack(): void {
    this.router.navigate(['/candidate/my-journey']);
  }
}