// src/app/_services/technical-test.service.ts
// Module: Technical Tests — CRUD + job assignment
// Maps to: controllers/technicalTest.controller.js

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

const API = 'http://localhost:3000/api/technical-tests';

// ── Interfaces ────────────────────────────────────────────────────────────────

export type TestType = 'problem_solving' | 'qcm' | 'mixed';

export interface QcmOption {
  _id?:      string;
  text:      string;
  isCorrect: boolean;
}

export interface QcmQuestion {
  _id?:           string;
  questionText:   string;
  type:           'single_choice' | 'multiple_choice' | 'open';
  options:        QcmOption[];
  correctAnswer?: string;
  points:         number;
}

export interface PsExample {
  input:        string;
  output:       string;
  explanation?: string;
}

export interface TechnicalTest {
  _id?:              string;
  title:             string;
  description?:      string;
  testType:          TestType;
  difficulty:        'easy' | 'medium' | 'hard';
  timeLimitMinutes:  number;
  tags?:             string[];
  isPublic?:         boolean;
  order?:            number;
  problemSolving?: {
    description?:       string;
    examples:           PsExample[];
    constraints?:       { label: string }[];
    expectedComplexity?: string;
  };
  qcm?: {
    questions: QcmQuestion[];
  };
}

export interface TechnicalTestFilters {
  difficulty?: 'easy' | 'medium' | 'hard';
  tag?:        string;
  testType?:   TestType;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class TechnicalTestService {

  constructor(private http: HttpClient) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** POST /technical-tests/create-and-assign — create + immediately assign to a job */
  createAndAssign(payload: TechnicalTest & { jobId: string; order?: number }): Observable<{ test: TechnicalTest; job: any }> {
    return this.http.post<{ test: TechnicalTest; job: any }>(`${API}/create-and-assign`, payload);
  }

  /** GET /technical-tests — current user's tests, with optional filters */
  getMyTests(filters?: TechnicalTestFilters): Observable<TechnicalTest[]> {
    let params = new HttpParams();
    if (filters?.difficulty) params = params.set('difficulty', filters.difficulty);
    if (filters?.tag)        params = params.set('tag', filters.tag);
    if (filters?.testType)   params = params.set('testType', filters.testType);
    return this.http.get<TechnicalTest[]>(API, { params });
  }

  /** GET /technical-tests/:id */
  getTestById(id: string): Observable<TechnicalTest> {
    return this.http.get<TechnicalTest>(`${API}/${id}`);
  }

  /** PUT /technical-tests/:id */
  updateTest(id: string, payload: Partial<TechnicalTest>): Observable<TechnicalTest> {
    return this.http.put<TechnicalTest>(`${API}/${id}`, payload);
  }

  /** DELETE /technical-tests/:id */
  deleteTest(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${API}/${id}`);
  }

  // ── Job assignment ────────────────────────────────────────────────────────

  /** POST /technical-tests/jobs/:jobId/assign */
  assignTestToJob(jobId: string, testId: string, order = 0): Observable<any> {
    return this.http.post(`${API}/jobs/${jobId}/assign`, { testId, order });
  }

  /** DELETE /technical-tests/jobs/:jobId/tests/:testId */
  removeTestFromJob(jobId: string, testId: string): Observable<any> {
    return this.http.delete(`${API}/jobs/${jobId}/tests/${testId}`);
  }

  /** GET /technical-tests/job/:jobId */
  getTestsByJob(jobId: string): Observable<TechnicalTest[]> {
    return this.http.get<TechnicalTest[]>(`${API}/job/${jobId}`);
  }
}