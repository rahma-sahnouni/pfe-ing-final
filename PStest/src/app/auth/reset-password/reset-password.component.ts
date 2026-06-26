import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../_services/auth.service';

// Custom validator: confirm password must match newPassword
function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const parent = control.parent;
  if (!parent) return null;
  return parent.get('newPassword')?.value === control.value ? null : { mismatch: true };
}

@Component({
  selector: 'app-reset-password',
  standalone: true,
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.css'],
  imports: [CommonModule, ReactiveFormsModule, RouterModule, HttpClientModule]
})
export class ResetPasswordComponent implements OnInit, OnDestroy {
  resetForm: FormGroup;
  isLoading = false;

  passwordError = '';
  confirmError = '';
  errorMessage = '';

  showPassword = false;
  showConfirm  = false;

  tokenInvalid = false;
  resetSuccess = false;

  // Password strength
  strengthPercent = 0;
  strengthLabel   = '';
  strengthClass   = '';

  // Redirect countdown after success
  redirectCountdown = 5;
  redirectPercent   = 100;
  private redirectInterval?: ReturnType<typeof setInterval>;

  private token = '';

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private route: ActivatedRoute,
    private authService: AuthService
  ) {
    this.resetForm = this.fb.group({
      newPassword:     ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required, passwordsMatch]]
    });
  }

  ngOnInit() {
    // Read token from query param
    this.route.queryParams.subscribe(params => {
      this.token = params['token'] || '';
      if (!this.token) this.tokenInvalid = true;
    });

    // Live strength + clear errors
    this.resetForm.get('newPassword')?.valueChanges.subscribe(val => {
      this.passwordError = '';
      this.errorMessage = '';
      this._updateStrength(val);
      // Re-validate confirm
      this.resetForm.get('confirmPassword')?.updateValueAndValidity();
    });

    this.resetForm.get('confirmPassword')?.valueChanges.subscribe(() => {
      this.confirmError = '';
    });
  }

  private _updateStrength(password: string) {
    if (!password) { this.strengthPercent = 0; this.strengthLabel = ''; return; }
    let score = 0;
    if (password.length >= 8)  score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    const map: Record<number, { p: number; l: string; c: string }> = {
      0: { p: 15, l: 'Weak',   c: 'weak' },
      1: { p: 30, l: 'Weak',   c: 'weak' },
      2: { p: 50, l: 'Fair',   c: 'fair' },
      3: { p: 70, l: 'Good',   c: 'good' },
      4: { p: 85, l: 'Good',   c: 'good' },
      5: { p: 100, l: 'Strong', c: 'strong' }
    };
    const r = map[score] ?? map[0];
    this.strengthPercent = r.p;
    this.strengthLabel   = r.l;
    this.strengthClass   = r.c;
  }

  validateFields(): boolean {
    this.passwordError = '';
    this.confirmError  = '';
    let valid = true;

    const pw = this.resetForm.get('newPassword');
    const cp = this.resetForm.get('confirmPassword');

    if (pw?.invalid) {
      if (pw.errors?.['required'])   this.passwordError = 'Password is required.';
      else if (pw.errors?.['minlength']) this.passwordError = 'Password must be at least 8 characters.';
      valid = false;
    }

    if (cp?.invalid) {
      if (cp.errors?.['required'])  this.confirmError = 'Please confirm your password.';
      else if (cp.errors?.['mismatch']) this.confirmError = 'Passwords do not match.';
      valid = false;
    }

    return valid;
  }

  onSubmit() {
    if (!this.validateFields()) return;

    this.isLoading = true;
    this.errorMessage = '';

    const { newPassword } = this.resetForm.value;

    this.authService.resetPassword(this.token, newPassword).subscribe({
      next: () => {
        this.isLoading = false;
        this.resetSuccess = true;
        this._startRedirect();
      },
      error: (err) => {
        this.isLoading = false;
        const status = err.status;
        if (status === 400) {
          this.tokenInvalid = true;
        } else {
          this.errorMessage = 'A server error occurred. Please try again later.';
        }
      }
    });
  }

  private _startRedirect() {
    this.redirectCountdown = 5;
    this.redirectPercent   = 100;
    this.redirectInterval  = setInterval(() => {
      this.redirectCountdown--;
      this.redirectPercent = (this.redirectCountdown / 5) * 100;
      if (this.redirectCountdown <= 0) {
        clearInterval(this.redirectInterval);
        this.goToLogin();
      }
    }, 1000);
  }

  togglePassword() { this.showPassword = !this.showPassword; }
  toggleConfirm()  { this.showConfirm  = !this.showConfirm; }

  goToLogin()  { this.router.navigate(['auth/login']); }
  goToForgot() { this.router.navigate(['auth/forgot-password']); }

  ngOnDestroy() {
    clearInterval(this.redirectInterval);
  }
}