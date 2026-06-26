import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../_services/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.css'],
  imports: [CommonModule, ReactiveFormsModule, RouterModule, HttpClientModule]
})
export class ForgotPasswordComponent implements OnDestroy {
  forgotForm: FormGroup;
  isLoading = false;

  emailError = '';
  errorMessage = '';

  emailSent = false;
  submittedEmail = '';

  // Resend cooldown
  resendCooldown = 0;
  private cooldownInterval?: ReturnType<typeof setInterval>;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authService: AuthService
  ) {
    this.forgotForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });

    this.forgotForm.get('email')?.valueChanges.subscribe(() => {
      this.emailError = '';
      this.errorMessage = '';
    });
  }

  validateFields(): boolean {
    this.emailError = '';
    const email = this.forgotForm.get('email');
    if (email?.invalid) {
      if (email.errors?.['required']) this.emailError = 'L\'adresse email est requise.';
      else if (email.errors?.['email'])  this.emailError = 'Format d\'email invalide (ex: nom@domaine.com).';
      return false;
    }
    return true;
  }

  onSubmit() {
    if (!this.validateFields()) return;
    this._send(this.forgotForm.value.email);
  }

  resend() {
    if (this.resendCooldown > 0 || this.isLoading) return;
    this._send(this.submittedEmail);
  }

  private _send(email: string) {
    this.isLoading = true;
    this.errorMessage = '';

    this.authService.forgotPassword(email).subscribe({
      next: () => {
        this.isLoading = false;
        this.submittedEmail = email;
        this.emailSent = true;
        this._startCooldown(60);
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = 'A server error occurred. Please try again later.';
      }
    });
  }

  private _startCooldown(seconds: number) {
    this.resendCooldown = seconds;
    clearInterval(this.cooldownInterval);
    this.cooldownInterval = setInterval(() => {
      this.resendCooldown--;
      if (this.resendCooldown <= 0) {
        clearInterval(this.cooldownInterval);
        this.resendCooldown = 0;
      }
    }, 1000);
  }

  goToLogin() {
    this.router.navigate(['auth/login']);
  }

  ngOnDestroy() {
    clearInterval(this.cooldownInterval);
  }
}