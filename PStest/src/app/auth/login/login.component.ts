import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { AuthService } from '../../_services/auth.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    HttpClientModule
  ]
})
export class LoginComponent implements OnInit {
  loginForm: FormGroup;
  isLoading = false;
  showPassword = false;

  // Error states
  errorMessage = '';
  errorType: 'credentials' | 'disabled' | 'locked' | 'server' | '' = '';

  // Locked account state
  showLockedModal = false;
  lockRemainingMinutes = 0;

  // Disabled account state
  showDisabledModal = false;

  // Field-level errors
  emailError = '';
  passwordError = '';

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authService: AuthService
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit() {
    // Clear errors on value changes
    this.loginForm.get('email')?.valueChanges.subscribe(() => {
      this.emailError = '';
      this.errorMessage = '';
      this.errorType = '';
    });
    this.loginForm.get('password')?.valueChanges.subscribe(() => {
      this.passwordError = '';
      this.errorMessage = '';
      this.errorType = '';
    });
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  validateFields(): boolean {
    this.emailError = '';
    this.passwordError = '';
    let valid = true;

    const email = this.loginForm.get('email');
    const password = this.loginForm.get('password');

    if (email?.invalid) {
      if (email.errors?.['required']) this.emailError = 'Email address is required.';
      else if (email.errors?.['email']) this.emailError = 'Invalid email format (e.g. name@domain.com).';
      valid = false;
    }

    if (password?.invalid) {
      if (password.errors?.['required']) this.passwordError = 'Password is required.';
      else if (password.errors?.['minlength']) this.passwordError = 'Password must be at least 6 characters.';
      valid = false;
    }

    return valid;
  }

  onSubmit() {
    if (!this.validateFields()) return;

    this.isLoading = true;
    this.errorMessage = '';
    this.errorType = '';

    const { email, password } = this.loginForm.value;

    this.authService.login(email, password).subscribe({
      next: (res) => {
        this.isLoading = false;
        localStorage.setItem('accessToken', res.accessToken);
        localStorage.setItem('refreshToken', res.refreshToken);

        switch (res.user.role) {
          case 'admin': this.router.navigate(['admin/userMangement']); break;
          case 'rh': this.router.navigate(['rh/jobs']); break;
          case 'technical evaluator': this.router.navigate(['tech/jobs']); break;
          case 'candidate': this.router.navigate(['candidate/jobs']); break;
        }
      },
      error: (err) => {
        this.isLoading = false;
        const status = err.status;
        const message = err.error?.message || '';

        if (status === 401) {
          // Wrong credentials
          this.errorType = 'credentials';
          this.errorMessage = 'Incorrect email or password. Please check your credentials.';
          // Shake the form
          this.triggerShake();
        } else if (status === 423) {
          // Account locked
          this.errorType = 'locked';
          // Extract remaining minutes from message
          const match = message.match(/(\d+)\s*minute/);
          this.lockRemainingMinutes = match ? parseInt(match[1]) : 15;
          this.showLockedModal = true;
        } else if (status === 403) {
          // Account disabled
          this.errorType = 'disabled';
          this.showDisabledModal = true;
        } else if (status === 429) {
          // Rate limit
          this.errorType = 'locked';
          this.lockRemainingMinutes = 15;
          this.showLockedModal = true;
        } else {
          // Generic server error
          this.errorType = 'server';
          this.errorMessage = 'A server error occurred. Please try again later.';
        }
      }
    });
  }

  triggerShake() {
    const form = document.querySelector('.login-card');
    form?.classList.add('shake');
    setTimeout(() => form?.classList.remove('shake'), 600);
  }

  closeLockedModal() {
    this.showLockedModal = false;
  }

  closeDisabledModal() {
    this.showDisabledModal = false;
  }

  goToRegister() {
    this.router.navigate(['auth/register']);
  }
goToResetPassword(){
  this.router.navigate(['auth/reset-password']);
}
  forgotPassword() {
    // À implémenter
  }
}