// src/app/_services/submission.service.ts
// Module: Test Submissions — submit, read, evaluate (RH + Technical)
// Maps to: controllers/testSubmission.controller.js

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const API = 'http://localhost:3000/api';

// ── Interfaces ────────────────────────────────────────────────────────────────

export type SubmissionStatus = 'submitted' | 'evaluated' | 'pending_review';

export interface RhAnswer {
  questionId: string;
  value:      string | string[] | number;
}

export interface QcmAnswer {
  questionId:      string;
  selectedOptions: string[];
}

export interface ScoreBreakdown {
  [key: string]: number | string | null;
}

export interface TestSubmission {
  _id:       string;
  candidate: { _id: string; name: string; email: string; avatarColor: string };
  job:       { _id: string; title: string; department: string };
  rhTest?:   { _id: string; name: string; themes?: any[] } | null;
  technicalTest?: {
    _id:        string;
    title:      string;
    testType:   string;
    difficulty: string;
  } | null;
  testKind:       'rh' | 'technical';
  rhAnswers:      RhAnswer[];
  score:          number | null;
  maxScore:       number | null;
  scoreBreakdown: ScoreBreakdown;
  status:         SubmissionStatus;
  submittedAt:    string;
  evaluatedAt:    string | null;
}

// ── Submit payloads ───────────────────────────────────────────────────────────

export interface RhSubmitPayload {
  answers: RhAnswer[];
}


export interface SubmitResponse {
  message:         string;
  score:           number | null;
  needsReview?:    boolean;
  scoreBreakdown?: ScoreBreakdown;
  submission:      string;
}
export interface TechnicalSubmitPayload {
  code?:             string;
  language?:         string;
  complexity?:       any;
  testResults?:      any[];
  qcmAnswers?:       QcmAnswer[];
  timeSpentSeconds?: number | null;  // ← add null
  antiCheatReport?:  any;
}
// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class SubmissionService {

  constructor(private http: HttpClient) {}

  // ── Submit ────────────────────────────────────────────────────────────────

  /**
   * POST /job-tests/:jobId/submit
   * Candidate submits RH psychometric answers.
   */
  submitRhAnswers(jobId: string, payload: RhSubmitPayload): Observable<SubmitResponse> {
    return this.http.post<SubmitResponse>(`${API}/job-tests/${jobId}/submit`, payload);
  }

  /**
   * POST /technical-tests/:testId/submit
   * Candidate submits technical test (code + QCM).
   */
  submitTechnicalAnswers(testId: string, payload: TechnicalSubmitPayload): Observable<SubmitResponse> {
    return this.http.post<SubmitResponse>(`${API}/technical-tests/${testId}/submit`, payload);
  }

  // ── Read (candidate) ──────────────────────────────────────────────────────

  /** GET /submissions/my — candidate's own submission history */
  getMySubmissions(): Observable<TestSubmission[]> {
    return this.http.get<TestSubmission[]>(`${API}/submissions/my`);
  }

  // ── Read (RH / evaluator) ─────────────────────────────────────────────────

  /** GET /submissions/rh — all RH submissions for jobs assigned to current user */
  getRhSubmissions(): Observable<TestSubmission[]> {
    return this.http.get<TestSubmission[]>(`${API}/submissions/rh`);
  }

  /** GET /submissions/technical — all technical submissions for assigned jobs */
  getTechnicalSubmissions(): Observable<TestSubmission[]> {
    return this.http.get<TestSubmission[]>(`${API}/submissions/technical`);
  }

  /** GET /submissions/job/:jobId/candidate/:candidateId */
  getCandidateSubmissions(jobId: string, candidateId: string): Observable<TestSubmission[]> {
    return this.http.get<TestSubmission[]>(`${API}/submissions/job/${jobId}/candidate/${candidateId}`);
  }

  /** GET /submissions/job/:jobId/all */
  getAllSubmissionsForJob(jobId: string): Observable<TestSubmission[]> {
    return this.http.get<TestSubmission[]>(`${API}/submissions/job/${jobId}/all`);
  }

  // ── Evaluate (manual scoring) ─────────────────────────────────────────────

  /** PATCH /submissions/:id/evaluate */
  evaluateSubmission(submissionId: string, payload: Partial<Pick<TestSubmission, 'status' | 'score' | 'scoreBreakdown'>>): Observable<TestSubmission> {
    return this.http.patch<TestSubmission>(`${API}/submissions/${submissionId}/evaluate`, payload);
  }
}