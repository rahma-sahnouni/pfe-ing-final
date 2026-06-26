// src/app/_services/candidate.service.ts
import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpParams,
  HttpRequest,
  HttpEventType,
  HttpResponse,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { JobOffer } from './job-offer.service';

const API = 'http://localhost:3000/api';

// ── Profile ───────────────────────────────────────────────────────────────────

// ── Sous-interfaces CVExtracted ───────────────────────────────────────────────

export interface CVLanguage {
  name:   string;
  code:   string;
  level?: string | null;   // CEFR : A1, A2, B1, B2, C1, C2 ou null
}

export interface CVEducation {
  degree:       string;
  institution?: string | null;
  year?:        string | null;
  inProgress?:  boolean;   // true si formation en cours
}

export interface CVExperience {
  title:        string;
  company:      string;
  duration?:    string | null;
  type?:        'stage' | 'job';   // distingue stage et emploi
  description?: string | null;
}

// ── Interface principale ──────────────────────────────────────────────────────

export interface CVExtracted {
  name?:            string;
  email?:           string;
  phone?:           string;
  location?:        string;
  summary?:         string;
  skills?:          string[];
  languages?:       CVLanguage[];      // ← objets, plus string[]
  certifications?:  string[];
  education?:       CVEducation[];     // ← avec inProgress
  experience?:      CVExperience[];    // ← avec type stage/job
  yearsExperience?: number;            // ← total pondéré (stages × 0.5)
}

export interface CandidateProfile {
  _id:          string;
  email:        string;
  name?:        string;
  phone?:       string;
  location?:    string;
  experience?:  number;
  score?:       number;
  avatarColor?: string;
  applications: Application[];
  cv?:          { fileName?: string; uploadedAt?: string; path?: string; originalName?: string };
  cvExtracted?: CVExtracted;
}

export interface Application {
  jobOffer:    string | JobOfferRef;
  appliedDate: string;
  status:      ApplicationStatus;
}

export type ApplicationStatus =
  | 'Pending' | 'In Review' | 'RH Interview' | 'Tech Interview' | 'Accepted' | 'Rejected';

export interface JobOfferRef {
  _id:           string;
  title:         string;
  department?:   string;
  location?:     string;
  contractType?: string;
  status?:       string;
}


export type CvUploadEvent =
  | { type: 'progress'; value: number }
  | { type: 'response'; data: any };

// ── Journey ───────────────────────────────────────────────────────────────────

export interface InterviewInfo {
  scheduledAt: string | null;
  location:    string | null;
  type:        'on-site' | 'video' | 'phone' | null;
  notes:       string | null;
  completed:   boolean;
}

export interface TestSubmissionSummary {
  _id:             string;
  testKind:        'rh' | 'technical';
  rhTest?:         string;
  technicalTest?:  string;
  score:           number | null;
  status:          'submitted' | 'evaluated' | 'pending_review';
  scoreBreakdown?: Record<string, any>;
  submittedAt:     string;
  evaluatedAt:     string | null;
}

export interface RhTestSummary {
  _id:        string;
  name:       string;
  status:     string;
  submitted:  boolean;
  submission: TestSubmissionSummary | null;
}

export interface TechTestSummary {
  _id:        string;
  title:      string;
  testType:   string;
  difficulty: string;
  submitted:  boolean;
  submission: TestSubmissionSummary | null;
}

export interface JourneyItem {
  jobOffer:          JobOfferRef & { contractType: string };
  applicationStatus: ApplicationStatus;
  appliedDate:       string;
  interviews?: {
    rh?:  InterviewInfo;
    tech?: InterviewInfo;
  };
  interview:         InterviewInfo | null;
  currentStage:      number;
  aiMatchScore:      number | null;
  preSelected:       boolean;
  overallTestScore:  number | null;
  rhTests:           RhTestSummary[];
  technicalTests:    TechTestSummary[];
  submissions:       TestSubmissionSummary[];
  rhApproved:        'pending' | 'approved' | 'rejected';
  techStatus:        'pending' | 'approved' | 'rejected';
  testPeriod?:       { start: string | null; end: string | null };
}

export interface JourneyResponse {
  journey: JourneyItem[];
}

// ── Candidate list (RH / Admin view) ─────────────────────────────────────────

export interface CandidateSummary {
  _id:               string;
  name:              string;
  email:             string;
  phone?:            string;
  location?:         string;
  experience?:       number;
  score?:            number;
  aiMatchScore:      number | null;
  preSelected:       boolean;
  avatarColor?:      string;
  cv?:               any;
  cvExtracted?:      CVExtracted;
  applicationStatus: ApplicationStatus;
  appliedDate?:      string;
  rhApproved:        'pending' | 'approved' | 'rejected';
  techStatus:        'pending' | 'approved' | 'rejected';
  interviews:        { rh: InterviewInfo | null; tech: InterviewInfo | null };
}

// ── My Tests (candidate test-taking view) ─────────────────────────────────────

export interface ResponseOption {
  text:          string;
  score:         number;
  criterionKey?: string | null;
}

export interface Question {
  _id:        string;
  text:       string;
  answerType: 'single_choice' | 'likert' | 'multiple_choice';
  options:    ResponseOption[];
  likertMin?: string;
  likertMax?: string;
}

export interface Criterion {
  key:   string;
  label: string;
  color: string;
}

export interface TestModel {
  _id:             string;
  modelType:       string;
  label:           string;
  weight:          number;
  questions:       Question[];
  customCriteria?: Criterion[];
}

export interface Theme {
  _id:      string;
  name:     string;
  category: string;
  models:   TestModel[];
}

export interface RhTest {
  _id:               string;
  job:               string;
  name:              string;
  description?:      string;
  status:            string;
  themes:            Theme[];
  timeLimitMinutes?: number | null;
}

export interface QcmQuestion {
  _id:            string;
  questionText:   string;
  type:           'single_choice' | 'multiple_choice' | 'open';
  options:        { _id: string; text: string; isCorrect: boolean }[];
  correctAnswer?: string;
  points:         number;
}

export interface TechnicalTest {
  _id:              string;
  title:            string;
  description?:     string;
  testType:         'problem_solving' | 'qcm' | 'mixed';
  difficulty:       'easy' | 'medium' | 'hard';
  timeLimitMinutes: number;
  problemSolving?: {
    description?:        string;
    examples:            { input: any; output: any; explanation?: string }[];
    constraints:         { label: string }[];
    expectedComplexity?: string;
  };
  qcm?:  { questions: QcmQuestion[] };
  tags?:  string[];
  order?: number;
}

export interface JobTestPayload {
  jobOffer:          JobOfferRef;
  applicationStatus: string;
  appliedDate:       string;
  rhTests:           RhTest[];
  technicalTests:    TechnicalTest[];
  submissions:       TestSubmissionSummary[];
  submittedRhIds:    string[];
  submittedTechIds:  string[];
}

export interface MyTestsResponse {
  jobs: JobTestPayload[];
}

export interface PrereqDetail {
  type:       string;
  label:      string;
  obligatory: boolean;
  matched:    boolean;
}


export interface RecommendedJob {
  job: JobOffer;
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  blockedByPrereqs: Array<{ type: string; value: string }>;
  prereqDetails: Array<{
    type: string;
    label: string;
    obligatory: boolean;
    matched: boolean;
  }>;
  semanticScore?: number;
  experienceScore?: number;
  levelScore?: number;
  recommendation: string;
  analysis?: string | null;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class CandidateService {

  constructor(private http: HttpClient) {}

  // ── Profile ───────────────────────────────────────────────────────────────

  getProfile(): Observable<CandidateProfile> {
    return this.http.get<CandidateProfile>(`${API}/candidates/profile`);
  }

  updateProfile(payload: Pick<CandidateProfile, 'name' | 'phone' | 'location' | 'experience' | 'avatarColor'>): Observable<CandidateProfile> {
    return this.http.patch<CandidateProfile>(`${API}/candidates/profile`, payload);
  }

  // ── CV ────────────────────────────────────────────────────────────────────

  uploadCV(file: File): Observable<CvUploadEvent> {
    const form = new FormData();
    form.append('cv', file);
    return this.http.request<any>(
      new HttpRequest('POST', `${API}/candidates/cv`, form, { reportProgress: true })
    ).pipe(
      map(event => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          return { type: 'progress' as const, value: Math.round((100 * event.loaded) / event.total) };
        }
        if (event instanceof HttpResponse) {
          return { type: 'response' as const, data: event.body };
        }
        return null;
      }),
      filter((e): e is CvUploadEvent => e !== null),
    );
  }

  // ── AI recommendations ────────────────────────────────────────────────────

  getRecommendedJobs(): Observable<{ recommendations: RecommendedJob[] }> {
    return this.http.get<{ recommendations: RecommendedJob[] }>(`${API}/candidates/recommended-jobs`);
  }

  // ── Applications ──────────────────────────────────────────────────────────

  applyWithCV(jobId: string, formData: FormData): Observable<{ message: string; jobId: string; aiScore: number | null }> {
    return this.http.post<{ message: string; jobId: string; aiScore: number | null }>(
      `${API}/candidates/${jobId}/apply`,
      formData
    );
  }

  getCandidatesByJob(jobId: string): Observable<{ candidates: CandidateSummary[] }> {
    return this.http.get<{ candidates: CandidateSummary[] }>(`${API}/candidates/by-job/${jobId}`);
  }

  preSelectCandidate(candidateId: string, jobId: string, preSelected: boolean): Observable<{ message: string; preSelected: boolean }> {
    return this.http.patch<{ message: string; preSelected: boolean }>(
      `${API}/candidates/${candidateId}/application/${jobId}/preselect`,
      { preSelected }
    );
  }

  updateApplicationStatus(candidateId: string, jobId: string, status: ApplicationStatus, feedback?: string): Observable<{ message: string; status: ApplicationStatus }> {
    return this.http.patch<{ message: string; status: ApplicationStatus }>(
      `${API}/candidates/${candidateId}/application/${jobId}/status`,
      { status, feedback }
    );
  }

  scheduleInterview(candidateId: string, jobId: string, payload: Partial<InterviewInfo>): Observable<any> {
    return this.http.patch(
      `${API}/candidates/${candidateId}/application/${jobId}/interview`,
      payload
    );
  }

  // ── Test decisions ────────────────────────────────────────────────────────

  approveTest(candidateId: string, jobId: string, testKind: 'rh' | 'technical'): Observable<any> {
    return this.http.patch(
      `${API}/candidates/${candidateId}/application/${jobId}/approve-test`,
      { testKind }
    );
  }

  rejectTest(candidateId: string, jobId: string, testKind: 'rh' | 'technical'): Observable<any> {
    return this.http.patch(
      `${API}/candidates/${candidateId}/application/${jobId}/reject-test`,
      { testKind }
    );
  }

  // ── Journey ───────────────────────────────────────────────────────────────

  getJourney(): Observable<JourneyResponse> {
    return this.http.get<JourneyResponse>(`${API}/candidates/journey`);
  }

  // ── My Tests ──────────────────────────────────────────────────────────────

  getMyTests(jobId?: string): Observable<MyTestsResponse> {
    let params = new HttpParams();
    if (jobId) params = params.set('jobId', jobId);
    return this.http.get<MyTestsResponse>(`${API}/candidates/my-tests`, { params });
  }
}