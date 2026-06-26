import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { JobOffer, JobOfferService } from '../../_services/job-offer.service';
import { CandidateService, RecommendedJob } from '../../_services/candidate.service';

@Component({
  selector: 'app-candidate-jobespace',
  templateUrl: './candidate-jobespace.component.html',
  styleUrls: ['./candidate-jobespace.component.css'],
  standalone: false,
})
export class CandidateJOBEspaceComponent implements OnInit {
  allJobs: JobOffer[] = [];
  filteredJobs: JobOffer[] = [];
  recommendedJobs: RecommendedJob[] = [];

  filters = { skills: '', location: '', contractType: '' };

  isLoading    = false;
  isLoadingAI  = false;
  errorMessage   = '';
  aiErrorMessage = '';

  viewMode: 'all' | 'ai' = 'all';

  showDetailsModal = false;
  selectedJobForDetails: JobOffer | null = null;

  showApplyModal = false;
  selectedJobForApply: JobOffer | null = null;
  selectedFile: File | null = null;
  uploadMessage = '';
  isUploading   = false;

  // Propriétés pour le modal des détails du matching
  showMatchModal = false;
  selectedMatchForModal: RecommendedJob | null = null;

  candidateId  = '';
  hasCV        = false;
  appliedJobIds  = new Set<string>();
  jobAiScores    = new Map<string, number | null>();

  constructor(
    private jobService: JobOfferService,
    private candidateService: CandidateService,
    private router: Router
  ) {}

  ngOnInit(): void {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    this.candidateId = user._id || user.id || '';
    this.loadJobsFromApi();
    this.loadMyApplications();
  }

  private loadMyApplications(): void {
    this.candidateService.getProfile().subscribe({
      next: (profile) => { this.hasCV = !!profile.cv?.originalName; },
      error: () => { this.hasCV = false; }
    });
    this.candidateService.getJourney().subscribe({
      next: (res) => {
        for (const item of res.journey) {
          this.appliedJobIds.add(item.jobOffer._id);
          this.jobAiScores.set(item.jobOffer._id, item.aiMatchScore);
        }
      },
      error: () => {}
    });
  }

  hasApplied(jobId: string | undefined): boolean {
    return !!jobId && this.appliedJobIds.has(jobId);
  }

  getAiScore(jobId: string | undefined): number | null {
    return jobId ? (this.jobAiScores.get(jobId) ?? null) : null;
  }

  private loadJobsFromApi(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.jobService.getJobs().subscribe({
      next: (jobs) => {
        this.allJobs = jobs.filter(job => job.status === 'open');
        this.applyFilters();
        this.isLoading = false;
      },
      error: (err) => {
        console.error(err);
        this.errorMessage = 'Unable to load job offers. Please try again later.';
        this.isLoading = false;
      }
    });
  }

  loadAIRecommendations(): void {
    if (!this.hasCV) {
      this.aiErrorMessage = 'Please upload your CV on your profile page first.';
      return;
    }

    this.isLoadingAI   = true;
    this.aiErrorMessage = '';
    this.viewMode      = 'ai';

    this.candidateService.getRecommendedJobs().subscribe({
      next: (res) => {
        this.recommendedJobs = res.recommendations || [];
        this.isLoadingAI = false;
      },
      error: (err) => {
        this.aiErrorMessage = err.error?.message
          || 'AI matching failed. Make sure your CV is uploaded and the AI server is running.';
        this.isLoadingAI = false;
        this.viewMode    = 'all';
      }
    });
  }

  switchToAllJobs(): void {
    this.viewMode      = 'all';
    this.aiErrorMessage = '';
  }

  applyFilters(): void {
    this.filteredJobs = this.allJobs.filter(job => {
      const skillsMatch = !this.filters.skills ||
        job.skills?.some(skill =>
          String(skill.name || skill).toLowerCase()
            .includes(this.filters.skills.toLowerCase())
        );
      const locationMatch = !this.filters.location ||
        job.location?.toLowerCase().includes(this.filters.location.toLowerCase());
      const contractMatch = !this.filters.contractType ||
        job.contractType?.toLowerCase() === this.filters.contractType.toLowerCase();
      return skillsMatch && locationMatch && contractMatch;
    });
  }

  resetFilters(): void {
    this.filters = { skills: '', location: '', contractType: '' };
    this.applyFilters();
  }

  getScoreClass(score: number | null): string {
    if (!score) return 'score-low';
    if (score >= 75) return 'score-high';
    if (score >= 50) return 'score-medium';
    return 'score-low';
  }

  // Modal détails offre
  openJobDetails(job: JobOffer): void {
    this.selectedJobForDetails = job;
    this.showDetailsModal = true;
  }

  closeDetailsModal(): void {
    this.showDetailsModal = false;
    this.selectedJobForDetails = null;
  }

  applyFromDetails(): void {
    if (this.selectedJobForDetails) {
      this.closeDetailsModal();
      this.openApplyModal(this.selectedJobForDetails);
    }
  }

  // Modal candidature
  openApplyModal(job: JobOffer): void {
    this.selectedJobForApply = job;
    this.selectedFile = null;
    this.uploadMessage = '';
    this.showApplyModal = true;
  }

  closeApplyModal(): void {
    this.showApplyModal = false;
    this.selectedJobForApply = null;
    this.selectedFile = null;
    this.uploadMessage = '';
    this.isUploading = false;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      const file = input.files[0];
      if (file.type === 'application/pdf') {
        this.selectedFile = file;
        this.uploadMessage = '';
      } else {
        this.uploadMessage = '❌ Only PDF files are accepted.';
        this.selectedFile = null;
      }
    }
  }

  submitApplication(): void {
    if (!this.selectedFile) {
      this.uploadMessage = '⚠️ Please select a PDF file.';
      return;
    }
    const jobId = this.selectedJobForApply?._id;
    if (!jobId) {
      this.uploadMessage = '❌ Job reference lost.';
      return;
    }
    this.isUploading = true;
    this.uploadMessage = '📤 Submitting application...';
    const formData = new FormData();
    formData.append('cv', this.selectedFile);
    this.candidateService.applyWithCV(jobId, formData).subscribe({
      next: (res) => {
        this.uploadMessage = `✅ Application submitted! AI Match Score: ${res.aiScore ?? 'N/A'}%`;
        this.isUploading = false;
        this.appliedJobIds.add(jobId);
        this.jobAiScores.set(jobId, res.aiScore ?? null);
        setTimeout(() => {
          this.closeApplyModal();
        }, 2000);
      },
      error: (err) => {
        this.uploadMessage = err.error?.message || '❌ Application failed.';
        this.isUploading = false;
      }
    });
  }

  // Modal détails du matching
  openMatchDetails(match: RecommendedJob): void {
    this.selectedMatchForModal = match;
    this.showMatchModal = true;
  }

  closeMatchModal(): void {
    this.showMatchModal = false;
    this.selectedMatchForModal = null;
  }

  getContractLabel(contractType?: string): string {
    return contractType || 'Not specified';
  }

  formatDeadline(deadline?: string): string {
    if (!deadline) return 'No deadline';
    return new Date(deadline).toLocaleDateString('en-GB');
  }
}