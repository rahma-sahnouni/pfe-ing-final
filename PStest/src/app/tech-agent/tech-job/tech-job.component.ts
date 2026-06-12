import { Component, OnInit, OnDestroy } from '@angular/core';
import { JobOfferService, JobOffer } from '../../_services/job-offer.service';
import { TechnicalTestService, QcmQuestion, PsExample, TestType } from '../../_services/technical-test.service';
import { interval, Subscription } from 'rxjs';
import { Router, ActivatedRoute } from '@angular/router';

type ModalStep = 'type-select' | 'form';

export interface PsParam {
  name:       string;
  type:       string;
  value:      string;
  multiline?: boolean;
}

export interface StructuredExample {
  params:      PsParam[];
  output:      string;
  explanation: string;
}

export type DeadlineUrgency = 'ok' | 'soon' | 'critical' | 'missed' | null;

export interface JobOfferWithDeadline extends JobOffer {
  _deadline:         Date | null;
  _daysUntil:        number | null;
  _deadlineUrgency:  DeadlineUrgency;
}

@Component({
  selector: 'app-tech-job',
  templateUrl: './tech-job.component.html',
  styleUrl: './tech-job.component.css',
})
export class TechJobComponent implements OnInit, OnDestroy {

  jobs:         JobOfferWithDeadline[] = [];
  filteredJobs: JobOfferWithDeadline[] = [];
  activeStatus = 'all';
  statuses = ['all', 'open', 'draft', 'paused', 'closed'];
  loading = false;
  error = '';
  searchTerm = '';

  showMissedBanner   = true;
  showUpcomingBanner = true;

  get missedDeadlineJobs(): JobOfferWithDeadline[] {
    return this.jobs.filter(j => !this.hasTechTests(j) && j._deadlineUrgency === 'missed');
  }

  get upcomingDeadlineJobs(): JobOfferWithDeadline[] {
    return this.jobs.filter(
      j => !this.hasTechTests(j) &&
           (j._deadlineUrgency === 'soon' || j._deadlineUrgency === 'critical')
    );
  }

  private tickSub?: Subscription;

  showModal    = false;
  selectedJob: JobOffer | null = null;
  submitting   = false;
  modalStep: ModalStep = 'type-select';
  formError    = '';

  testForm = this.freshForm();

  showJobDetailsModal = false;
  jobDetailsJob: JobOffer | null = null;

  showTestsModal  = false;
  testsModalJob:  JobOffer | null = null;
  jobTests:       any[] = [];
  testsLoading    = false;
  testsError      = '';

  readonly paramTypes = [
    'int', 'int[]', 'int[][]',
    'string', 'string (multiline)', 'string[]',
    'float', 'boolean',
    'object',
  ];

  constructor(
    private jobService:  JobOfferService,
    private testService: TechnicalTestService,
    private router:      Router,
    private route:       ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.loadJobs();
    this.tickSub = interval(60_000).subscribe(() => this.refreshDeadlines());
  }

  ngOnDestroy(): void {
    this.tickSub?.unsubscribe();
  }

  // ── Deadline helpers ──────────────────────────────────────────────────────

  private computeDeadlineInfo(
    deadline: Date | null,
    hasTests: boolean,
  ): { days: number | null; urgency: DeadlineUrgency } {
    if (!deadline || hasTests) return { days: null, urgency: null };

    const diff = deadline.getTime() - Date.now();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    let urgency: DeadlineUrgency;
    if      (days < 0)  urgency = 'missed';
    else if (days <= 2) urgency = 'critical';
    else if (days <= 5) urgency = 'soon';
    else                urgency = 'ok';

    return { days, urgency };
  }

  private enrichJob(job: JobOffer): JobOfferWithDeadline {
    const rawDeadline = (job as any).testAssignments?.technicalTest?.deadline ?? null;
    const deadline    = rawDeadline ? new Date(rawDeadline) : null;
    const hasTests    = this.hasTechTests(job);
    const { days, urgency } = this.computeDeadlineInfo(deadline, hasTests);

    return {
      ...job,
      _deadline:        deadline,
      _daysUntil:       days,
      _deadlineUrgency: urgency,
    };
  }

  refreshDeadlines(): void {
    this.jobs = this.jobs.map(j => {
      const { days, urgency } = this.computeDeadlineInfo(j._deadline, this.hasTechTests(j));
      return { ...j, _daysUntil: days, _deadlineUrgency: urgency };
    });
    this.applyFilter();
  }

  deadlineLabel(job: JobOfferWithDeadline): string {
    if (!job._deadline) return '';
    const d = job._daysUntil!;
    if (d < 0)   return `Overdue by ${Math.abs(d)} day${Math.abs(d) !== 1 ? 's' : ''}`;
    if (d === 0) return 'Due today!';
    if (d === 1) return 'Due tomorrow!';
    return `${d} days left`;
  }

  deadlineDate(job: JobOfferWithDeadline): string {
    if (!job._deadline) return '';
    return job._deadline.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  hasTechTests(job: JobOffer): boolean {
    return ((job as any).technicalTests?.length ?? 0) > 0;
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  loadingResults = false;
goToResults(job: JobOffer): void {
  if (this.loadingResults) return;
  this.loadingResults = true;

  this.testService.getTestsByJob(job._id!).subscribe({
    next: (tests) => {
      this.loadingResults = false;
      if (tests && tests.length > 0) {
        const firstTestId = tests[0]._id;
        this.goToTestDetails(firstTestId);
      } else {
        console.warn('No technical tests found for job', job.title);
        // Optionnel : afficher une notification à l'utilisateur
      }
    },
    error: (err) => {
      this.loadingResults = false;
      console.error('Failed to load tests for job', err);
    }
  });
}

  /** Navigue vers tech-tests-details pour un test spécifique */
goToTestDetails(testId: string | undefined): void {
  if (!testId) {
    console.error('Invalid test ID');
    return;
  }
  this.router.navigate(['/tech/tests', testId]);
}

  // ── Form factory ──────────────────────────────────────────────────────────

  freshForm() {
    return {
      title: '',
      description: '',
      difficulty: 'medium' as 'easy' | 'medium' | 'hard',
      timeLimitMinutes: 30,
      tags: '',
      isPublic: false,
      testType: null as TestType | null,

      ps: {
        examples:           [this.freshExample()] as StructuredExample[],
        expectedComplexity: '',
        constraints:        [{ label: '' }] as { label: string }[],
      },

      qcm: {
        questions: [] as QcmQuestion[],
      },
    };
  }

  freshExample(): StructuredExample {
    return {
      params:      [{ name: '', type: 'int', value: '' }],
      output:      '',
      explanation: '',
    };
  }

  // ── Filtering & loading ───────────────────────────────────────────────────

  applyFilter(): void {
    let result: JobOfferWithDeadline[] = this.jobs;
    if (this.activeStatus !== 'all')
      result = result.filter(j => j.status === this.activeStatus);
    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(
        j =>
          j.title?.toLowerCase().includes(term) ||
          j.department?.toLowerCase().includes(term) ||
          j.location?.toLowerCase().includes(term),
      );
    }
    this.filteredJobs = result;
  }

  setFilter(status: string): void {
    this.activeStatus = status;
    this.applyFilter();
  }

  loadJobs(): void {
    this.loading = true;
    this.jobService.getMyTechTestJobs().subscribe({
      next: jobs => {
        this.jobs = jobs.map(j => this.enrichJob(j));
        this.applyFilter();
        this.loading = false;
      },
      error: err => { this.error = err.message; this.loading = false; },
    });
  }

  // ── Add-test modal ────────────────────────────────────────────────────────

  openModal(job: JobOffer): void {
    this.selectedJob = job;
    this.testForm    = this.freshForm();
    this.modalStep   = 'type-select';
    this.formError   = '';
    this.showModal   = true;
  }

  selectTestType(type: TestType): void {
    this.testForm.testType = type;
    if ((type === 'qcm' || type === 'mixed') && !this.testForm.qcm.questions.length)
      this.addQcmQuestion();
    this.modalStep = 'form';
  }

  backToTypeSelect(): void {
    this.modalStep = 'type-select';
    this.testForm.testType = null;
  }

  closeModal(): void { this.showModal = false; this.selectedJob = null; }

  onOverlayClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay'))
      this.closeModal();
  }

  // ── Example (PS) helpers ──────────────────────────────────────────────────

  addExample(): void { this.testForm.ps.examples.push(this.freshExample()); }

  removeExample(i: number): void {
    if (this.testForm.ps.examples.length > 1)
      this.testForm.ps.examples.splice(i, 1);
  }

  addParam(exIdx: number): void {
    this.testForm.ps.examples[exIdx].params.push({ name: '', type: 'int', value: '' });
  }

  removeParam(exIdx: number, pIdx: number): void {
    const params = this.testForm.ps.examples[exIdx].params;
    if (params.length > 1) params.splice(pIdx, 1);
  }

  addConstraint(): void { this.testForm.ps.constraints.push({ label: '' }); }
  removeConstraint(i: number): void {
    if (this.testForm.ps.constraints.length > 1)
      this.testForm.ps.constraints.splice(i, 1);
  }

  // ── QCM helpers ───────────────────────────────────────────────────────────

  addQcmQuestion(): void {
    this.testForm.qcm.questions.push({
      questionText: '',
      type: 'single_choice',
      options: [
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
      ],
      correctAnswer: '',
      points: 1,
    });
  }

  removeQcmQuestion(i: number): void {
    if (this.testForm.qcm.questions.length > 1)
      this.testForm.qcm.questions.splice(i, 1);
  }

  addOption(qi: number): void {
    this.testForm.qcm.questions[qi].options.push({ text: '', isCorrect: false });
  }

  removeOption(qi: number, oi: number): void {
    const opts = this.testForm.qcm.questions[qi].options;
    if (opts.length > 2) opts.splice(oi, 1);
  }

  setSingleCorrect(qi: number, oi: number): void {
    this.testForm.qcm.questions[qi].options.forEach((o, idx) => {
      o.isCorrect = idx === oi;
    });
  }

  onQuestionTypeChange(qi: number): void {
    const q = this.testForm.qcm.questions[qi];
    q.options.forEach(o => (o.isCorrect = false));
    if (q.type === 'open') { q.options = []; } else {
      while (q.options.length < 2)
        q.options.push({ text: '', isCorrect: false });
    }
  }

  get hasPS(): boolean {
    return this.testForm.testType === 'problem_solving' || this.testForm.testType === 'mixed';
  }
  get hasQCM(): boolean {
    return this.testForm.testType === 'qcm' || this.testForm.testType === 'mixed';
  }

  // ── Parse helpers ─────────────────────────────────────────────────────────

  private parseParamValue(raw: string, type: string): any {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    if (this.isMultiline(type)) {
      const lines = trimmed.split('\n');
      return lines.map(line => line.split(''));
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      if (type === 'string') return trimmed;
      const fixed = trimmed.replace(/\s+/g, ',').replace(/,,+/g, ',');
      try { return JSON.parse(fixed); } catch { return trimmed; }
    }
  }

  private serializeExample(ex: StructuredExample): {
    input: Record<string, any>;
    output: any;
    explanation: string;
  } {
    const input: Record<string, any> = {};

    for (const p of ex.params) {
      const key = p.name.trim();
      if (!key) continue;
      let value = this.parseParamValue(p.value, p.type);
      if (this.isMultiline(p.type) && typeof value === 'string') {
        value = value.split('\n').map(line => line.trimEnd());
      }
      input[key] = value;
    }

    let output: any;
    try { output = JSON.parse(ex.output.trim()); }
    catch { output = ex.output.trim(); }

    return { input, output, explanation: ex.explanation ?? '' };
  }

  // ── Validation ────────────────────────────────────────────────────────────

  private validateForm(): string | null {
    if (!this.testForm.title.trim()) return 'Title is required.';
    if (!this.testForm.testType)     return 'Please select a test type.';

    if (this.hasPS) {
      for (const [i, ex] of this.testForm.ps.examples.entries()) {
        const hasParams = ex.params.some(p => p.name.trim() && p.value.trim());
        if (!hasParams)
          return `Example ${i + 1}: please add at least one named parameter with a value.`;

        for (const p of ex.params) {
          if (!p.name.trim())  return `Example ${i + 1}: a parameter is missing its name.`;
          if (!p.value.trim()) return `Example ${i + 1}: parameter "${p.name}" has no value.`;
          try { this.parseParamValue(p.value, p.type); } catch {
            return `Example ${i + 1}: parameter "${p.name}" has an invalid value — must be valid JSON.`;
          }
        }
        if (!ex.output.trim()) return `Example ${i + 1}: expected output is required.`;
      }
    }

    if (this.hasQCM) {
      const validQs = this.testForm.qcm.questions.filter(q => q.questionText.trim());
      if (!validQs.length) return 'Please add at least one QCM question.';
    }

    return null;
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  submitTest(): void {
    this.formError = '';
    const err = this.validateForm();
    if (err) { this.formError = err; return; }

    if (!this.selectedJob?._id) return;
    this.submitting = true;

    const payload: any = {
      jobId:            this.selectedJob._id,
      title:            this.testForm.title,
      description:      this.testForm.description,
      difficulty:       this.testForm.difficulty,
      timeLimitMinutes: this.testForm.timeLimitMinutes,
      tags:             this.testForm.tags.split(',').map(t => t.trim()).filter(Boolean),
      isPublic:         this.testForm.isPublic,
      testType:         this.testForm.testType,
    };

    if (this.hasPS) {
      payload.problemSolving = {
        examples: this.testForm.ps.examples
          .filter(ex => ex.params.some(p => p.name.trim() && p.value.trim()))
          .map(ex => this.serializeExample(ex)),
        constraints:        this.testForm.ps.constraints.filter(c => c.label.trim()),
        expectedComplexity: this.testForm.ps.expectedComplexity,
      };
    }

    if (this.hasQCM) {
      payload.qcm = {
        questions: this.testForm.qcm.questions.map(q => ({
          questionText:  q.questionText,
          type:          q.type,
          points:        q.points,
          correctAnswer: q.type === 'open' ? q.correctAnswer : undefined,
          options:       q.type !== 'open' ? q.options : [],
        })),
      };
    }

    this.testService.createAndAssign(payload).subscribe({
      next: () => {
        const idx = this.jobs.findIndex(j => j._id === this.selectedJob!._id);
        if (idx !== -1) {
          this.jobs[idx] = { ...this.jobs[idx], _deadlineUrgency: null, _daysUntil: null };
        }
        this.closeModal();
        this.loadJobs();
        this.submitting = false;
      },
      error: err => {
        this.formError  = err.error?.message || err.message || 'Unknown error';
        this.submitting = false;
      },
    });
  }

  // ── Job-details modal ─────────────────────────────────────────────────────

  openJobDetails(job: JobOffer): void {
    this.jobDetailsJob       = job;
    this.showJobDetailsModal = true;
  }
  closeJobDetails(): void {
    this.showJobDetailsModal = false;
    this.jobDetailsJob       = null;
  }
  onJobDetailsOverlayClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay'))
      this.closeJobDetails();
  }

  // ── View-tests modal ──────────────────────────────────────────────────────

  openTestsModal(job: JobOffer): void {
    this.testsModalJob  = job;
    this.jobTests       = [];
    this.testsError     = '';
    this.testsLoading   = true;
    this.showTestsModal = true;

    this.testService.getTestsByJob(job._id!).subscribe({
      next:  tests => { this.jobTests = tests; this.testsLoading = false; },
      error: err   => { this.testsError = err.message; this.testsLoading = false; },
    });
  }

  closeTestsModal(): void {
    this.showTestsModal = false;
    this.testsModalJob  = null;
    this.jobTests       = [];
  }
  onTestsOverlayClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay'))
      this.closeTestsModal();
  }

  // ── Misc helpers ──────────────────────────────────────────────────────────

  testCount(job: JobOffer): number { return (job as any).technicalTests?.length ?? 0; }
  difficultyClass(d: string): string { return `difficulty-${d?.toLowerCase() ?? 'medium'}`; }

  testTypeLabel(type: string): string {
    return ({ problem_solving: 'Problem Solving', qcm: 'QCM', mixed: 'PS + QCM' }[type] ?? type);
  }
  testTypeIcon(type: string): string {
    return ({ problem_solving: '⌨', qcm: '☑', mixed: '⚡' }[type] ?? '?');
  }

  isMultiline(type: string): boolean { return type === 'string (multiline)'; }

  isValidJson(raw: string, type?: string): boolean {
    if (!raw?.trim()) return true;
    if (type && this.isMultiline(type)) return true;
    try { JSON.parse(raw.trim()); return true; } catch { return false; }
  }

  previewExample(ex: StructuredExample): string {
    try { return JSON.stringify(this.serializeExample(ex), null, 2); }
    catch { return '(invalid)'; }
  }



   // ── Edit/Delete state ─────────────────────────────────────────────────────

  showEditModal    = false;

  editingTest:     any = null;

  editingJob:      JobOffer | null = null;

  editSubmitting   = false;

  editFormError    = '';

  deleteConfirming: string | null = null; // testId en cours de confirmation

  deleting         = false;

   // ── Edit test ─────────────────────────────────────────────────────────────
editForm = this.freshForm();
openEditModal(test: any, job: JobOffer): void {
  this.editingTest = test;
  this.editingJob  = job;
  this.editFormError = '';

  // Mappe les données du test vers le format testForm
  this.editForm = {
    title:            test.title ?? '',
    description:      test.description ?? '',
    difficulty:       test.difficulty ?? 'medium',
    timeLimitMinutes: test.timeLimitMinutes ?? 30,
    tags:             Array.isArray(test.tags) ? test.tags.join(', ') : (test.tags ?? ''),
    isPublic:         test.isPublic ?? false,
    testType:         test.testType ?? null,

    ps: {
      expectedComplexity: test.problemSolving?.expectedComplexity ?? '',
      constraints: test.problemSolving?.constraints?.length
        ? test.problemSolving.constraints.map((c: any) => ({
            label: typeof c === 'string' ? c : (c.label ?? '')
          }))
        : [{ label: '' }],
      examples: test.problemSolving?.examples?.length
        ? test.problemSolving.examples.map((ex: any) => ({
            params: Object.entries(ex.input ?? {}).map(([name, value]) => ({
              name,
              type:  this.guessParamType(value),
              value: JSON.stringify(value),
            })),
            output:      JSON.stringify(ex.output ?? ''),
            explanation: ex.explanation ?? '',
          }))
        : [this.freshExample()],
    },

    qcm: {
      questions: test.qcm?.questions?.length
        ? test.qcm.questions.map((q: any) => ({ ...q }))
        : [],
    },
  };

  this.showEditModal = true;
}

/** Devine le type d'un paramètre depuis sa valeur */
private guessParamType(value: any): string {
  if (Array.isArray(value)) {
    if (value.length && Array.isArray(value[0])) return 'int[][]';
    if (value.length && typeof value[0] === 'string') return 'string[]';
    return 'int[]';
  }
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  return 'object';
}
  closeEditModal(): void {

    this.showEditModal = false;

    this.editingTest  = null;

    this.editingJob   = null;

  }


submitEditTest(): void {
  if (!this.editingTest?._id) return;
  this.editSubmitting = true;
  this.editFormError  = '';

  const payload: any = {
    title:            this.editForm.title,
    description:      this.editForm.description,
    difficulty:       this.editForm.difficulty,
    timeLimitMinutes: this.editForm.timeLimitMinutes,
    tags:             this.editForm.tags.split(',').map((t: string) => t.trim()).filter(Boolean),
    isPublic:         this.editForm.isPublic,
    testType:         this.editForm.testType,
  };

  const hasPS  = this.editForm.testType === 'problem_solving' || this.editForm.testType === 'mixed';
  const hasQCM = this.editForm.testType === 'qcm'             || this.editForm.testType === 'mixed';

  if (hasPS) {
    payload.problemSolving = {
      examples: this.editForm.ps.examples
        .filter((ex: any) => ex.params.some((p: any) => p.name.trim() && p.value.trim()))
        .map((ex: any) => this.serializeExample(ex)),
      constraints:        this.editForm.ps.constraints.filter((c: any) => c.label.trim()),
      expectedComplexity: this.editForm.ps.expectedComplexity,
    };
  }

  if (hasQCM) {
    payload.qcm = {
      questions: this.editForm.qcm.questions.map((q: any) => ({
        questionText:  q.questionText,
        type:          q.type,
        points:        q.points,
        correctAnswer: q.type === 'open' ? q.correctAnswer : undefined,
        options:       q.type !== 'open' ? q.options : [],
      })),
    };
  }

  this.testService.updateTest(this.editingTest._id, payload).subscribe({
    next: () => {
      this.closeEditModal();
      if (this.showTestsModal && this.testsModalJob) this.openTestsModal(this.testsModalJob);
      this.loadJobs();
      this.editSubmitting = false;
    },
    error: (err: any) => {
      this.editFormError  = err.error?.message || err.message || 'Unknown error';
      this.editSubmitting = false;
    },
  });
}
get editHasPS(): boolean {
  return this.editForm.testType === 'problem_solving' || this.editForm.testType === 'mixed';
}
get editHasQCM(): boolean {
  return this.editForm.testType === 'qcm' || this.editForm.testType === 'mixed';
}

// ── Edit form helpers ─────────────────────────────────────────────────────
addEditExample(): void { this.editForm.ps.examples.push(this.freshExample()); }
removeEditExample(i: number): void {
  if (this.editForm.ps.examples.length > 1) this.editForm.ps.examples.splice(i, 1);
}
addEditParam(ei: number): void {
  this.editForm.ps.examples[ei].params.push({ name: '', type: 'int', value: '' });
}
removeEditParam(ei: number, pi: number): void {
  const p = this.editForm.ps.examples[ei].params;
  if (p.length > 1) p.splice(pi, 1);
}
addEditConstraint(): void { this.editForm.ps.constraints.push({ label: '' }); }
removeEditConstraint(i: number): void {
  if (this.editForm.ps.constraints.length > 1) this.editForm.ps.constraints.splice(i, 1);
}
addEditQcmQuestion(): void {
  this.editForm.qcm.questions.push({
    questionText: '', type: 'single_choice',
    options: [{ text: '', isCorrect: false }, { text: '', isCorrect: false }],
    correctAnswer: '', points: 1,
  });
}
removeEditQcmQuestion(i: number): void {
  if (this.editForm.qcm.questions.length > 1) this.editForm.qcm.questions.splice(i, 1);
}
addEditOption(qi: number): void {
  this.editForm.qcm.questions[qi].options.push({ text: '', isCorrect: false });
}
removeEditOption(qi: number, oi: number): void {
  const opts = this.editForm.qcm.questions[qi].options;
  if (opts.length > 2) opts.splice(oi, 1);
}
setEditSingleCorrect(qi: number, oi: number): void {
  this.editForm.qcm.questions[qi].options.forEach((o: any, idx: number) => {
    o.isCorrect = idx === oi;
  });
}
onEditQuestionTypeChange(qi: number): void {
  const q = this.editForm.qcm.questions[qi];
  q.options.forEach((o: any) => (o.isCorrect = false));
  if (q.type === 'open') { q.options = []; }
  else { while (q.options.length < 2) q.options.push({ text: '', isCorrect: false }); }
}

  // ── Delete test ───────────────────────────────────────────────────────────

  confirmDelete(testId: string): void  { this.deleteConfirming = testId; }

  cancelDelete(): void               { this.deleteConfirming = null; }


  deleteTest(testId: string, jobId: string): void {

    this.deleting = true;

    this.testService.deleteTest(testId).subscribe({

      next: () => {

        this.deleteConfirming = null;

        this.deleting = false;

        // Rafraîchit le modal tests si ouvert

        if (this.showTestsModal && this.testsModalJob) {

          this.openTestsModal(this.testsModalJob);

        }

        this.loadJobs();

      },

      error: (err: any) => {

        console.error('Delete failed', err);

        this.deleting = false;

      },

    });

  }
}