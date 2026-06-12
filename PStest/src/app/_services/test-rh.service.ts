// src/app/_services/test-rh.service.ts
// Module: RH Psychometric Tests — CRUD (test → themes → models → questions)
// Maps to: controllers/testRh.controller.js

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const API = 'http://localhost:3000/api/job-tests';

// ── Interfaces ────────────────────────────────────────────────────────────────

export type AnswerType      = 'single_choice' | 'likert' | 'multiple_choice';
export type ThemeCategory   = 'personality' | 'motivation' | 'behavior' | 'logical_reasoning' | 'emotional_intelligence' | 'custom';
export type ModelType       = 'disc' | 'mbti' | 'big_five' | 'eq_i' | 'custom';
export type TestStatus      = 'draft' | 'active' | 'archived';

export interface ResponseOption {
  text:          string;
  score:         number;
  criterionKey?: string | null;
}

export interface Question {
  _id?:                  string;
  text:                  string;
  answerType:            AnswerType;
  options:               ResponseOption[];
  likertMin?:            string;
  likertMax?:            string;
  likertCriterionKey?:   string | null;
  likertReversed?:       boolean;
  questionCriterionKey?: string | null;
}

export interface Criterion {
  key:   string;
  label: string;
  color: string;
}

export interface TestModel {
  _id?:            string;
  modelType:       ModelType;
  label?:          string;
  weight:          number;
  customCriteria?: Criterion[];
  questions:       Question[];
}

export interface Theme {
  _id?:     string;
  name:     string;
  category: ThemeCategory;
  models:   TestModel[];
}

export interface JobTest {
  _id?:        string;
  job:         string;
  name:        string;
  description?: string;
  status:      TestStatus;
  themes:      Theme[];
  createdAt?:  string;
  updatedAt?:  string;
}

export interface BuiltinCriterion { key: string; label: string; color: string; }
export interface BuiltinModelDef  { label: string; criteria: BuiltinCriterion[]; }
export type BuiltinModels = Record<ModelType, BuiltinModelDef>;

// ── Display metadata (kept alongside service for co-location) ─────────────────

export const CATEGORY_META: Record<ThemeCategory, { label: string; icon: string }> = {
  personality:            { label: 'Personality',            icon: 'person'      },
  motivation:             { label: 'Motivation',             icon: 'emoji_objects' },
  behavior:               { label: 'Behavior',               icon: 'groups'      },
  logical_reasoning:      { label: 'Logical Reasoning',      icon: 'psychology'  },
  emotional_intelligence: { label: 'Emotional Intelligence', icon: 'favorite'    },
  custom:                 { label: 'Custom',                 icon: 'tune'        },
};

export const ANSWER_TYPE_META: Record<AnswerType, { label: string; icon: string }> = {
  single_choice:   { label: 'Single Choice (radio)', icon: 'radio_button_checked' },
  likert:          { label: 'Likert Scale (1-5)',     icon: 'linear_scale'         },
  multiple_choice: { label: 'Multiple Choice',        icon: 'check_box'            },
};

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class TestRhService {

  constructor(private http: HttpClient) {}

  // ── Test ──────────────────────────────────────────────────────────────────

  /** GET /job-tests/builtin-models */
  getBuiltinModels(): Observable<BuiltinModels> {
    return this.http.get<BuiltinModels>(`${API}/builtin-models`);
  }

  /** GET /job-tests/:jobId */
  getTestByJob(jobId: string): Observable<JobTest> {
    return this.http.get<JobTest>(`${API}/${jobId}`);
  }

  /** POST /job-tests/:jobId */
  createTest(jobId: string, data: Pick<JobTest, 'name' | 'description'>): Observable<JobTest> {
    return this.http.post<JobTest>(`${API}/${jobId}`, data);
  }

  /** PATCH /job-tests/:jobId */
  updateTest(jobId: string, data: Partial<Pick<JobTest, 'name' | 'description' | 'status'>>): Observable<JobTest> {
    return this.http.patch<JobTest>(`${API}/${jobId}`, data);
  }

  /** DELETE /job-tests/:jobId */
  deleteTest(jobId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${API}/${jobId}`);
  }

  /** POST /job-tests/:jobId/complete */
  completeTest(jobId: string): Observable<{ test: JobTest; notification?: any; alreadyCompleted?: boolean }> {
    return this.http.post<{ test: JobTest; notification?: any; alreadyCompleted?: boolean }>(
      `${API}/${jobId}/complete`, {}
    );
  }

  // ── Themes ────────────────────────────────────────────────────────────────

  /** POST /job-tests/:jobId/themes */
  addTheme(jobId: string, data: Pick<Theme, 'name' | 'category'>): Observable<JobTest> {
    return this.http.post<JobTest>(`${API}/${jobId}/themes`, data);
  }

  /** DELETE /job-tests/:jobId/themes/:themeId */
  deleteTheme(jobId: string, themeId: string): Observable<JobTest> {
    return this.http.delete<JobTest>(`${API}/${jobId}/themes/${themeId}`);
  }

  // ── Models ────────────────────────────────────────────────────────────────

  /** POST /job-tests/:jobId/themes/:themeId/models */
  addModel(jobId: string, themeId: string, data: Partial<TestModel>): Observable<JobTest> {
    return this.http.post<JobTest>(`${API}/${jobId}/themes/${themeId}/models`, data);
  }

  /** PATCH /job-tests/:jobId/themes/:themeId/models/:modelId */
  updateModel(jobId: string, themeId: string, modelId: string, data: Partial<TestModel>): Observable<JobTest> {
    return this.http.patch<JobTest>(`${API}/${jobId}/themes/${themeId}/models/${modelId}`, data);
  }

  /** DELETE /job-tests/:jobId/themes/:themeId/models/:modelId */
  deleteModel(jobId: string, themeId: string, modelId: string): Observable<JobTest> {
    return this.http.delete<JobTest>(`${API}/${jobId}/themes/${themeId}/models/${modelId}`);
  }

  // ── Questions ─────────────────────────────────────────────────────────────

  /** POST /job-tests/:jobId/themes/:themeId/models/:modelId/questions */
  addQuestion(jobId: string, themeId: string, modelId: string, data: Partial<Question>): Observable<JobTest> {
    return this.http.post<JobTest>(`${API}/${jobId}/themes/${themeId}/models/${modelId}/questions`, data);
  }

  /** PATCH /job-tests/:jobId/themes/:themeId/models/:modelId/questions/:questionId */
  updateQuestion(jobId: string, themeId: string, modelId: string, questionId: string, data: Partial<Question>): Observable<JobTest> {
    return this.http.patch<JobTest>(`${API}/${jobId}/themes/${themeId}/models/${modelId}/questions/${questionId}`, data);
  }

  /** DELETE /job-tests/:jobId/themes/:themeId/models/:modelId/questions/:questionId */
  deleteQuestion(jobId: string, themeId: string, modelId: string, questionId: string): Observable<JobTest> {
    return this.http.delete<JobTest>(`${API}/${jobId}/themes/${themeId}/models/${modelId}/questions/${questionId}`);
  }
}