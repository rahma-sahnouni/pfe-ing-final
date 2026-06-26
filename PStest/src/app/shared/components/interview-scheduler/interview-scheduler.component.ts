import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CandidateService } from '../../../_services/candidate.service';
import { JobOfferService, JobOffer } from '../../../_services/job-offer.service';
import { AuthService } from '../../../_services/auth.service';
import {
  InterviewSessionService,
  InterviewSession,
  CandidateEvaluation,
  InterviewConfig,
  EvaluationCriterion,
  DayRange,
  Recommendation,
  PopulatedCandidate,
} from '../../../_services/interview-session.service';

// ─── Local view types ────────────────────────────────────────────────────────

export type UserRole = 'rh' | 'technical evaluator' | 'admin';

export interface SessionRow extends CandidateEvaluation {
  stage:     'rh' | 'technical evaluator';
  sessionId: string;
}

export interface ReadyCandidate {
  _id:               string;
  name:              string;
  email:             string;
  phone?:            string;
  avatarColor?:      string;
  aiMatchScore?:     number;
  jobId:             string;
  jobTitle:          string;
  department?:       string;
  rhApproved:        string;
  techStatus:        string;
  applicationStatus: string;
  adminDecision?:    string | null;
  interviews?: {
    rh?:   { scheduledAt?: string; type?: string; location?: string; completed?: boolean } | null;
    tech?: { scheduledAt?: string; type?: string; location?: string; completed?: boolean } | null;
  };
  sessionId?: string | null;
}

export interface CalendarDay {
  date:         Date;
  rhSessions:   SessionRow[];
  techSessions: SessionRow[];
  allSessions:  SessionRow[];
}

export interface LiveCriterion extends EvaluationCriterion {
  value: any;
}

export interface CandidateReport {
  candidateId: string;
  candidate:   ReadyCandidate;
  rh:          SessionRow | null;
  tech:        SessionRow | null;
}

export type DeadlineUrgency = 'ok' | 'soon' | 'critical' | 'missed' | null;

// ─── Helper ───────────────────────────────────────────────────────────────────
function flattenSession(doc: InterviewSession): SessionRow[] {
  return (doc.candidateEvaluations || []).map(ev => ({
    ...ev,
    stage:     doc.stage,
    sessionId: doc._id,
  }));
}

@Component({
  selector: 'app-interview-scheduler',
  templateUrl: './interview-scheduler.component.html',
  styleUrls: ['./interview-scheduler.component.css'],
})
export class InterviewSchedulerComponent implements OnInit, OnDestroy {

  currentRole: UserRole = 'rh';
  adminEditingStage: 'rh' | 'technical evaluator' = 'rh';

  activeView: 'jobs' | 'calendar' | 'live' | 'admin-decisions' = 'jobs';
  loading         = false;
  savingConfig    = false;
  assigning       = false;
  assignmentDone  = false;
  assignmentCount = 0;

  calendarStageFilter: 'rh' | 'technical evaluator' | 'all' = 'rh';

  jobs:               JobOffer[]       = [];
  selectedJobObj:     JobOffer | null  = null;
  readyCandidates:    ReadyCandidate[] = [];
  filteredCandidates: ReadyCandidate[] = [];

  rhSessions:   SessionRow[] = [];
  techSessions: SessionRow[] = [];

  get allSessions(): SessionRow[] {
    return [...this.rhSessions, ...this.techSessions].sort(
      (a, b) =>
        new Date(a.scheduledAt ?? 0).getTime() -
        new Date(b.scheduledAt ?? 0).getTime()
    );
  }

  // ─── FIX : configs initialisées avec des tableaux vides, jamais undefined ──
  rhConfig:   InterviewConfig = { enabled: true, ranges: [], evaluationGrid: [] };
  techConfig: InterviewConfig = { enabled: true, ranges: [], evaluationGrid: [] };

  get myStage(): 'rh' | 'technical evaluator' {
    if (this.isAdmin) return this.adminEditingStage;
    return this.currentRole === 'technical evaluator' ? 'technical evaluator' : 'rh';
  }

  get myConfig(): InterviewConfig {
    return this.myStage === 'technical evaluator' ? this.techConfig : this.rhConfig;
  }

  searchQuery   = '';
  selectedJobId = 'all';

  dayForm!:       FormGroup;
  scheduleForm!:  FormGroup;
  criterionForm!: FormGroup;

  calendarDate = new Date();
  calendarDays: CalendarDay[] = [];
  selectedDay:  CalendarDay | null = null;

  showScheduleModal = false;
  scheduleTarget:   ReadyCandidate | null        = null;
  scheduleStage:    'rh' | 'technical evaluator' = 'rh';
  scheduleSaving    = false;

  editingCriterionIndex: number | null = null;

  liveSession:    SessionRow | null    = null;
  liveCandidate:  ReadyCandidate | null = null;
  liveCriteria:   LiveCriterion[]      = [];
  liveOverall     = 0;
  liveReco:       Recommendation       = 'consider';
  liveComments    = '';
  evalSaving      = false;
  isReadOnlyEval  = false;

  timerRunning  = false;
  timerSeconds  = 0;
  timerInterval: any = null;

  candidateReports:   CandidateReport[]      = [];
  selectedReport:     CandidateReport | null = null;
  adminDecisionNotes  = '';
  adminDecisionSaving = false;

  showBlockedModal    = false;
  private _blockedJob: JobOffer | null = null;

  get isTestPeriodBlocked(): boolean {
    const period = this.selectedJobObj?.testPeriod;
    if (!period?.end) return false;
    const now = new Date();
    const end = new Date(period.end);
    return now <= end;
  }

  get testPeriodBlockMessage(): string {
    const period = this._blockedJob?.testPeriod;
    if (!period?.end) return '';
    const end = new Date(period.end);
    return `You can't configure interviews yet. The test period is still active and ends on ${end.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}. Interview configuration will be available once all candidates have completed their tests.`;
  }

  showMissedInterviewsBanner   = true;
  showUpcomingInterviewsBanner = true;

  recoOptions = [
    { value: 'hire' as Recommendation, label: 'Hire', icon: 'fa-circle-check', cls: 'hire' },
    { value: 'consider' as Recommendation, label: 'To consider', icon: 'fa-circle-question', cls: 'consider' },
    { value: 'reject' as Recommendation, label: 'Reject', icon: 'fa-circle-xmark', cls: 'reject' },
  ];

  configuredJobIds: Set<string> = new Set();

  constructor(
    private fb:               FormBuilder,
    private candidateService: CandidateService,
    private jobService:       JobOfferService,
    private sessionService:   InterviewSessionService,
    private authService:      AuthService,
  ) {}

  ngOnInit(): void {
    const user     = this.authService.currentUserValue;
    const rawRole  = (user?.role || '').toString().toLowerCase().trim();

    if (rawRole === 'admin') {
      this.currentRole = 'admin';
    } else if (rawRole === 'technical evaluator' || rawRole === 'tech') {
      this.currentRole = 'technical evaluator';
    } else {
      this.currentRole = 'rh';
    }

    this.calendarStageFilter = this.isAdmin ? 'all' : this.myStage;
    this.initForms();
    this.loadJobs();
  }

  ngOnDestroy(): void { this.stopTimer(); }

  get isAdmin(): boolean { return this.currentRole === 'admin'; }
  get isRH():    boolean { return this.currentRole === 'rh'; }
  get isTech():  boolean { return this.currentRole === 'technical evaluator'; }

  canManageStage(stage: 'rh' | 'technical evaluator'): boolean {
    if (this.isAdmin) return true;
    return this.myStage === stage;
  }

  private getInterviewKey(stage: 'rh' | 'technical evaluator'): 'rh' | 'tech' {
    return stage === 'technical evaluator' ? 'tech' : 'rh';
  }

  private initForms(): void {
    this.dayForm = this.fb.group({
      date:            ['', Validators.required],
      startTime:       ['', Validators.required],
      endTime:         ['', Validators.required],
      durationMinutes: [30, [Validators.required, Validators.min(15)]],
      breakMinutes:    [10, [Validators.required, Validators.min(0)]],
    });

    this.scheduleForm = this.fb.group({
      scheduledAt:   ['', Validators.required],
      startTime:     ['', Validators.required],
      interviewType: ['on-site', Validators.required],
      location:      [''],
      notes:         [''],
    });

    this.criterionForm = this.fb.group({
      label:       ['', Validators.required],
      description: [''],
      type:        ['rating_5', Validators.required],
      weight:      [1, [Validators.required, Validators.min(0)]],
    });
  }

  // ─── FIX : méthode centralisée pour charger ET hydrater les deux configs ───
  // Appelée par selectJob(), saveConfig(), autoAssign() et le switch admin.
  private loadInterviewConfig(): void {
    if (!this.selectedJobId || this.selectedJobId === 'all') return;
    this.sessionService.getInterviewConfig(this.selectedJobId).subscribe({
      next: (cfg: any) => {
        this.rhConfig = {
          enabled:        cfg?.rh?.enabled        ?? true,
          ranges:         cfg?.rh?.ranges         || [],
          evaluationGrid: cfg?.rh?.evaluationGrid  || [],
        };
        this.techConfig = {
          enabled:        cfg?.tech?.enabled       ?? true,
          ranges:         cfg?.tech?.ranges         || [],
          evaluationGrid: cfg?.tech?.evaluationGrid || [],
        };
      },
      error: () => {},
    });
  }

  loadJobs(): void {
    this.loading = true;
    this.jobService.getAccessibleJobs().subscribe({
      next: (jobs: JobOffer[]) => {
        this.jobs = jobs;
        this.loading = false;
        this.preloadConfiguredJobs(jobs);
      },
      error: () => { this.loading = false; },
    });
  }

  private preloadConfiguredJobs(jobs: JobOffer[]): void {
    jobs.forEach(job => {
      if (!job._id) return;
      if (job.interviewConfig?.rh?.ranges?.length || job.interviewConfig?.tech?.ranges?.length) {
        this.configuredJobIds.add(job._id);
        return;
      }
      this.sessionService.getSessions({ jobId: job._id, stage: 'rh' }).subscribe({
        next: docs => { if (docs?.length) this.configuredJobIds.add(job._id!); },
        error: () => {},
      });
      this.sessionService.getSessions({ jobId: job._id, stage: 'technical evaluator' }).subscribe({
        next: docs => { if (docs?.length) this.configuredJobIds.add(job._id!); },
        error: () => {},
      });
    });
  }

  selectJob(job: JobOffer): void {
    this.selectedJobObj = job;

    if (this.isTestPeriodBlocked) {
      this._blockedJob    = job;
      this.selectedJobObj = null;
      this.showBlockedModal = true;
      return;
    }

    this._blockedJob        = null;
    this.selectedJobId      = job._id!;

    // ─── FIX : reset propre des deux configs avant chargement ─────────────
    this.rhConfig           = { enabled: true, ranges: [], evaluationGrid: [] };
    this.techConfig         = { enabled: true, ranges: [], evaluationGrid: [] };

    this.readyCandidates    = [];
    this.filteredCandidates = [];
    this.rhSessions         = [];
    this.techSessions       = [];
    this.assignmentDone     = false;
    this.selectedDay        = null;
    this.candidateReports   = [];
    this.activeView         = 'jobs';

    // ─── FIX : utiliser loadInterviewConfig() — lit depuis InterviewSession ─
    this.loadInterviewConfig();

    this.candidateService.getCandidatesByJob(job._id!).subscribe({
      next: (res: any) => {
        const ready: ReadyCandidate[] = [];
        (res?.candidates || []).forEach((c: any) => {
          const eligible = c.rhApproved === 'approved' && c.techStatus === 'approved';
          if (eligible) {
            ready.push({
              _id: c._id, name: c.name || c.email, email: c.email,
              phone: c.phone, avatarColor: c.avatarColor, aiMatchScore: c.aiMatchScore,
              jobId: job._id!, jobTitle: job.title, department: (job as any).department,
              rhApproved: c.rhApproved, techStatus: c.techStatus,
              applicationStatus: c.applicationStatus,
              adminDecision: c.adminDecision || null,
              interviews: c.interviews,
              sessionId: null,
            });
          }
        });
        this.readyCandidates = ready;
        this.applyFilters();
        if (this.isAdmin) this.buildAdminReports();
      },
      error: () => {},
    });

    this.loadSessions();
  }

  backToJobs(): void {
    this.stopTimer();
    this.selectedJobObj = null;
    this.selectedJobId  = 'all';
    this.activeView     = 'jobs';
  }

  buildAdminReports(): void {
    this.candidateReports = this.readyCandidates.map(c => ({
      candidateId: c._id,
      candidate:   c,
      rh:   this.rhSessions.find(s   => this.getCandidateId(s) === c._id) ?? null,
      tech: this.techSessions.find(s => this.getCandidateId(s) === c._id) ?? null,
    }));
  }

  private getCandidateId(row: SessionRow): string {
    return typeof row.candidate === 'string'
      ? row.candidate
      : (row.candidate as PopulatedCandidate)._id;
  }

  openReport(report: CandidateReport): void {
    this.selectedReport     = report;
    this.adminDecisionNotes = '';
  }

  applyAdminDecision(decision: 'hire' | 'reject'): void {
    if (!this.selectedReport || !this.selectedJobObj) return;
    this.adminDecisionSaving = true;
    this.sessionService.adminFinalDecision(
      this.selectedJobObj._id!,
      this.selectedReport.candidateId,
      decision,
      this.adminDecisionNotes
    ).subscribe({
      next: () => {
        this.adminDecisionSaving = false;
        if (this.selectedReport) {
          this.selectedReport.candidate.adminDecision = decision;
        }
        this.selectedReport = null;
        this.selectJob(this.selectedJobObj!);
      },
      error: () => { this.adminDecisionSaving = false; },
    });
  }

  applyFilters(): void {
    let list = [...this.readyCandidates];
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
      );
    }
    this.filteredCandidates = list;
  }

  onSearch(q: string): void { this.searchQuery = q; this.applyFilters(); }

  computeSlotCount(range: DayRange): number {
    const toMin = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const start = toMin(range.startTime);
    const end   = toMin(range.endTime);
    const step  = range.durationMinutes + range.breakMinutes;
    if (step <= 0) return 0;
    let count = 0, cur = start;
    while (cur + range.durationMinutes <= end) { count++; cur += step; }
    return count;
  }

  get totalSlots(): number {
    return this.myConfig.ranges.reduce((s, r) => s + this.computeSlotCount(r), 0);
  }

  addDay(): void {
    if (this.dayForm.invalid) return;
    const v: DayRange = { ...this.dayForm.value };
    const newRanges = [...this.myConfig.ranges, v].sort((a, b) =>
      (a.date + a.startTime).localeCompare(b.date + b.startTime)
    );
    if (this.myStage === 'technical evaluator') {
      this.techConfig = { ...this.techConfig, ranges: newRanges };
    } else {
      this.rhConfig = { ...this.rhConfig, ranges: newRanges };
    }
    this.dayForm.patchValue({ date: '', startTime: '', endTime: '' });
  }

  removeDay(i: number): void {
    const newRanges = this.myConfig.ranges.filter((_, idx) => idx !== i);
    if (this.myStage === 'technical evaluator') {
      this.techConfig = { ...this.techConfig, ranges: newRanges };
    } else {
      this.rhConfig = { ...this.rhConfig, ranges: newRanges };
    }
  }

  addCriterion(): void {
    if (this.criterionForm.invalid) return;
    const v = this.criterionForm.value as EvaluationCriterion;
    let newGrid: EvaluationCriterion[];

    if (this.editingCriterionIndex !== null) {
      newGrid = this.myConfig.evaluationGrid.map((c, i) =>
        i === this.editingCriterionIndex ? v : c
      );
      this.editingCriterionIndex = null;
    } else {
      newGrid = [...this.myConfig.evaluationGrid, v];
    }

    if (this.myStage === 'technical evaluator') {
      this.techConfig = { ...this.techConfig, evaluationGrid: newGrid };
    } else {
      this.rhConfig = { ...this.rhConfig, evaluationGrid: newGrid };
    }

    this.criterionForm.reset({ type: 'rating_5', weight: 1 });
  }

  editCriterion(i: number): void {
    this.editingCriterionIndex = i;
    this.criterionForm.patchValue(this.myConfig.evaluationGrid[i]);
  }

  removeCriterion(i: number): void {
    const newGrid = this.myConfig.evaluationGrid.filter((_, idx) => idx !== i);
    if (this.myStage === 'technical evaluator') {
      this.techConfig = { ...this.techConfig, evaluationGrid: newGrid };
    } else {
      this.rhConfig = { ...this.rhConfig, evaluationGrid: newGrid };
    }
    if (this.editingCriterionIndex === i) {
      this.editingCriterionIndex = null;
      this.criterionForm.reset({ type: 'rating_5', weight: 1 });
    }
  }

  cancelEditCriterion(): void {
    this.editingCriterionIndex = null;
    this.criterionForm.reset({ type: 'rating_5', weight: 1 });
  }

  saveConfig(): void {
    if (!this.selectedJobId || this.selectedJobId === 'all') return;
    this.savingConfig = true;
    this.sessionService.saveInterviewConfig(this.selectedJobId, {
      ...this.myConfig,
      stage: this.myStage,
    } as any).subscribe({
      next: () => {
        this.savingConfig = false;
        this.loadInterviewConfig();
      },
      error: (err) => {
        this.savingConfig = false;
        console.error('Save error:', err);
        alert('❌ Error saving: ' + (err.error?.message || err.message));
      },
    });
  }

  autoAssign(): void {
    if (!this.selectedJobId || this.selectedJobId === 'all') return;
    if (!this.myConfig.ranges.length)    { alert('Add at least one day.'); return; }
    if (!this.filteredCandidates.length) { alert('No eligible candidates.'); return; }
    this.assigning = true;
    this.sessionService.autoAssignSlots(this.selectedJobId, {
      stage:  this.myStage,
      ranges: this.myConfig.ranges,
    }).subscribe({
      next: res => {
        this.assignmentCount = res.assignments?.length || 0;
        this.assignmentDone  = true;
        this.assigning       = false;
        // ─── FIX : recharger configs avant selectJob() ─────────────────────
        // autoAssign → selectJob → getInterviewConfig lisait JobOffer vide
        // maintenant loadInterviewConfig() lit InterviewSession directement
        this.loadInterviewConfig();
        this.selectJob(this.selectedJobObj!);
      },
      error: (err) => {
        this.assigning = false;
        if (err.status === 409) {
          alert(err.error?.message || "Conflict detected: some candidates already have an interview scheduled for the other stage on the same day.");
        } else {
          alert("Error during auto-assignment.");
        }
      },
    });
  }

  openSchedule(c: ReadyCandidate, stage: 'rh' | 'technical evaluator'): void {
    if (!this.canManageStage(stage)) return;
    this.scheduleTarget = c;
    this.scheduleStage  = stage;
    const interviewKey  = this.getInterviewKey(stage);
    const existing      = c.interviews?.[interviewKey];
    if (existing?.scheduledAt) {
      const d = new Date(existing.scheduledAt);
      this.scheduleForm.patchValue({
        scheduledAt:   d.toISOString().slice(0, 10),
        startTime:     d.toTimeString().slice(0, 5),
        interviewType: existing.type || 'on-site',
        location:      existing.location || '',
      });
    } else {
      this.scheduleForm.reset({ interviewType: 'on-site' });
    }
    this.showScheduleModal = true;
  }

  saveSchedule(): void {
    if (this.scheduleForm.invalid || !this.scheduleTarget) return;
    this.scheduleSaving = true;
    const v           = this.scheduleForm.value;
    const scheduledAt = new Date(`${v.scheduledAt}T${v.startTime}`).toISOString();
    this.candidateService.scheduleInterview(
      this.scheduleTarget._id,
      this.scheduleTarget.jobId,
      {
        stage:       this.scheduleStage,
        scheduledAt,
        location:    v.location || null,
        type:        v.interviewType,
        notes:       v.notes   || null,
      } as any
    ).subscribe({
      next: () => {
        this.scheduleSaving    = false;
        this.showScheduleModal = false;
        this.selectJob(this.selectedJobObj!);
      },
      error: (err) => {
        this.scheduleSaving = false;
        if (err.status === 409) {
          alert(err.error?.message || "This candidate already has an interview for the other stage on the same day.");
        } else {
          alert('Error scheduling interview.');
        }
      },
    });
  }

  buildCalendar(): void {
    const year = this.calendarDate.getFullYear();
    const month = this.calendarDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: CalendarDay[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const yyyy = year;
      const mm = String(month + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const date = new Date(year, month, d);

      days.push({
        date,
        rhSessions:   this.rhSessions.filter(s => s.scheduledAt?.slice(0, 10) === dateStr),
        techSessions: this.techSessions.filter(s => s.scheduledAt?.slice(0, 10) === dateStr),
        allSessions:  this.allSessions.filter(s => s.scheduledAt?.slice(0, 10) === dateStr),
      });
    }
    this.calendarDays = days;
    if (this.isAdmin) this.buildAdminReports();
  }

  prevMonth(): void {
    this.calendarDate = new Date(
      this.calendarDate.getFullYear(),
      this.calendarDate.getMonth() - 1,
      1
    );
    this.buildCalendar();
  }

  nextMonth(): void {
    this.calendarDate = new Date(
      this.calendarDate.getFullYear(),
      this.calendarDate.getMonth() + 1,
      1
    );
    this.buildCalendar();
  }

  get calendarMonthLabel(): string {
    return this.calendarDate.toLocaleDateString('fr-FR', {
      month: 'long', year: 'numeric',
    });
  }

  getFirstDayOffset(): number {
    return (
      new Date(
        this.calendarDate.getFullYear(),
        this.calendarDate.getMonth(),
        1
      ).getDay() + 6
    ) % 7;
  }

  isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  }

  selectDay(day: CalendarDay): void {
    this.selectedDay = day.allSessions.length ? day : null;
  }

  todaySessions(): SessionRow[] {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    const rh    = this.rhSessions.filter(s   => s.scheduledAt?.slice(0, 10) === todayStr);
    const tech  = this.techSessions.filter(s => s.scheduledAt?.slice(0, 10) === todayStr);
    if (this.calendarStageFilter === 'rh')                  return rh;
    if (this.calendarStageFilter === 'technical evaluator') return tech;
    return [...rh, ...tech].sort(
      (a, b) =>
        new Date(a.scheduledAt ?? 0).getTime() -
        new Date(b.scheduledAt ?? 0).getTime()
    );
  }

  getCandidateObj(row: SessionRow | null): PopulatedCandidate | null {
    if (!row?.candidate) return null;
    if (typeof row.candidate === 'string') return null;
    return row.candidate as PopulatedCandidate;
  }

  startLiveEval(row: SessionRow): void {
    this.isReadOnlyEval = !this.canManageStage(row.stage);
    const candidateId   = this.getCandidateId(row);
    this.liveCandidate  = this.readyCandidates.find(c => c._id === candidateId) ?? null;

    if (row.criteria?.length) {
      this.liveCriteria = row.criteria.map((c: EvaluationCriterion) => ({
        ...c,
        value: c.value ?? null,
      }));
      this._openLiveView(row);
    } else {
      this.sessionService.getSession(row.sessionId).subscribe({
        next: (doc: InterviewSession) => {
          const grid = (doc as any).evaluationGrid as EvaluationCriterion[] || [];
          if (grid.length) {
            this.liveCriteria = grid.map(c => ({ ...c, value: null }));
          } else {
            const stageConfig = row.stage === 'technical evaluator'
              ? this.techConfig
              : this.rhConfig;
            this.liveCriteria = (stageConfig.evaluationGrid || []).map(c => ({
              ...c,
              value: null,
            }));
          }
          this._openLiveView(row);
        },
        error: () => {
          const stageConfig = row.stage === 'technical evaluator'
            ? this.techConfig
            : this.rhConfig;
          this.liveCriteria = (stageConfig.evaluationGrid || []).map(c => ({
            ...c,
            value: null,
          }));
          this._openLiveView(row);
        },
      });
    }
  }

  private _openLiveView(row: SessionRow): void {
    this.liveOverall  = row.overallRating  ?? 0;
    this.liveReco     = row.recommendation ?? 'consider';
    this.liveComments = row.comments       ?? '';
    this.timerSeconds = 0;
    this.timerRunning = false;
    this.stopTimer();

    this.liveSession = row;
    this.activeView  = 'live';

    if (row.status === 'scheduled' && !this.isReadOnlyEval) {
      this.sessionService
        .startCandidateSession(row.sessionId, this.getCandidateId(row))
        .subscribe({
          next: (updatedDoc: InterviewSession) => {
            const updated = flattenSession(updatedDoc);
            if (row.stage === 'rh') {
              this.rhSessions = [
                ...this.rhSessions.filter(s => s.sessionId !== row.sessionId),
                ...updated,
              ];
            } else {
              this.techSessions = [
                ...this.techSessions.filter(s => s.sessionId !== row.sessionId),
                ...updated,
              ];
            }
            if (this.liveSession) {
              this.liveSession = { ...this.liveSession, status: 'in_progress' };
            }
          },
          error: () => {},
        });
    }
  }

  closeLiveEval(): void {
    this.stopTimer();
    this.liveSession    = null;
    this.liveCandidate  = null;
    this.isReadOnlyEval = false;
    this.activeView     = 'calendar';
  }

  setCriterionValue(idx: number, val: any): void {
    if (this.isReadOnlyEval) return;
    this.liveCriteria = this.liveCriteria.map((c, i) =>
      i === idx ? { ...c, value: val } : c
    );
  }

  get computedScore(): number {
    const scoreable = this.liveCriteria.filter(
      c => c.type !== 'text' && c.value !== null && c.value !== undefined
    );
    if (!scoreable.length) return 0;
    let totalWeight = 0, weightedSum = 0;
    scoreable.forEach(c => {
      const w = c.weight || 1;
      let norm = 0;
      if (c.type === 'rating_5')  norm = (Number(c.value) - 1) / 4;
      if (c.type === 'rating_10') norm = (Number(c.value) - 1) / 9;
      if (c.type === 'yes_no')    norm = c.value === true ? 1 : 0;
      weightedSum += norm * w;
      totalWeight += w;
    });
    return totalWeight ? Math.round((weightedSum / totalWeight) * 100) / 10 : 0;
  }

  get ratedCount(): number {
    return this.liveCriteria.filter(
      c => c.type !== 'text' && c.value !== null && c.value !== undefined
    ).length;
  }

  get scoreableCount(): number {
    return this.liveCriteria.filter(c => c.type !== 'text').length;
  }

  saveEval(): void {
    if (!this.liveSession || this.isReadOnlyEval) return;
    this.evalSaving = true;
    const row = this.liveSession;

    this.sessionService.completeCandidateSession(
      row.sessionId,
      this.getCandidateId(row),
      {
        criteria:       this.liveCriteria,
        overallRating:  this.liveOverall || Math.round(this.computedScore),
        recommendation: this.liveReco,
        comments:       this.liveComments,
      }
    ).subscribe({
      next: (updatedDoc: InterviewSession) => {
        const updated = flattenSession(updatedDoc);
        if (row.stage === 'rh') {
          this.rhSessions = [
            ...this.rhSessions.filter(s => s.sessionId !== row.sessionId),
            ...updated,
          ];
        } else {
          this.techSessions = [
            ...this.techSessions.filter(s => s.sessionId !== row.sessionId),
            ...updated,
          ];
        }
        this.evalSaving = false;
        this.stopTimer();
        this.buildCalendar();
        this.closeLiveEval();
      },
      error: () => { this.evalSaving = false; },
    });
  }

  toggleTimer(): void {
    if (this.isReadOnlyEval) return;
    if (this.timerRunning) {
      this.stopTimer();
    } else {
      this.timerRunning  = true;
      this.timerInterval = setInterval(() => { this.timerSeconds++; }, 1000);
    }
  }

  stopTimer(): void {
    this.timerRunning = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  get timerDisplay(): string {
    const m = Math.floor(this.timerSeconds / 60).toString().padStart(2, '0');
    const s = (this.timerSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  setView(v: 'jobs' | 'calendar' | 'live' | 'admin-decisions'): void {
    if (v === 'calendar') this.buildCalendar();
    this.activeView = v;
  }

  getInitials(name: string): string {
    return (name || '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }

  formatDateTime(iso: string | undefined | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return date.toLocaleString('fr-FR', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      timeZone: 'Africa/Tunis'
    });
  }

  formatDate(ymd: string): string {
    const [year, month, day] = ymd.split('-');
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return date.toLocaleDateString('fr-FR', {
      weekday: 'short', day: '2-digit', month: 'short',
    });
  }

  formatTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return date.toLocaleTimeString('fr-FR', {
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Africa/Tunis'
    });
  }

  isScheduled(c: ReadyCandidate, stage: 'rh' | 'technical evaluator'): boolean {
    const key = this.getInterviewKey(stage);
    return !!c.interviews?.[key]?.scheduledAt;
  }

  scheduledCount(stage: 'rh' | 'technical evaluator'): number {
    return this.readyCandidates.filter(c => this.isScheduled(c, stage)).length;
  }

  pendingCount(stage: 'rh' | 'technical evaluator'): number {
    return this.readyCandidates.filter(c => !this.isScheduled(c, stage)).length;
  }

  criterionTypeLabel(t: string): string {
    const map: Record<string, string> = {
      rating_5:  'Note /5',
      rating_10: 'Note /10',
      yes_no:    'Oui/Non',
      text:      'Texte libre',
    };
    return map[t] || t;
  }

  range(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i + 1);
  }

  getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      scheduled:   'Scheduled',
      in_progress: 'In progress',
      completed:   'Completed',
    };
    return map[status] || status;
  }

  getSessionStageLabel(stage: string): string {
    return stage === 'rh' ? '👔 RH' : '💻 Tech';
  }

  getScoreColor(score: number): string {
    if (score >= 7) return '#22c55e';
    if (score >= 4) return '#f59e0b';
    return '#ef4444';
  }

  pendingDecisionCount(): number {
    return this.readyCandidates.filter(c => !c.adminDecision).length;
  }

  hiredCount(): number {
    return this.readyCandidates.filter(c => c.adminDecision === 'hire').length;
  }

  rejectedCount(): number {
    return this.readyCandidates.filter(c => c.adminDecision === 'reject').length;
  }

  get candidatesTableData(): Array<{
    candidate:   ReadyCandidate;
    rhSession:   SessionRow | null;
    techSession: SessionRow | null;
  }> {
    return this.readyCandidates.map(c => ({
      candidate:   c,
      rhSession:   this.rhSessions.find(s   => this.getCandidateId(s) === c._id) ?? null,
      techSession: this.techSessions.find(s => this.getCandidateId(s) === c._id) ?? null,
    }));
  }

  deleteStageConfiguration(stage: 'rh' | 'technical evaluator'): void {
    if (!this.selectedJobObj) return;
    const confirmMsg = stage === 'rh'
      ? '⚠️ Delete all RH configuration (slots, grid) and all scheduled assignments? This action is irreversible.'
      : '⚠️ Delete all TECH configuration (slots, grid) and all scheduled assignments? This action is irreversible.';
    if (!confirm(confirmMsg)) return;

    this.loading = true;
    this.sessionService.deleteStageConfig(this.selectedJobObj._id!, stage).subscribe({
      next: () => {
        this.loading = false;
        this.selectJob(this.selectedJobObj!);
        alert(`${stage === 'rh' ? 'RH' : 'Tech'} configuration deleted successfully.`);
      },
      error: (err) => {
        this.loading = false;
        alert('Error deleting: ' + (err.error?.message || err.message));
      }
    });
  }

  // ─── Deadline helpers ────────────────────────────────────────────────────────

  get missedInterviewsJobs(): JobOffer[] {
    return this.jobs.filter(job =>
      !this.hasInterviewsConfigured(job) && this.getInterviewDeadlineUrgency(job) === 'missed'
    );
  }

  get upcomingInterviewsJobs(): JobOffer[] {
    return this.jobs.filter(job =>
      !this.hasInterviewsConfigured(job) &&
      (this.getInterviewDeadlineUrgency(job) === 'critical' || this.getInterviewDeadlineUrgency(job) === 'soon')
    );
  }

  getInterviewDeadlineUrgency(job: JobOffer): DeadlineUrgency {
    const rhDeadline = job.intervAssignments?.rhTest?.deadline
      ? new Date(job.intervAssignments.rhTest.deadline)
      : null;
    const techDeadline = job.intervAssignments?.technicalTest?.deadline
      ? new Date(job.intervAssignments.technicalTest.deadline)
      : null;

    const now = Date.now();
    let bestUrgency: DeadlineUrgency = null;
    let bestDays = Infinity;

    const evaluate = (deadline: Date | null) => {
      if (!deadline) return;
      const diff = deadline.getTime() - now;
      const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
      let urgency: DeadlineUrgency;
      if (days < 0)       urgency = 'missed';
      else if (days <= 2) urgency = 'critical';
      else if (days <= 5) urgency = 'soon';
      else                urgency = 'ok';

      if (days < bestDays) {
        bestDays    = days;
        bestUrgency = urgency;
      }
    };

    evaluate(rhDeadline);
    evaluate(techDeadline);
    return bestUrgency;
  }

  interviewDeadlineLabel(job: JobOffer): string {
    const rhDeadline = job.intervAssignments?.rhTest?.deadline
      ? new Date(job.intervAssignments.rhTest.deadline)
      : null;
    const techDeadline = job.intervAssignments?.technicalTest?.deadline
      ? new Date(job.intervAssignments.technicalTest.deadline)
      : null;

    const now = Date.now();
    let closestDays: number | null = null;
    let closestDate: Date | null = null;

    for (const d of [rhDeadline, techDeadline]) {
      if (!d) continue;
      const days = Math.ceil((d.getTime() - now) / (1000 * 60 * 60 * 24));
      if (closestDays === null || Math.abs(days) < Math.abs(closestDays)) {
        closestDays = days;
        closestDate = d;
      }
    }

    if (!closestDate) return '';
    const d = closestDays!;
    if (d < 0)   return `Overdue by ${Math.abs(d)} day${Math.abs(d) !== 1 ? 's' : ''}`;
    if (d === 0) return 'Due today!';
    if (d === 1) return 'Due tomorrow!';
    return `${d} days left`;
  }

  interviewDeadlineDate(job: JobOffer): string {
    const rhDeadline = job.intervAssignments?.rhTest?.deadline
      ? new Date(job.intervAssignments.rhTest.deadline)
      : null;
    const techDeadline = job.intervAssignments?.technicalTest?.deadline
      ? new Date(job.intervAssignments.technicalTest.deadline)
      : null;

    let closest: Date | null = null;
    let closestDays = Infinity;
    const now = Date.now();

    for (const d of [rhDeadline, techDeadline]) {
      if (!d) continue;
      const days = Math.ceil((d.getTime() - now) / (1000 * 60 * 60 * 24));
      if (Math.abs(days) < Math.abs(closestDays)) {
        closestDays = days;
        closest = d;
      }
    }

    if (!closest) return '';
    return closest.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  hasInterviewsConfigured(job: JobOffer): boolean {
    return !!(
      job.interviewConfig?.rh?.ranges?.length ||
      job.interviewConfig?.tech?.ranges?.length ||
      this.configuredJobIds.has(job._id!)
    );
  }

  // ─── FIX : loadSessions hydrate rhConfig/techConfig comme filet de sécurité ─
  private loadSessions(): void {
    if (!this.selectedJobObj) return;
    const jobId = this.selectedJobObj._id!;

    this.sessionService.getSessions({ jobId, stage: 'rh' }).subscribe({
      next: docs => {
        this.rhSessions = docs.flatMap(flattenSession);
        if (docs?.length) {
          this.configuredJobIds.add(jobId);
          // Filet de sécurité : si loadInterviewConfig() n'a pas encore répondu
          // ou a retourné des ranges vides, on hydrate depuis la session
          const session = docs[0] as any;
          if (session.scheduledRanges?.length && !this.rhConfig.ranges.length) {
            this.rhConfig = {
              enabled:        true,
              ranges:         session.scheduledRanges  || [],
              evaluationGrid: session.evaluationGrid   || [],
            };
          }
        }
        this.buildCalendar();
      },
      error: () => { this.buildCalendar(); },
    });

    this.sessionService.getSessions({ jobId, stage: 'technical evaluator' }).subscribe({
      next: docs => {
        this.techSessions = docs.flatMap(flattenSession);
        if (docs?.length) {
          this.configuredJobIds.add(jobId);
          // Idem pour techConfig
          const session = docs[0] as any;
          if (session.scheduledRanges?.length && !this.techConfig.ranges.length) {
            this.techConfig = {
              enabled:        true,
              ranges:         session.scheduledRanges  || [],
              evaluationGrid: session.evaluationGrid   || [],
            };
          }
        }
        this.buildCalendar();
      },
      error: () => {},
    });
  }
}