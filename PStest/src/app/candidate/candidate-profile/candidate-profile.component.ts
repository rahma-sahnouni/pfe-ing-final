import { Component, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CandidateService, CandidateProfile, CVExtracted } from '../../_services/candidate.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../_services/auth.service';

const API = 'http://localhost:3000/api';

@Component({
  selector: 'app-candidate-profile',
  templateUrl: './candidate-profile.component.html',
  styleUrls: ['./candidate-profile.component.css'],
  standalone: false,
})
export class CandidateProfileComponent implements OnInit {
  @ViewChild('cvInput') cvInput!: ElementRef<HTMLInputElement>;

  // ── State ──────────────────────────────────────────────────────────────────
  profile: CandidateProfile | null = null;
  cvExtracted: CVExtracted | null = null;

  activeTab: 'cv' | 'info' | 'password' | 'skills' = 'cv';

  // Loading / error
  isLoadingProfile = false;
  profileError = '';

  // CV upload
  isUploadingCV = false;
  uploadProgress = 0;
  uploadMessage = '';
  selectedFile: File | null = null;
  isDragOver = false;

  // Personal info edit
  editForm = { name: '', phone: '', location: '', experience: 0, avatarColor: '#6366f1' };
  isSavingInfo = false;
  infoSuccess = '';
  infoError = '';

  // Password change
  pwForm2 = { currentPassword: '', newPassword: '', confirmPassword: '' };
  isChangingPw = false;
  pwSuccess = '';
  pwError = '';
  showCurrentPw = false;
  showNewPw = false;
  showConfirmPw = false;

  constructor(
    private candidateService: CandidateService,
    private authservice: AuthService
  ) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  // ── Profile ────────────────────────────────────────────────────────────────

  loadProfile(): void {
    this.isLoadingProfile = true;
    this.profileError = '';
    this.candidateService.getProfile().subscribe({
      next: (profile) => {
        this.profile = profile;
        this.cvExtracted = profile.cvExtracted || null;
        this.isLoadingProfile = false;
        this.seedEditForm(profile);
      },
      error: (err) => {
        this.profileError = err.error?.message || 'Failed to load profile.';
        this.isLoadingProfile = false;
      },
    });
  }

  private seedEditForm(profile: CandidateProfile): void {
    this.editForm = {
      name:        profile.name || this.cvExtracted?.name || '',
      phone:       profile.phone || this.cvExtracted?.phone || '',
      location:    profile.location || this.cvExtracted?.location || '',
      experience:  profile.experience ?? 0,
      avatarColor: profile.avatarColor || '#6366f1',
    };
  }

  // ── Personal Info ──────────────────────────────────────────────────────────

  savePersonalInfo(): void {
    this.infoSuccess = '';
    this.infoError = '';
    this.isSavingInfo = true;

    this.candidateService.updateProfile(this.editForm).subscribe({
      next: (updated) => {
        this.isSavingInfo = false;
        this.infoSuccess = 'Profile updated successfully!';
        if (this.profile) {
          this.profile.name        = updated.name        ?? this.profile.name;
          this.profile.phone       = updated.phone       ?? this.profile.phone;
          this.profile.location    = updated.location    ?? this.profile.location;
          this.profile.experience  = updated.experience  ?? this.profile.experience;
          this.profile.avatarColor = updated.avatarColor ?? this.profile.avatarColor;
        }
        setTimeout(() => (this.infoSuccess = ''), 4000);
      },
      error: (err) => {
        this.isSavingInfo = false;
        this.infoError = err.error?.message || 'Failed to update profile.';
      },
    });
  }

  cancelEditInfo(): void {
    if (this.profile) this.seedEditForm(this.profile);
    this.infoSuccess = '';
    this.infoError = '';
  }

  // ── Password ───────────────────────────────────────────────────────────────

  get passwordStrength(): { score: number; level: string; label: string } {
    const pw = this.pwForm2.newPassword;
    if (!pw) return { score: 0, level: '', label: '' };
    let score = 0;
    if (pw.length >= 8)   score++;
    if (pw.length >= 12)  score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw))    score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    const levels = ['', 'weak', 'fair', 'good', 'strong'];
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const idx = Math.min(score, 4);
    return { score, level: levels[idx], label: labels[idx] };
  }

  changePassword(): void {
    if (this.pwForm2.newPassword !== this.pwForm2.confirmPassword) return;
    if ((this.pwForm2.newPassword?.length ?? 0) < 8) return;

    this.pwSuccess = '';
    this.pwError = '';
    this.isChangingPw = true;

    this.authservice
      .changePassword(this.pwForm2.currentPassword, this.pwForm2.newPassword)
      .subscribe({
        next: () => {
          this.isChangingPw = false;
          this.pwSuccess = 'Password updated successfully!';
          this.resetPwForm();
          setTimeout(() => (this.pwSuccess = ''), 5000);
        },
        error: (err) => {
          this.isChangingPw = false;
          this.pwError = err.error?.message || 'Failed to update password.';
        },
      });
  }

  resetPwForm(): void {
    this.pwForm2 = { currentPassword: '', newPassword: '', confirmPassword: '' };
    this.showCurrentPw = false;
    this.showNewPw = false;
    this.showConfirmPw = false;
  }

  // ── CV Upload ──────────────────────────────────────────────────────────────

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(): void {
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.validateAndSetFile(file);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.validateAndSetFile(file);
  }

  validateAndSetFile(file: File): void {
    if (file.type !== 'application/pdf') {
      this.uploadMessage = '❌ Only PDF files are accepted.';
      this.selectedFile = null;
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.uploadMessage = '❌ File size must be under 10 MB.';
      this.selectedFile = null;
      return;
    }
    this.selectedFile = file;
    this.uploadMessage = `✅ "${file.name}" ready to upload.`;
  }

  triggerFileInput(): void {
    this.cvInput.nativeElement.click();
  }

  uploadCV(): void {
    if (!this.selectedFile) {
      this.uploadMessage = '⚠️ Please select a PDF file first.';
      return;
    }
    this.isUploadingCV = true;
    this.uploadProgress = 0;
    this.uploadMessage = '📤 Uploading and analysing with AI…';

    this.candidateService.uploadCV(this.selectedFile).subscribe({
      next: (event) => {
        if (!event) return;
        if (event.type === 'progress') {
          this.uploadProgress = event.value;
        } else if (event.type === 'response') {
          this.isUploadingCV = false;
          this.uploadProgress = 100;
          this.uploadMessage = '✅ CV analysed successfully!';
          this.cvExtracted = event.data.extracted;
          if (this.profile) {
            this.profile.cv          = event.data.cv;
            this.profile.cvExtracted = event.data.extracted;
          }
          this.selectedFile = null;
          // Auto-navigate to extracted data tab
          setTimeout(() => (this.activeTab = 'skills'), 1200);
        }
      },
      error: (err) => {
        this.isUploadingCV = false;
        this.uploadMessage = `❌ ${err.error?.message || 'Upload failed. Please try again.'}`;
      },
    });
  }

  // ── Computed getters ───────────────────────────────────────────────────────

  get hasCVUploaded(): boolean {
    return !!this.profile?.cv?.originalName;
  }

  get avatarInitials(): string {
    const name = this.profile?.name || this.cvExtracted?.name || this.profile?.email || '?';
    return name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
  }

  get displayName(): string {
    return this.profile?.name || this.cvExtracted?.name || 'Candidate';
  }

  get displayEmail(): string {
    return this.cvExtracted?.email || this.profile?.email || '—';
  }

  get displayPhone(): string {
    return this.cvExtracted?.phone || this.profile?.phone || '—';
  }

  get displayLocation(): string {
    return this.cvExtracted?.location || this.profile?.location || '—';
  }

  // ── Helpers pour le template ───────────────────────────────────────────────

  /**
   * Retourne le total d'expérience formaté :
   * ex: "1.5 ans (2 stages + 0 emplois)"
   */
  get experienceSummary(): string {
    if (!this.cvExtracted?.experience?.length) return '';
    const stages = this.cvExtracted.experience.filter((e: any) => e.type === 'stage').length;
    const jobs   = this.cvExtracted.experience.filter((e: any) => e.type === 'job').length;
    return `${stages} stage${stages !== 1 ? 's' : ''}, ${jobs} job${jobs !== 1 ? 's' : ''}`;
  }
}