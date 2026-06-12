// src/app/_services/code-runner.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// ✅ Générique — fonctionne pour n'importe quel problème
export interface TestCaseInput {
  [key: string]: any;   // { nums, target } ou { s } ou { root } etc.
}

export interface TestCase {
  input:    TestCaseInput;
  expected: any;          // ✅ any — pas forcément number[]
}

export interface TestCaseResult {
  input:    TestCaseInput;
  expected: any;
  got:      any | null;   // ✅ any
  pass:     boolean;
  time:     number | null;
  memoryKb: number | null;
  stderr:   string | null;
  status:   string;
  error?:   string;
}

export interface ComplexityInfo {
  notation:   string;   // e.g. "O(n)"
  label:      string;   // e.g. "Linéaire"
  efficiency: number;   // 0-100 score for progress bar
  note:       string;   // human explanation
}

export interface ComplexityResult {
  time:  ComplexityInfo;
  space: ComplexityInfo;
}


export interface RunCodeResponse {
  results:     TestCaseResult[];
  complexity:  ComplexityResult;
  score:       number;       // ← NEW: 100 or 0
  allPassed:   boolean;      // ← NEW
  passedCount: number;       // ← NEW
  totalCount:  number;       // ← NEW
}
export type SupportedLanguage = 'javascript' | 'python' | 'java' | 'cpp';
@Injectable({ providedIn: 'root' })
export class CodeRunnerService {
  private readonly api = `http://localhost:3000/api/code-runner`;

  constructor(private http: HttpClient) {}

  runCode(
    language:  SupportedLanguage,
    code:      string,
    testCases: TestCase[]
  ): Observable<RunCodeResponse> {
    return this.http.post<RunCodeResponse>(`${this.api}/run`, {
      language,
      code,
      testCases,
    });
  }
}