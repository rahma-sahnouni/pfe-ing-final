import {
  Component, OnInit, OnDestroy
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil, catchError, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { of } from 'rxjs';

import { TestRhService} from '../../_services/test-rh.service';
import {
  JobTest, Theme, TestModel, Question, BuiltinModels,
  ThemeCategory, ModelType, AnswerType, ResponseOption,
  CATEGORY_META, ANSWER_TYPE_META, Criterion
} from '../../_services/test-rh.service';
import { JobOffer, JobOfferService } from '../../_services/job-offer.service';

type View = 'overview' | 'add-theme' | { theme: Theme } | { theme: Theme; model: TestModel };

@Component({
  selector: 'app-test-configurator',
  templateUrl: './test-configurator.component.html',
  styleUrls: ['./test-configurator.component.css'],
})
export class TestConfiguratorComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  jobId!: string;
  test: JobTest | null = null;
  builtinModels: BuiltinModels | null = null;
  loading = true;

  view: View = 'overview';

  newThemeName = '';
  newThemeCategory: ThemeCategory = 'personality';

  showAddModel = false;
  newModelType: ModelType = 'disc';
  newModelWeight = 50;
  newModelCustomLabel = '';
  newCustomCriteria: Criterion[] = [];

  editingQuestion: Question | null = null;
  editingQuestionModelId: string | null = null;
  editingQuestionId: string | null = null;
  newOption: ResponseOption = { text: '', score: 0, criterionKey: null };

  CATEGORY_META = CATEGORY_META;
  ANSWER_TYPE_META = ANSWER_TYPE_META;
  categories = Object.keys(CATEGORY_META) as ThemeCategory[];
  modelTypes = ['disc', 'mbti', 'big_five', 'eq_i', 'custom'] as ModelType[];
  answerTypes = ['single_choice', 'multiple_choice', 'likert'] as AnswerType[];
  job: JobOffer | null = null;

  constructor(
    private route: ActivatedRoute,
    private svc: TestRhService,
    private jobSvc: JobOfferService
  ) {}

  ngOnInit() {
    this.jobId = this.route.snapshot.paramMap.get('jobId')!;
    this.svc.getBuiltinModels().subscribe(bm => { this.builtinModels = bm; });
    this.loadJob();
    this.load();
    this.initDurationAutoSave();
  }

  loadJob() {
    this.jobSvc.getJobById(this.jobId).subscribe(job => {
      this.job = job;
    });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  load() {
    this.loading = true;
    this.svc.getTestByJob(this.jobId)
      .pipe(
        catchError(err => {
          console.error('Error loading test', err);
          return of(null);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe(test => {
        this.test = test;
        this.draftDuration = test?.timeLimitMinutes ?? null;
        this.loading = false;
      });
  }

  /* ── Navigation ─────────────────────────────────────────────────────────── */

  goOverview()               { this.view = 'overview'; }
  goAddTheme()               { this.view = 'add-theme'; this.newThemeName = ''; this.newThemeCategory = 'personality'; }

  onCategorySelect(cat: ThemeCategory) {
    const autoLabels = Object.values(CATEGORY_META).map(m => m.label);
    if (!this.newThemeName || autoLabels.includes(this.newThemeName)) {
      this.newThemeName = CATEGORY_META[cat].label;
    }
    this.newThemeCategory = cat;
  }
  goTheme(theme: Theme)      { this.view = { theme }; this.showAddModel = false; }
  goModel(theme: Theme, model: TestModel) { this.view = { theme, model }; this.editingQuestion = null; }

  isOverview()  { return this.view === 'overview'; }
  isAddTheme()  { return this.view === 'add-theme'; }
  isThemeView() { return typeof this.view === 'object' && 'theme' in this.view && !('model' in this.view); }
  isModelView() { return typeof this.view === 'object' && 'model' in this.view; }

  get currentTheme(): Theme | null {
    if (typeof this.view === 'object' && 'theme' in this.view) return (this.view as any).theme;
    return null;
  }
  get currentModel(): TestModel | null {
    if (typeof this.view === 'object' && 'model' in this.view) return (this.view as any).model;
    return null;
  }

  createTest() {
    this.svc.createTest(this.jobId, { name: 'Assessment' })
      .subscribe(t => { this.test = t; });
  }

  /* ── Themes ─────────────────────────────────────────────────────────────── */

  submitAddTheme() {
    if (!this.newThemeName || !this.newThemeCategory) return;
    this.svc.addTheme(this.jobId, { name: this.newThemeName, category: this.newThemeCategory })
      .subscribe(t => {
        this.test = t;
        const added = t.themes[t.themes.length - 1];
        this.goTheme(added);
      });
  }

  deleteTheme(themeId: string) {
    if (!confirm('Delete this theme?')) return;
    this.svc.deleteTheme(this.jobId, themeId).subscribe(t => {
      this.test = t;
      this.goOverview();
    });
  }

  /* ── Models ─────────────────────────────────────────────────────────────── */

  submitAddModel(theme: Theme) {
    const data: any = { modelType: this.newModelType, weight: this.newModelWeight };
    if (this.newModelType === 'custom') {
      data.label = this.newModelCustomLabel || 'Custom Model';
      data.customCriteria = this.newCustomCriteria;
    }
    this.svc.addModel(this.jobId, theme._id!, data).subscribe(t => {
      this.test = t;
      const updatedTheme = t.themes.find(th => th._id === theme._id)!;
      (this.view as any).theme = updatedTheme;
      this.showAddModel = false;
    });
  }

  updateModelWeight(theme: Theme, model: TestModel, weight: number) {
    this.svc.updateModel(this.jobId, theme._id!, model._id!, { weight }).subscribe(t => {
      this.test = t;
    });
  }

  deleteModel(theme: Theme, modelId: string) {
    if (!confirm('Delete this model?')) return;
    this.svc.deleteModel(this.jobId, theme._id!, modelId).subscribe(t => {
      this.test = t;
      const updatedTheme = t.themes.find(th => th._id === theme._id)!;
      this.goTheme(updatedTheme);
    });
  }

  /* ── Questions ──────────────────────────────────────────────────────────── */

  openNewQuestion(theme: Theme, model: TestModel) {
    this.goModel(theme, model);
    this.editingQuestion = {
      text: '',
      answerType: 'single_choice',
      options: [],
      likertMin: 'Strongly Disagree',
      likertMax: 'Strongly Agree',
      likertCriterionKey: null,
      likertReversed: false,
      questionCriterionKey: null,
    };
    this.editingQuestionModelId = model._id!;
    this.editingQuestionId = null;
    this.newOption = { text: '', score: 0, criterionKey: null };
  }

  openEditQuestion(theme: Theme, model: TestModel, q: Question) {
    this.editingQuestion = JSON.parse(JSON.stringify(q));
    this.editingQuestionModelId = model._id!;
    this.editingQuestionId = q._id!;

    // FIX: restore Likert-specific fields when editing a Likert question
    if (q.answerType === 'likert') {
      this.editingQuestion!.likertCriterionKey = q.likertCriterionKey ?? null;
      this.editingQuestion!.likertReversed     = q.likertReversed ?? false;
    }

    // Restore shared criterion for single/multiple choice questions
    if (
      (q.answerType === 'single_choice' || q.answerType === 'multiple_choice') &&
      q.options.length > 0
    ) {
      this.editingQuestion!.questionCriterionKey = q.options[0].criterionKey ?? null;
    }

    this.newOption = { text: '', score: 0, criterionKey: null };
    this.goModel(theme, model);
  }

  cancelQuestion() { this.editingQuestion = null; }

  addOption() {
    if (!this.editingQuestion) return;
    this.editingQuestion.options.push({ ...this.newOption });
    this.newOption = { text: '', score: 0, criterionKey: null };
  }

  removeOption(i: number) { this.editingQuestion?.options.splice(i, 1); }

  saveQuestion(theme: Theme, model: TestModel) {
    if (!this.editingQuestion) return;

    // Auto-add pending option for single/multiple choice
    if (
      (this.editingQuestion.answerType === 'single_choice' ||
       this.editingQuestion.answerType === 'multiple_choice') &&
      this.newOption.text?.trim()
    ) {
      this.addOption();
    }

    const q = { ...this.editingQuestion };

    // Apply shared criterion key to all options for choice questions
    if (
      (q.answerType === 'single_choice' || q.answerType === 'multiple_choice') &&
      q.questionCriterionKey
    ) {
      q.options = q.options.map(opt => ({
        ...opt,
        criterionKey: q.questionCriterionKey!,
      }));
    }

    // FIX: ensure Likert fields are explicitly included in payload
    // (they are already part of `q` via spread, but we make sure nulls are preserved)
    if (q.answerType === 'likert') {
      q.likertCriterionKey = q.likertCriterionKey ?? null;
      q.likertReversed     = q.likertReversed ?? false;
    }

    if (this.editingQuestionId) {
      this.svc.updateQuestion(this.jobId, theme._id!, model._id!, this.editingQuestionId, q)
        .subscribe(t => {
          this.test = t;
          this.refreshModelView(t, theme._id!, model._id!);
          this.editingQuestion = null;
        });
    } else {
      this.svc.addQuestion(this.jobId, theme._id!, model._id!, q)
        .subscribe(t => {
          this.test = t;
          this.refreshModelView(t, theme._id!, model._id!);
          this.editingQuestion = null;
        });
    }
  }

  deleteQuestion(theme: Theme, model: TestModel, questionId: string) {
    if (!confirm('Delete question?')) return;
    this.svc.deleteQuestion(this.jobId, theme._id!, model._id!, questionId)
      .subscribe(t => { this.test = t; this.refreshModelView(t, theme._id!, model._id!); });
  }

  private refreshModelView(t: JobTest, themeId: string, modelId: string) {
    const th = t.themes.find(x => x._id === themeId)!;
    const mo = th.models.find(x => x._id === modelId)!;
    this.view = { theme: th, model: mo };
  }

  /* ── Custom criteria ────────────────────────────────────────────────────── */

  addCriterion() {
    this.newCustomCriteria.push({ key: '', label: '', color: '#6366f1' });
  }
  removeCriterion(i: number) { this.newCustomCriteria.splice(i, 1); }

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  get themeCount() { return this.test?.themes?.length ?? 0; }
  get questionCount() {
    return this.test?.themes?.reduce((s, t) =>
      s + t.models.reduce((ms, m) => ms + m.questions.length, 0), 0) ?? 0;
  }

  criteriaFor(model: TestModel): Criterion[] {
    if (model.modelType === 'custom') return model.customCriteria ?? [];
    return this.builtinModels?.[model.modelType]?.criteria ?? [];
  }

  modelLabel(mt: ModelType): string {
    return this.builtinModels?.[mt]?.label ?? mt;
  }

  totalWeight(theme: Theme): number {
    return theme.models.reduce((s, m) => s + (m.weight ?? 0), 0);
  }

  categoryLabel(cat: ThemeCategory) { return CATEGORY_META[cat]?.label ?? cat; }
  categoryIcon(cat: ThemeCategory)  { return CATEGORY_META[cat]?.icon ?? 'help'; }

  themeQuestionCount(theme: Theme): number {
    return theme.models.reduce((s, m) => s + m.questions.length, 0);
  }

  /* ── Complete test ──────────────────────────────────────────────────────── */

  /* ── Duration (auto-save) ───────────────────────────────────────────────── */

  draftDuration:   number | null = null;
  durationSaving = false;
  durationSaved  = false;
  private durationChange$ = new Subject<number | null>();

  private initDurationAutoSave(): void {
    this.durationChange$
      .pipe(debounceTime(600), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(val => {
        this.durationSaving = true;
        this.durationSaved  = false;
        this.svc.updateTest(this.jobId, { timeLimitMinutes: val })
          .subscribe(t => {
            this.test          = t;
            this.durationSaving = false;
            this.durationSaved  = true;
            setTimeout(() => { this.durationSaved = false; }, 2000);
          });
      });
  }

  onDurationChange(val: number | null): void {
    this.draftDuration = val;
    this.durationChange$.next(val);
  }

  /* ── Complete test ──────────────────────────────────────────────────────── */

  showCompleteModal = false;

  confirmComplete() {
    this.showCompleteModal = true;
  }

  cancelComplete() {
    this.showCompleteModal = false;
  }

  completeTestConfirmed() {
    this.showCompleteModal = false;
    this.svc.completeTest(this.jobId).subscribe({
      next: ({ test, alreadyCompleted }) => {
        this.test = test;
        if (alreadyCompleted) alert('This test was already marked as complete.');
      },
      error: err => console.error('[completeTest]', err)
    });
  }

  // Keep old completeTest() for backward compat if called elsewhere
  completeTest() {
    if (!this.test) return;
    if (!confirm('Mark this assessment as complete? The job creator will be notified.')) return;
    this.svc.completeTest(this.jobId).subscribe({
      next: ({ test, alreadyCompleted }) => {
        this.test = test;
        if (alreadyCompleted) alert('This test was already marked as complete.');
      },
      error: err => console.error('[completeTest]', err)
    });
  }

  isEditable(): boolean {
    return this.test?.status !== 'active';
  }
}