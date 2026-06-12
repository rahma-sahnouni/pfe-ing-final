import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, forkJoin, of } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { CandidateService, CandidateProfile, Application } from '../../_services/candidate.service';
import { JobOfferService, JobOffer } from '../../_services/job-offer.service';

export interface ApplicationEntry {
  job: JobOffer;
  status: string;
  appliedDate: string | null;
}

@Component({
  selector: 'app-my-applications',
  templateUrl: './my-applications.component.html',
  styleUrls: ['./my-applications.component.scss'],
})
export class MyApplicationsComponent implements OnInit, OnDestroy {
  applications: ApplicationEntry[] = [];
  filtered: ApplicationEntry[] = [];
  statusFilter = '';
  loading = true;
  error = '';

  private destroy$ = new Subject<void>();

  readonly STATUS_OPTIONS = ['Pending', 'In Review', 'Interview', 'Accepted', 'Rejected'];

  constructor(
    private candidateService: CandidateService,
    private jobOfferService: JobOfferService
  ) {}

  ngOnInit(): void {
    this.loadApplications();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadApplications(): void {
  this.loading = true;
  this.error = '';

  this.candidateService
    .getProfile()
    .pipe(
      takeUntil(this.destroy$),
      switchMap((profile: CandidateProfile) => {
        const apps = profile.applications || [];
        if (apps.length === 0) return of([] as ApplicationEntry[]);

        const jobRequests = apps.map((app: Application) => {
          const jobId = typeof app.jobOffer === 'string'
            ? app.jobOffer
            : app.jobOffer?._id;

          if (!jobId) return of(null as ApplicationEntry | null);

          return this.jobOfferService.getJobById(jobId).pipe(
            map((job: JobOffer): ApplicationEntry => ({
              job,
              status: app.status,
              appliedDate: app.appliedDate,
            }))
          );
        });

        return forkJoin(jobRequests).pipe(
          map((entries) =>
            entries.filter((e): e is ApplicationEntry => e !== null)
          )
        );
      })
    )
    .subscribe({
      next: (entries: ApplicationEntry[]) => {
        this.applications = entries;
        this.applyFilter();
        this.loading = false;
      },
      error: (err) => {
        console.error(err);
        this.error = 'Failed to load your applications.';
        this.loading = false;
      },
    });
}
  applyFilter(): void {
    this.filtered = this.statusFilter
      ? this.applications.filter((a) => a.status === this.statusFilter)
      : [...this.applications];
  }

  onFilterChange(): void {
    this.applyFilter();
  }

  resetFilter(): void {
    this.statusFilter = '';
    this.applyFilter();
  }

  // ── Derived stats ──────────────────────────────────────
  get totalCount(): number {
    return this.applications.length;
  }

  get activeCount(): number {
    return this.applications.filter((a) =>
      ['Pending', 'In Review', 'Interview'].includes(a.status)
    ).length;
  }

  get interviewCount(): number {
    return this.applications.filter((a) => a.status === 'Interview').length;
  }

  // ── Helpers ────────────────────────────────────────────
  timeAgo(dateStr: string | null): string {
    if (!dateStr) return 'Unknown date';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
    if (diff < 1) return 'Today';
    if (diff < 2) return 'Yesterday';
    return `${Math.floor(diff)} days ago`;
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      Pending: 'badge--warning',
      'In Review': 'badge--info',
      Interview: 'badge--success',
      Accepted: 'badge--accepted',
      Rejected: 'badge--danger',
    };
    return map[status] ?? 'badge--warning';
  }

  jobStatusClass(status: string | undefined): string {
    const map: Record<string, string> = {
      open: 'badge--open',
      closed: 'badge--danger',
      paused: 'badge--warning',
      draft: 'badge--muted',
    };
    return map[status ?? 'open'] ?? 'badge--muted';
  }

  deptIcon(dept: string | undefined): string {
    const icons: Record<string, string> = {
      Engineering: '⚙',
      Design: '🎨',
      Product: '📦',
      Marketing: '📢',
      Finance: '💳',
      Data: '📊',
      Security: '🔐',
      People: '👥',
    };
    return icons[dept ?? ''] ?? '💼';
  }

  visibleSkills(skills: any[] | undefined): any[] {
    return (skills ?? []).slice(0, 4);
  }

  extraSkillsCount(skills: any[] | undefined): number {
    const count = (skills ?? []).length;
    return count > 4 ? count - 4 : 0;
  }

  trackById(_: number, item: ApplicationEntry): string {
    return item.job._id ?? '';
  }
}