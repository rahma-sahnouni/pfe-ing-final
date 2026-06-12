// src/app/_services/job-offer.service.ts
// Module: Job Offers — CRUD + assignment queries
// Maps to: controllers/jobOffer.controller.js

import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

const API = 'http://localhost:3000/api/jobs';

// ── Interfaces ────────────────────────────────────────────────────────────────

export type JobDepartment =
  | 'Engineering' | 'Design' | 'People' | 'Marketing'
  | 'Finance' | 'Product' | 'Security' | 'Data';

export type JobContractType =
  | 'Full-time' | 'Part-time' | 'Contract' | 'Freelance' | 'Internship' | 'Apprenticeship';

export type JobExperienceLevel =
  | 'Junior (0-2 years)' | 'Mid-level (3-5 years)' | 'Senior (5-8 years)'
  | 'Lead / Staff (8+ years)' | 'Principal / Architect';

export type JobStatus = 'draft' | 'open' | 'paused' | 'closed';

export interface TestAssignments {
  rhTest:        { enabled: boolean; assignedTo: any[]; deadline: string | null };
  technicalTest: { enabled: boolean; assignedTo: any[]; deadline: string | null };
}

export interface InterviewConfig {
  enabled:        boolean;
  ranges:         any[];
  evaluationGrid: any[];
}

export interface JobOffer {
  _id?:             string;
  title:            string;
  department?:      JobDepartment;
  location?:        string;
  contractType?:    JobContractType;
  experienceLevel?: JobExperienceLevel;
  description?:     string;
  prerequisites?:   any[];
  skills?:          any[];
  tests?:           any[];
  stages?:          any[];
  createdBy?:       string;
  assignedTo?:      string[];
  status?:          JobStatus;
  deadline?:        string;
  applicationsCount?: number;
  testAssignments?: TestAssignments;
  technicalTests?:  any[];
   interviewConfig?: {
    rh: InterviewConfig;
    tech: InterviewConfig;
  };
  testPeriod?:{
    start: string | null;
    end:   string | null;
  }
   intervAssignments: {   // <-- AJOUT
    rhTest: { enabled: boolean; assignedTo: string[]; deadline: string | null };
    technicalTest: { enabled: boolean; assignedTo: string[]; deadline: string | null };
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class JobOfferService {

  constructor(private http: HttpClient) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** POST /jobs */
  createJob(job: JobOffer): Observable<{ message: string; job: JobOffer }> {
    return this.http.post<{ message: string; job: JobOffer }>(API, job).pipe(catchError(this.handleError));
  }

  /** GET /jobs */
  getJobs(): Observable<JobOffer[]> {
    return this.http.get<JobOffer[]>(API).pipe(catchError(this.handleError));
  }

  /** GET /jobs/:id */
  getJobById(id: string): Observable<JobOffer> {
    return this.http.get<JobOffer>(`${API}/${id}`).pipe(catchError(this.handleError));
  }

  /** PUT /jobs/:id */
  updateJob(id: string, job: Partial<JobOffer>): Observable<JobOffer> {
    return this.http.put<JobOffer>(`${API}/${id}`, job).pipe(catchError(this.handleError));
  }

  /** DELETE /jobs/:id */
  deleteJob(id: string): Observable<{ message: string; deleted: Record<string, number> }> {
    return this.http.delete<{ message: string; deleted: Record<string, number> }>(`${API}/${id}`)
      .pipe(catchError(this.handleError));
  }

  // ── Scoped queries ────────────────────────────────────────────────────────

  /** GET /jobs/my-jobs — jobs created by the current user */
  getMyJobs(): Observable<JobOffer[]> {
    return this.http.get<JobOffer[]>(`${API}/my-jobs`).pipe(catchError(this.handleError));
  }

  /** GET /jobs/my-rh-tests — jobs where current user is assigned as RH tester */
  getMyRhTestJobs(): Observable<JobOffer[]> {
    return this.http.get<JobOffer[]>(`${API}/my-rh-tests`).pipe(catchError(this.handleError));
  }

  /** GET /jobs/my-tech-tests — jobs where current user is assigned as tech evaluator */
  getMyTechTestJobs(): Observable<JobOffer[]> {
    return this.http.get<JobOffer[]>(`${API}/my-tech-tests`).pipe(catchError(this.handleError));
  }

  // ── Error handler ─────────────────────────────────────────────────────────

  private handleError(err: HttpErrorResponse): Observable<never> {
    const message = err.error?.errors?.length
      ? err.error.errors.join(' | ')
      : (err.error?.message ?? 'Server error');
    return throwError(() => new Error(message));
  }
  /** GET /jobs/accessible — jobs created by user OR where user is assigned as RH/Tech test */
getAccessibleJobs(): Observable<JobOffer[]> {
  return this.http.get<JobOffer[]>(`${API}/accessible`).pipe(catchError(this.handleError));
}
}