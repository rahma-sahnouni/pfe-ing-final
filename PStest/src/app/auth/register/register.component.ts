import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../_services/auth.service';
import { CommonModule } from '@angular/common';

function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm  = group.get('confirmPassword')?.value;
  return password && confirm && password !== confirm ? { mismatch: true } : null;
}

@Component({
  selector: 'app-register',
  standalone: true,
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  imports: [CommonModule, ReactiveFormsModule, RouterModule]
})
export class RegisterComponent implements OnInit {
  registerForm!: FormGroup;
  isLoading = false;
  showPassword = false;
  showConfirmPassword = false;
  errorMessage  = '';
  successMessage = '';

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit() {
    this.registerForm = this.fb.group(
      {
        name: ['', [Validators.required, Validators.minLength(2)]],
        email: ['', [Validators.required, Validators.email]],
        password: ['', [
          Validators.required,
          Validators.minLength(8),
          Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&\-_#])[A-Za-z\d@$!%*?&\-_#]+$/)
        ]],
        confirmPassword: ['', Validators.required]
      },
      { validators: passwordMatchValidator }
    );

    this.registerForm.valueChanges.subscribe(() => {
      this.errorMessage  = '';
      this.successMessage = '';
    });
  }

  get passwordStrength(): { cls: string; label: string; width: string } {
    const pw = this.registerForm.get('password')?.value || '';
    const len = pw.length;
    const hasUpper   = /[A-Z]/.test(pw);
    const hasNumber  = /\d/.test(pw);
    const hasSpecial = /[@$!%*?&\-_#]/.test(pw);
    const score = (len >= 8 ? 1 : 0) + (hasUpper ? 1 : 0) + (hasNumber ? 1 : 0) + (hasSpecial ? 1 : 0);

    if (len < 6)     return { cls: 'weak',   label: 'Faible', width: '25%' };
    if (score <= 1)  return { cls: 'weak',   label: 'Faible', width: '30%' };
    if (score === 2) return { cls: 'medium', label: 'Moyen',  width: '60%' };
    return             { cls: 'strong', label: 'Fort',   width: '100%' };
  }

  onSubmit() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    const { name, email, password } = this.registerForm.value;
    const role = 'candidate';

    // Calling authService.register with your existing signature: (email, password, role, name)
    this.authService.register(email, password, role, name.trim()).subscribe({
      next: () => {
        this.isLoading = false;
        this.successMessage = 'Compte créé avec succès. Redirection...';
        setTimeout(() => this.router.navigate(['/login']), 2000);
      },
      error: (err) => {
        this.isLoading = false;
        const status = err.status;
        if (status === 409) {
          this.errorMessage = 'Un compte avec cet email existe déjà.';
        } else if (status === 422) {
          const msgs = err.error?.errors;
          this.errorMessage = Array.isArray(msgs) ? msgs[0] : 'Données invalides. Vérifiez le formulaire.';
        } else if (status === 429) {
          this.errorMessage = "Trop de tentatives d'inscription. Réessayez dans 1 heure.";
        } else {
          this.errorMessage = err.error?.message || "Erreur lors de l'inscription.";
        }
      }
    });
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }
}