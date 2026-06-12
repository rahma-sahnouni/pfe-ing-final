// src/app/_pipes/test-results.pipe.ts
// Two lightweight pipes used in code-editor.component.html

import { Pipe, PipeTransform } from '@angular/core';

interface ResultLike { pass: boolean; time: number | null; }

@Pipe({ name: 'countPass', standalone: true, pure: false })
export class CountPassPipe implements PipeTransform {
  transform(results: ResultLike[]): number {
    return (results || []).filter(r => r.pass).length;
  }
}

@Pipe({ name: 'avgTime', standalone: true, pure: false })
export class AvgTimePipe implements PipeTransform {
  transform(results: ResultLike[]): string {
    const valid = (results || []).filter(r => r.time !== null);
    if (!valid.length) return '--';
    const avg = valid.reduce((s, r) => s + r.time!, 0) / valid.length;
    return Math.round(avg).toString();
  }
}