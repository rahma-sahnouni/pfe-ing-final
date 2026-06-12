// job-candidates.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { JobOffer, JobOfferService } from '../../_services/job-offer.service';
import { CandidateService } from '../../_services/candidate.service';

@Component({
  selector: 'app-job-candidates',
  templateUrl: './job-candidates.component.html',
  styleUrls: ['./job-candidates.component.css']
})
export class JobCandidatesComponent implements OnInit {

  jobId!: string;
  job: JobOffer | null = null;
  candidates: any[] = [];
  loading = true;

  // filters
  searchTerm = '';
  filterStatus = '';
  filterPreselect = '';
  sortBy = 'score';

  // side panel
  selectedCandidate: any = null;
  panelTab: 'profile' | 'aimatch' = 'aimatch';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private jobService: JobOfferService,
    private candidateService: CandidateService
  ) {}

  ngOnInit(): void {
    this.jobId = this.route.snapshot.paramMap.get('id')!;
    this.loadJob();
    this.loadCandidates();
  }

  loadJob(): void {
    this.jobService.getJobById(this.jobId).subscribe({
      next: (j) => this.job = j,
      error: (e) => console.error(e)
    });
  }

  loadCandidates(): void {
    this.loading = true;
    this.candidateService.getCandidatesByJob(this.jobId).subscribe({
      next: (res) => {
        this.candidates = res.candidates;
        this.loading = false;
      },
      error: (e) => {
        console.error(e);
        this.loading = false;
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/rh/jobs']);
  }

  // ── Computed stats ──────────────────────────────────────────

  get preSelectedCount(): number {
    return this.candidates.filter(c => c.preSelected).length;
  }

  get avgScore(): number | null {
    const withScore = this.candidates.filter(c => c.aiMatchScore !== null);
    if (!withScore.length) return null;
    return Math.round(withScore.reduce((s, c) => s + c.aiMatchScore, 0) / withScore.length);
  }

  // ── Filtering + sorting ────────────────────────────────────

  filteredCandidates(): any[] {
    let list = [...this.candidates];

    if (this.searchTerm) {
      const q = this.searchTerm.toLowerCase();
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q)
      );
    }
    if (this.filterStatus) {
      list = list.filter(c => (c.applicationStatus || 'Pending') === this.filterStatus);
    }
    if (this.filterPreselect === 'yes') list = list.filter(c => c.preSelected);
    if (this.filterPreselect === 'no')  list = list.filter(c => !c.preSelected);

    list.sort((a, b) => {
      if (this.sortBy === 'score') return (b.aiMatchScore ?? -1) - (a.aiMatchScore ?? -1);
      if (this.sortBy === 'name')  return (a.name || a.email).localeCompare(b.name || b.email);
      if (this.sortBy === 'date')  return new Date(b.appliedDate).getTime() - new Date(a.appliedDate).getTime();
      return 0;
    });

    return list;
  }

  // ── Panel ──────────────────────────────────────────────────

  openScorePanel(c: any): void {
    this.selectedCandidate = c;
    this.panelTab = 'aimatch';
  }

  closePanel(): void {
    this.selectedCandidate = null;
  }

  preSelectAndClose(c: any, val: boolean): void {
    this.togglePreselect(c, val);
    this.closePanel();
  }

  // ── Pre-select ─────────────────────────────────────────────

  togglePreselect(c: any, forcedValue?: boolean): void {
    const newVal = forcedValue !== undefined ? forcedValue : !c.preSelected;
    this.candidateService.preSelectCandidate(c._id, this.jobId, newVal).subscribe({
      next: () => { c.preSelected = newVal; },
      error: (e) => console.error(e)
    });
  }

  // ── Helpers ────────────────────────────────────────────────

  getInitials(nameOrEmail: string): string {
    if (!nameOrEmail) return '?';
    const parts = nameOrEmail.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return nameOrEmail.substring(0, 2).toUpperCase();
  }

  deptIcon(dept?: string): string {
    const map: Record<string, string> = {
      Engineering: '💻', Design: '🎨', People: '👥',
      Marketing: '📣', Finance: '💰', Product: '📦',
      Security: '🔒', Data: '📊'
    };
    return dept ? (map[dept] || '🏢') : '🏢';
  }

  getScoreClass(score: number | null): string {
    if (score === null) return 'score-na';
    if (score >= 70) return 'score-high';
    if (score >= 45) return 'score-mid';
    return 'score-low';
  }

  getScoreLabel(score: number | null): string {
    if (score === null) return 'N/A';
    if (score >= 75) return 'Strong Match';
    if (score >= 55) return 'Good Match';
    if (score >= 35) return 'Partial Match';
    return 'Non-relevant';
  }

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      'Pending':    'status-pending',
      'In Review':  'status-review',
      'Interview':  'status-interview',
      'Accepted':   'status-accepted',
      'Rejected':   'status-rejected',
    };
    return map[status] || 'status-pending';
  }

  // SVG circle dash for score ring: circumference = 2π*50 ≈ 314
  getCircleDash(score: number | null): string {
    const circ = 314;
    const fill = score !== null ? (score / 100) * circ : 0;
    return `${fill} ${circ}`;
  }

  // Build dimension bars from available candidate data
  scoreDimensions(c: any): { label: string; value: number; color: string }[] {
    const dims: { label: string; value: number; color: string }[] = [];
    const jobSkills: string[] = (this.job?.skills || []).map((s: any) => s.name || s);
    const cvSkills: string[]  = c.cvExtracted?.skills || [];

    if (jobSkills.length) {
      const matched = jobSkills.filter(s => cvSkills.map(x => x.toLowerCase()).includes(s.toLowerCase()));
      const techPct = Math.round((matched.length / jobSkills.length) * 100);
      dims.push({ label: 'Technical Skills', value: techPct, color: techPct >= 70 ? 'bar-green' : techPct >= 40 ? 'bar-orange' : 'bar-red' });
    }

    const expYrs = c.experience || 0;
    const reqLvl = this.job?.experienceLevel || '';
    let expPct = 50;
    if (reqLvl.includes('0-2'))  expPct = expYrs >= 0 ? 100 : 0;
    if (reqLvl.includes('3-5'))  expPct = expYrs >= 3 ? 100 : Math.round((expYrs / 3) * 100);
    if (reqLvl.includes('5-8'))  expPct = expYrs >= 5 ? 100 : Math.round((expYrs / 5) * 100);
    if (reqLvl.includes('8+'))   expPct = expYrs >= 8 ? 100 : Math.round((expYrs / 8) * 100);
    dims.push({ label: 'Experience', value: Math.min(expPct, 100), color: expPct >= 70 ? 'bar-green' : expPct >= 40 ? 'bar-orange' : 'bar-red' });

    const cvLangs: string[] = c.cvExtracted?.languages || [];
    dims.push({ label: 'Languages', value: cvLangs.length > 0 ? 100 : 0, color: cvLangs.length ? 'bar-green' : 'bar-red' });

    const cvCerts = c.cvExtracted?.certifications?.length || 0;
    dims.push({ label: 'Certifications', value: cvCerts > 0 ? Math.min(cvCerts * 33, 100) : 0, color: cvCerts > 0 ? 'bar-green' : 'bar-red' });

    // Location match
    const cLoc = (c.location || '').toLowerCase();
    const jLoc = (this.job?.location || '').toLowerCase();
    const locMatch = jLoc && cLoc && (cLoc.includes(jLoc) || jLoc.includes(cLoc));
    dims.push({ label: 'Location Match', value: locMatch ? 100 : (cLoc ? 50 : 0), color: locMatch ? 'bar-green' : 'bar-orange' });

    return dims;
  }

  getMatchedSkills(c: any): string[] {
    const jobSkills: string[] = (this.job?.skills || []).map((s: any) => s.name || s);
    const cvSkills:  string[] = (c.cvExtracted?.skills || []).map((s: string) => s.toLowerCase());
    return jobSkills.filter(s => cvSkills.includes(s.toLowerCase()));
  }

  getMissingSkills(c: any): string[] {
    const jobSkills: string[] = (this.job?.skills || []).map((s: any) => s.name || s);
    const cvSkills:  string[] = (c.cvExtracted?.skills || []).map((s: string) => s.toLowerCase());
    return jobSkills.filter(s => !cvSkills.includes(s.toLowerCase()));
  }
}