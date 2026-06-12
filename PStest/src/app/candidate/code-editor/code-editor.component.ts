// src/app/components/code-editor/code-editor.component.ts
// CHANGES: Added AntiCheatService integration — emits report on run/submit
import { Component, Input, Output, EventEmitter,
  OnInit, OnDestroy, AfterViewInit, OnChanges, SimpleChanges,
  NgZone, ViewChild, ElementRef,
} from '@angular/core';
import {
  CodeRunnerService,
  SupportedLanguage,
  TestCase,
  TestCaseResult,
  ComplexityResult,
} from '../../_services/code-runner.service';
import { AntiCheatService, AntiCheatReport } from '../../_services/anti-cheat.service';
import { Subject, takeUntil } from 'rxjs';

// ── Starter templates ─────────────────────────────────────────
const STARTERS: Record<SupportedLanguage, string> = {
  javascript: `function twoSum(nums, target) {
    const map = {};
    for (let i = 0; i < nums.length; i++) {
        const complement = target - nums[i];
        if (map[complement] !== undefined) return [map[complement], i];
        map[nums[i]] = i;
    }
    return [];
}`,
  python: `def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []`,
  java: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        java.util.Map<Integer, Integer> map = new java.util.HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int complement = target - nums[i];
            if (map.containsKey(complement)) return new int[]{ map.get(complement), i };
            map.put(nums[i], i);
        }
        return new int[]{};
    }
}`,
  cpp: `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> map;
        for (int i = 0; i < nums.size(); i++) {
            int complement = target - nums[i];
            if (map.count(complement)) return {map[complement], i};
            map[nums[i]] = i;
        }
        return {};
    }
};`,
};

export interface ProblemExample {
  input:        { [key: string]: any };
  output:       any;
  explanation?: string;
}

export type ActiveTab = 'tests' | 'complexity' | 'console';

@Component({
  selector:    'app-code-editor',
  templateUrl: './code-editor.component.html',
  styleUrls:   ['./code-editor.component.css'],
})
export class CodeEditorComponent implements OnInit, OnDestroy, AfterViewInit, OnChanges {

  @Input() problemTitle = '';
  @Input() difficulty: 'easy' | 'medium' | 'hard' = 'easy';
  @Input() examples: ProblemExample[] = [];

  @ViewChild('editorTextarea') editorTextareaRef!: ElementRef<HTMLTextAreaElement>;

  @Output() codeSolution = new EventEmitter<{ code: string; language: SupportedLanguage }>();

  @Output() codeChange = new EventEmitter<{
    code:        string;
    language:    SupportedLanguage;
    complexity:  ComplexityResult | null;
    testResults: TestCaseResult[];
    score:       number | null;
    allPassed:   boolean;
    antiCheat:   AntiCheatReport | null;  // ← NEW
  }>();

  language: SupportedLanguage = 'javascript';
  code = STARTERS.javascript;

  activeTab: ActiveTab = 'tests';
  running   = false;
  allPassed = false;
  score: number | null = null;

  testResults: (TestCaseResult & { statusLabel: string; statusClass: string })[] = [];
  complexity:  ComplexityResult | null = null;
  consoleLines: { type: 'info' | 'success' | 'error'; text: string }[] = [];

  // Anti-cheat live counter (shown in editor header)
  antiCheatCount = 0;
  antiCheatRisk: 'low' | 'medium' | 'high' = 'low';

  private destroy$ = new Subject<void>();

  readonly languages: { value: SupportedLanguage; label: string }[] = [
    { value: 'javascript', label: 'JavaScript (Node.js)' },
    { value: 'python',     label: 'Python 3'             },
    { value: 'java',       label: 'Java 13'              },
    { value: 'cpp',        label: 'C++'                  },
  ];

  readonly difficultyConfig = {
    easy:   { label: 'Facile',    css: 'badge-easy'   },
    medium: { label: 'Moyen',     css: 'badge-medium' },
    hard:   { label: 'Difficile', css: 'badge-hard'   },
  };

  constructor(
    private runner:     CodeRunnerService,
    private ngZone:     NgZone,
    private antiCheat:  AntiCheatService,
  ) {}

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    // Start anti-cheat monitoring, scoped to the textarea
    const el = this.editorTextareaRef?.nativeElement;
    this.antiCheat.start(el);

    // Subscribe to live events to update badge
    this.antiCheat.event$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      const report = this.antiCheat.getReport();
      this.antiCheatCount = report.totalSuspiciousEvents;
      this.antiCheatRisk  = report.riskLevel;
    });
  }

ngOnChanges(changes: SimpleChanges): void {
  if (this.running) return;
  if (changes['examples']) {
    this.testResults  = [];
    this.complexity   = null;
    this.consoleLines = [];
    this.allPassed    = false;
    this.score        = null;
  }
}

  ngOnDestroy(): void {
    this.antiCheat.stop();
    this.destroy$.next();
    this.destroy$.complete();
  }

  onLanguageChange(): void {
    this.code = STARTERS[this.language];
  }

  onTabKey(event: Event): void {
    event.preventDefault();
    const ta = event.target as HTMLTextAreaElement;
    const s  = ta.selectionStart ?? 0;
    const e  = ta.selectionEnd   ?? 0;
    ta.value = ta.value.substring(0, s) + '    ' + ta.value.substring(e);
    ta.selectionStart = ta.selectionEnd = s + 4;
    this.code = ta.value;
  }

  runTests(): void {
    if (this.running) return;
      // ← AJOUTE CECI
  if (!this.examples || this.examples.length === 0) {
    this.log('error', 'Aucun cas de test disponible.');
    this.activeTab = 'console';
    return;
  }
    this.running      = true;
    this.allPassed    = false;
    this.activeTab    = 'tests';
    this.consoleLines = [];
    this.complexity   = null;

    this.testResults = this.examples.map(() => ({
      input:       {} as any,
      expected:    null,
      got:         null,
      pass:        false,
      time:        null,
      memoryKb:    null,
      stderr:      null,
      status:      'Processing…',
      statusLabel: 'Exécution…',
      statusClass: 'status-running',
    }));

    const testCases: TestCase[] = this.examples.map(ex => ({
      input: ex.input as any,
      expected: ex.output,
    }));

    this.log('info', `[${new Date().toLocaleTimeString()}] Exécution en cours (${this.language})…`);

    this.runner.runCode(this.language, this.code, testCases)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.ngZone.run(() => {
            if (!res || !res.results) return;

            this.testResults = [...res.results.map(r => ({
              ...r,
              statusLabel: r.pass ? 'Réussi' : 'Échoué',
              statusClass: r.pass ? 'status-pass' : 'status-fail',
            }))];

            this.complexity = res.complexity;
            this.allPassed  = res.results.every(r => r.pass);
            this.score      = res.score ?? (this.allPassed ? 100 : 0);

            this.log(
              this.allPassed ? 'success' : 'error',
              `🏆 Score: ${this.score}/100 — ${this.allPassed ? 'TOUS LES TESTS PASSÉS ✓' : 'CERTAINS TESTS ÉCHOUÉS ✗'}`,
            );

            res.results.forEach((r, i) => {
              this.log(
                r.pass ? 'success' : 'error',
                `Cas ${i + 1}: ${r.pass ? 'RÉUSSI' : 'ÉCHOUÉ'} — ` +
                `Obtenu: ${JSON.stringify(r.got)}, Attendu: ${JSON.stringify(r.expected)}` +
                (r.time != null ? ` (${r.time}ms)` : ''),
              );
              if (r.stderr) this.log('error', `  ↳ stderr: ${r.stderr}`);
            });

            this.running = false;
            this.emitCodeChange();
          });
        },
        error: (err) => {
          this.ngZone.run(() => {
            this.log('error', `Erreur serveur: ${err.message || err.error?.message || 'Inconnue'}`);
            this.testResults.forEach(r => {
              r.statusLabel = 'Erreur';
              r.statusClass = 'status-fail';
            });
            this.running = false;
          });
        },
      });
  }

  submitSolution(): void {
    if (!this.allPassed) return;
    this.codeSolution.emit({ code: this.code, language: this.language });
  }

  private emitCodeChange(): void {
    this.codeChange.emit({
      code:        this.code,
      language:    this.language,
      complexity:  this.complexity,
      testResults: this.testResults ?? [],
      score:       this.score,
      allPassed:   this.allPassed,
      antiCheat:   this.antiCheat.getReport(),  // ← emit report
    });
  }

  get allTestsPending(): boolean {
    return this.testResults.every(r => r.statusClass === 'status-pending');
  }

  formatInput(input: { [key: string]: any }): string {
    return Object.entries(input)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');
  }

  private log(type: 'info' | 'success' | 'error', text: string): void {
    this.consoleLines.push({ type, text });
  }

  switchTab(tab: ActiveTab): void { this.activeTab = tab; }

  complexityBarColor(efficiency: number): string {
    if (efficiency >= 80) return '#1D9E75';
    if (efficiency >= 55) return '#EF9F27';
    return '#E24B4A';
  }

  trackByIdx(i: number): number { return i; }

  onCodeInput(): void {
    this.codeChange.emit({
      code:        this.code,
      language:    this.language,
      complexity:  this.complexity,
      testResults: this.testResults ?? [],
      score:       null,
      allPassed:   false,
      antiCheat:   null,
    });
  }
}