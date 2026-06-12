import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, CurrentUser } from '../../_services/auth.service';
import {
  CandidateService,
  RhTest,
  Question,
  JobOfferRef,  // ← add this
} from '../../_services/candidate.service';
import { SubmissionService } from '../../_services/submission.service';

@Component({
  selector: 'app-candidate-rh-test',
  templateUrl: './candidate-rh-test.component.html',
  styleUrl: './candidate-rh-test.component.css',
})
export class CandidateRhTestComponent implements OnInit {
  currentUser: CurrentUser | null = null;

  loading    = true;
  error      = '';
  submitted  = false;
  submitting = false;
  allDone    = false;

  jobId:  string = '';
  testId: string = '';

  rhTest: RhTest | null = null;
jobOffer: JobOfferRef | null = null;

  rhAnswers: Record<string, any> = {};
  dragRankOrder: Record<string, string[]> = {};
  private draggedItem: string | null = null;

  constructor(
    private route:        ActivatedRoute,
    private router:       Router,
    private authService:  AuthService,
    private testsService: CandidateService,
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
        // Navigate back to journey after short delay
        setTimeout(() => this.router.navigate(['/candidate/my-journey']), 1500);
      },
      error: (err) => {
        console.error('RH submit error', err);
        this.submitting = false;
      },
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  trackByIdx(i: number): number { return i; }

  goBack(): void {
    this.router.navigate(['/candidate/my-journey']);
  }
}