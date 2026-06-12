// src/app/_services/anti-cheat.service.ts
// Module: Anti-Cheat — browser event monitoring during tests (client-side only)
// No backend controller — report is sent as part of the technical test submission payload.

import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';

// ── Interfaces ────────────────────────────────────────────────────────────────

export type AntiCheatEventType =
  | 'focus_loss' | 'focus_gain'
  | 'tab_hidden'  | 'tab_visible'
  | 'paste_detected' | 'copy_detected' | 'cut_detected'
  | 'right_click';

export interface AntiCheatEvent {
  type:       AntiCheatEventType;
  timestamp:  string;   // ISO string
  timeLabel:  string;   // HH:MM:SS
  count?:     number;   // cumulative count for this type
  detail?:    string;
}

export interface AntiCheatReport {
  riskLevel:             'low' | 'medium' | 'high';
  totalSuspiciousEvents: number;
  focusLosses:           number;
  tabChanges:            number;
  pastes:                number;
  focusGains:            number;
  events:                AntiCheatEvent[];
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AntiCheatService implements OnDestroy {

  private events: AntiCheatEvent[] = [];
  private counts: Record<AntiCheatEventType, number> = {
    focus_loss: 0, focus_gain: 0, tab_hidden: 0, tab_visible: 0,
    paste_detected: 0, copy_detected: 0, cut_detected: 0, right_click: 0,
  };
  private listeners: (() => void)[] = [];
  private active = false;

  /** Stream of new events — subscribe in the test component for live display. */
  readonly event$ = new Subject<AntiCheatEvent>();

  constructor(private ngZone: NgZone) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Start monitoring. Pass the code editor element to also track copy/paste/right-click inside it. */
  start(editorElement?: HTMLElement): void {
    if (this.active) return;
    this.active = true;
    this.events = [];
    (Object.keys(this.counts) as AntiCheatEventType[]).forEach(k => (this.counts[k] = 0));

    this.listen('visibilitychange', () => {
      this.record(document.hidden ? 'tab_hidden' : 'tab_visible', document.hidden ? 'Tab hidden' : 'Tab visible');
    });
    this.listen('blur',  () => this.record('focus_loss', 'Window lost focus'),      window);
    this.listen('focus', () => this.record('focus_gain', 'Window regained focus'),  window);

    if (editorElement) {
      this.listen('paste', (e: Event) => {
        const text   = (e as ClipboardEvent).clipboardData?.getData('text') ?? '';
        const detail = text.length > 20
          ? `Large paste (${text.length} chars)`
          : `Small paste (${text.length} chars)`;
        this.record('paste_detected', detail);
      }, editorElement);

      this.listen('copy',        () => this.record('copy_detected', 'Text copied'),               editorElement);
      this.listen('cut',         () => this.record('cut_detected',  'Text cut'),                  editorElement);
      this.listen('contextmenu', () => this.record('right_click',   'Right-click menu opened'),   editorElement);
    }
  }

  stop(): void {
    this.active = false;
    this.listeners.forEach(fn => fn());
    this.listeners = [];
  }

  reset(): void {
    this.stop();
    this.events = [];
    (Object.keys(this.counts) as AntiCheatEventType[]).forEach(k => (this.counts[k] = 0));
  }

  // ── Report ────────────────────────────────────────────────────────────────

  getReport(): AntiCheatReport {
    const { focus_loss, tab_hidden, paste_detected, right_click, focus_gain } = this.counts;
    const total = focus_loss + tab_hidden + paste_detected + right_click;

    let riskLevel: AntiCheatReport['riskLevel'] = 'low';
    if (total >= 5 || paste_detected >= 2 || tab_hidden >= 3) riskLevel = 'high';
    else if (total >= 2 || paste_detected >= 1 || tab_hidden >= 1) riskLevel = 'medium';

    return {
      riskLevel,
      totalSuspiciousEvents: total,
      focusLosses:           focus_loss,
      tabChanges:            tab_hidden,
      pastes:                paste_detected,
      focusGains:            focus_gain,
      events:                [...this.events],
    };
  }

  ngOnDestroy(): void {
    this.stop();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private record(type: AntiCheatEventType, detail: string): void {
    this.counts[type]++;
    const now = new Date();
    const evt: AntiCheatEvent = {
      type,
      timestamp: now.toISOString(),
      timeLabel: now.toTimeString().slice(0, 8),
      count:     this.counts[type],
      detail,
    };
    this.events.push(evt);
    this.ngZone.run(() => this.event$.next(evt));
  }

  private listen(
    eventName: string,
    handler:   (e: Event) => void,
    target:    EventTarget = document
  ): void {
    target.addEventListener(eventName, handler);
    this.listeners.push(() => target.removeEventListener(eventName, handler));
  }
}