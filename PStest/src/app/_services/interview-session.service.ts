// src/app/_services/interview-session.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

// ─── Shared types (exported for use in the component) ────────────────────────

export interface EvaluationCriterion {
  label:       string;
  description: string | null;
  type:        'rating_5' | 'rating_10' | 'yes_no' | 'text';
  weight:      number;
  value?:      any;
}

export interface DayRange {
  date:            string; // YYYY-MM-DD
  startTime:       string; // HH:MM
  endTime:         string; // HH:MM
  durationMinutes: number;
  breakMinutes:    number;
}

export interface InterviewConfig {
  enabled:        boolean;
  ranges:         DayRange[];
  evaluationGrid: EvaluationCriterion[];
}

export type Recommendation = 'hire' | 'reject' | 'consider';

export interface PopulatedCandidate {
  _id:         string;
  name:        string;
  email:       string;
  avatarColor: string;
}

export interface CandidateEvaluation {
  _id?:          string;
  candidate:     string | PopulatedCandidate;
  conductedBy?:  string | null;

  scheduledAt?:   string | null;
  interviewType?: 'video' | 'on-site' | 'phone';
  location?:      string | null;
  notes?:         string | null;

  status:     'scheduled' | 'in_progress' | 'completed';
  startedAt?: string | null;
  endedAt?:   string | null;

  criteria?:       EvaluationCriterion[];
  overallRating?:  number | null;
  recommendation?: Recommendation | null;
  comments?:       string | null;

  adminDecision?: 'hire' | 'reject' | null;
  adminNotes?:    string | null;
  decidedAt?:     string | null;
}

export interface InterviewSession {
  _id:    string;
  job:    string | { _id: string; title: string; department?: string };
  stage:  'rh' | 'technical evaluator';

  conductedBy?:    string | null;
  evaluationGrid:  EvaluationCriterion[];
  scheduledRanges: DayRange[];

  candidateEvaluations: CandidateEvaluation[];

  createdAt?: string;
  updatedAt?: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class InterviewSessionService {

  private base = 'http://localhost:3000/api/interview-sessions';

  constructor(private http: HttpClient) {}

  // ── Config ──────────────────────────────────────────────────────────────────

  getInterviewConfig(jobId: string): Observable<{ rh: InterviewConfig; tech: InterviewConfig }> {
    return this.http.get<{ rh: InterviewConfig; tech: InterviewConfig }>(
      `${this.base}/config/${jobId}`
    );
  }

  saveInterviewConfig(
    jobId: string,
    payload: Partial<InterviewConfig> & { stage: 'rh' | 'technical evaluator' }
  ): Observable<any> {
    return this.http.post(`${this.base}/config/${jobId}`, payload);
  }

  // ── Auto-assign ─────────────────────────────────────────────────────────────

  autoAssignSlots(
    jobId: string,
    payload: { stage: 'rh' | 'technical evaluator'; ranges: DayRange[] }
  ): Observable<{ message: string; assignments: any[] }> {
    return this.http.post<{ message: string; assignments: any[] }>(
      `${this.base}/auto-assign/${jobId}`,
      payload
    );
  }

  // ── Session CRUD ────────────────────────────────────────────────────────────

  getSessions(filters: {
    jobId?: string;
    stage?: string;
    date?:  string;
  }): Observable<InterviewSession[]> {
    let params = new HttpParams();
    if (filters.jobId) params = params.set('jobId', filters.jobId);
    if (filters.stage) params = params.set('stage', filters.stage);
    if (filters.date)  params = params.set('date',  filters.date);
    return this.http.get<InterviewSession[]>(this.base, { params });
  }

  // Fetches a single session — used in startLiveEval() to get evaluationGrid
  // when the candidate row has no criteria yet.
  getSession(id: string): Observable<InterviewSession> {
    return this.http.get<InterviewSession>(`${this.base}/${id}`);
  }

  // ── Candidate lifecycle ─────────────────────────────────────────────────────
  // Router defines: /:id/candidate/:candidateId/{start|complete|schedule}
  //                            ↑ singular "candidate", not "candidates"

  startCandidateSession(sessionId: string, candidateId: string): Observable<InterviewSession> {
    return this.http.patch<InterviewSession>(
      `${this.base}/${sessionId}/candidate/${candidateId}/start`,
      {}
    );
  }

  completeCandidateSession(
    sessionId:   string,
    candidateId: string,
    payload: {
      criteria?:       EvaluationCriterion[];
      overallRating?:  number;
      recommendation?: Recommendation;
      comments?:       string;
    }
  ): Observable<InterviewSession> {
    return this.http.patch<InterviewSession>(
      `${this.base}/${sessionId}/candidate/${candidateId}/complete`,
      payload
    );
  }

  scheduleCandidateSession(
    sessionId:   string,
    candidateId: string,
    payload: {
      scheduledAt:    string;
      interviewType?: string;
      location?:      string | null;
      notes?:         string | null;
    }
  ): Observable<InterviewSession> {
    return this.http.patch<InterviewSession>(
      `${this.base}/${sessionId}/candidate/${candidateId}/schedule`,
      payload
    );
  }

  // ── Admin ───────────────────────────────────────────────────────────────────
  // Router defines: GET  /admin/candidate-report
  //                 POST /admin/final-decision

  getCandidateReport(jobId: string, candidateId: string): Observable<any> {
    const params = new HttpParams()
      .set('jobId',       jobId)
      .set('candidateId', candidateId);
    return this.http.get(`${this.base}/admin/candidate-report`, { params });
  }

  adminFinalDecision(
    jobId:       string,
    candidateId: string,
    decision:    'hire' | 'reject',
    notes?:      string,
    stage?:      string
  ): Observable<any> {
    return this.http.post(`${this.base}/admin/final-decision`, {
      jobId, candidateId, decision, notes, stage,
    });
  }

  deleteStageConfig(jobId: string, stage: string): Observable<any> {
  return this.http.delete(`${this.base}/config/${jobId}?stage=${stage}`);
}
}