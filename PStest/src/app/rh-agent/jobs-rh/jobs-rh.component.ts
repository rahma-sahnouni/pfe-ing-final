import { Component, OnInit } from '@angular/core';
import { JobOffer, JobOfferService } from '../../_services/job-offer.service';
import { CandidateService } from '../../_services/candidate.service';
import { Router } from '@angular/router';

type ModalMode = 'view' | 'details' | 'edit' | 'delete' | 'tests' | 'candidates' | null;
type PersonalityModel = 'mbti' | 'bigfive' | 'disc' | 'motivations';
type LogicType        = 'verbal' | 'numeric' | 'abstract' | 'problem';
type VisualType       = 'stroop' | 'colors' | 'matrix' | 'speed';

interface TestConfig {
  category: 'personality' | 'logic' | 'visual';
  subType: string;
  label: string;
  duration: number;
  minScore: number;
  questionCount?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
}
interface CustomTest {
  _id?:          string;
  category:      'personality' | 'logic' | 'visual';
  subType:       string;
  label:         string;
  duration:      number;
  minScore:      number;
  questionCount?: number;
  difficulty?:   'easy' | 'medium' | 'hard';
  questions?:    any[];
}

@Component({
  selector: 'app-jobs-rh',
  templateUrl: './jobs-rh.component.html',
  styleUrls: ['./jobs-rh.component.css']
})
export class JobsRHComponent implements OnInit {

  showCreateModal = false;
  jobs: JobOffer[] = [];

  searchTerm   = '';
  filterDept   = '';
  filterStatus = '';

  selectedJob: JobOffer | null = null;
  modalMode: ModalMode = null;

  testsTab: 'personality' | 'logic' | 'visual' | 'summary' = 'personality';
  pendingTests: TestConfig[] = [];
  savingTests = false;

  selectedPersonality: PersonalityModel = 'mbti';
  selectedLogic: LogicType = 'verbal';
  selectedVisual: VisualType = 'stroop';

  personalityConfig = { duration: 25, minScore: 60, questionCount: 40 };

  logicConfig = {
    duration: 15,
    minScore: 70,
    questionCount: 20,
    difficulty: 'medium' as 'easy' | 'medium' | 'hard'
  };

  visualConfig = { duration: 5, minScore: 65, trialCount: 40 };

  private readonly personalityMeta = {
    mbti: { label: 'MBTI' },
    bigfive: { label: 'Big Five (OCEAN)' },
    disc: { label: 'DISC' },
    motivations: { label: 'Motivations' }
  };

  private readonly logicMeta = {
    verbal: { label: 'Verbal reasoning' },
    numeric: { label: 'Numerical reasoning' },
    abstract: { label: 'Abstract reasoning' },
    problem: { label: 'Problem solving' }
  };

  private readonly visualMeta = {
    stroop: { label: 'Stroop test' },
    colors: { label: 'Color recognition' },
    matrix: { label: 'Visual matrices' },
    speed: { label: 'Visual speed' }
  };

  candidates: any[] = [];
loadingCandidates = false;
  deptIcon(dept?: string): string {
  const map: Record<string, string> = {
    Engineering: '💻', Design: '🎨', People: '👥',
    Marketing: '📣', Finance: '💰', Product: '📦',
    Security: '🔒', Data: '📊'
  };
  return dept ? (map[dept] || '🏢') : '🏢';
}

  constructor(
    private jobService: JobOfferService,
      private candidateService: CandidateService,
        private router: Router


  ) {}
  goToCandidates(job: JobOffer): void {
  this.router.navigate(['/rh/jobs', job._id, 'candidates']);
}

  ngOnInit(): void {
    this.loadJobs();
  }

loadJobs(): void {
  this.jobService.getMyJobs().subscribe({
    next: (data) => this.jobs = data,
    error: (err) => console.error('Error loading jobs:', err)
  });
}

  filteredJobs(): JobOffer[] {
    return this.jobs.filter(j => {

      const matchSearch =
        !this.searchTerm ||
        j.title.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        (j.department && j.department.toLowerCase().includes(this.searchTerm.toLowerCase()));

      const matchDept =
        !this.filterDept || j.department === this.filterDept;

      const matchStatus =
        !this.filterStatus || j.status === this.filterStatus.toLowerCase();

      return matchSearch && matchDept && matchStatus;
    });
  }

  get activeJobsCount(): number {
    return this.jobs.filter(j => j.status === 'draft' || j.status === 'open').length;
  }

  get totalApplicants(): number {
    return this.jobs.reduce((sum, j) => sum + (j.applicationsCount || 0), 0);
  }

  openCreateModal(): void {
    this.showCreateModal = true;

  }

  openViewModal(job: JobOffer): void {
    this.selectedJob = job;
    this.modalMode = 'view';
  }

openDetailsModal(job: JobOffer): void {
  this.selectedJob = job;
  this.modalMode = 'details'; // new modal
}

  openEditModal(job: JobOffer): void {
    this.selectedJob = job;
    this.modalMode = 'edit';
  }

  openDeleteModal(job: JobOffer): void {
    this.selectedJob = job;
    this.modalMode = 'delete';
  }

  openTestsModal(job: JobOffer): void {
    this.selectedJob = job;
    this.modalMode = 'tests';
    this.testsTab = 'personality';
    this.pendingTests = job.tests ? [...(job.tests as TestConfig[])] : [];
    this.savingTests = false;
  }

  closeModal(): void {
    this.selectedJob = null;
    this.modalMode = null;
    this.pendingTests = [];
  }

  isTestAdded(category: string): boolean {
    return this.pendingTests.some(t => t.category === category);
  }

  addTest(category: 'personality' | 'logic' | 'visual'): void {

    if (this.isTestAdded(category)) return;

    let cfg: TestConfig;

    if (category === 'personality') {
      cfg = {
        category,
        subType: this.selectedPersonality,
        label: this.personalityMeta[this.selectedPersonality].label,
        duration: this.personalityConfig.duration,
        minScore: this.personalityConfig.minScore,
        questionCount: this.personalityConfig.questionCount
      };

    } else if (category === 'logic') {
      cfg = {
        category,
        subType: this.selectedLogic,
        label: this.logicMeta[this.selectedLogic].label,
        duration: this.logicConfig.duration,
        minScore: this.logicConfig.minScore,
        questionCount: this.logicConfig.questionCount,
        difficulty: this.logicConfig.difficulty
      };

    } else {
      cfg = {
        category,
        subType: this.selectedVisual,
        label: this.visualMeta[this.selectedVisual].label,
        duration: this.visualConfig.duration,
        minScore: this.visualConfig.minScore,
        questionCount: this.visualConfig.trialCount
      };
    }

    this.pendingTests = [...this.pendingTests, cfg];
  }

  removeTest(category: string): void {
    this.pendingTests = this.pendingTests.filter(t => t.category !== category);
  }

  onTestSaved(test: CustomTest): void {

    const idx = this.jobs.findIndex(j => j._id === this.selectedJob?._id);

    if (idx !== -1) {

      const refs = this.jobs[idx].tests || [];

      const existing = refs.findIndex(t => t.category === test.category);

      const ref = {
        customTestId: test._id,
        category: test.category,
        subType: test.subType,
        label: test.label,
        duration: test.duration,
        minScore: test.minScore,
        questionCount: test.questions?.length || 0,
        difficulty: test.difficulty,
        isCustom: true
      };

      if (existing !== -1) refs[existing] = ref;
      else refs.push(ref);

      this.jobs[idx] = { ...this.jobs[idx], tests: refs };
    }
  }


  // ── Job CRUD handlers ────────────────────────────────
onJobCreated(savedJob: JobOffer): void {
  this.jobs = [savedJob, ...this.jobs];
  this.showCreateModal = false;
}
  onJobUpdated(updated: JobOffer): void {
    const idx = this.jobs.findIndex(j => j._id === updated._id);
    if (idx !== -1) this.jobs[idx] = updated;
    this.closeModal();
  }

  onJobDeleted(id: string): void {
    this.jobs = this.jobs.filter(j => j._id !== id);
    this.closeModal();
  }


  // nouvelles méthodes
openCandidatesModal(job: JobOffer): void {
  this.selectedJob = job;
  this.modalMode = 'candidates';
  this.candidates = [];
  this.loadingCandidates = true;

  this.candidateService.getCandidatesByJob(job._id!).subscribe({
    next: (res) => {
      this.candidates = res.candidates;
      this.loadingCandidates = false;
    },
    error: (err) => {
      console.error('Error loading candidates:', err);
      this.loadingCandidates = false;
    }
  });
}

getInitials(nameOrEmail: string): string {
  if (!nameOrEmail) return '?';
  const parts = nameOrEmail.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return nameOrEmail.substring(0, 2).toUpperCase();
}

getAppStatus(candidate: any): string {
  const app = candidate.applications?.find(
    (a: any) => {
      const jobId = typeof a.jobOffer === 'string' ? a.jobOffer : a.jobOffer?._id;
      return jobId === this.selectedJob?._id;
    }
  );
  return app?.status || 'Pending';
}

preSelectCandidate(candidate: any, preSelected: boolean): void {
  const jobId = this.selectedJob?._id;
  if (!jobId) return;

  this.candidateService.preSelectCandidate(candidate._id, jobId, preSelected).subscribe({
    next: () => {
      candidate.preSelected = preSelected;
    },
    error: (err) => console.error('preSelect error:', err)
  });
}
}