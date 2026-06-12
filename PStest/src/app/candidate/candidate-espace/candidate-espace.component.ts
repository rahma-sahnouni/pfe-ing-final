import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';          // ← correction ici
import { AuthService, CurrentUser } from '../../_services/auth.service';

@Component({
  selector: 'app-candidate-espace',
  templateUrl: './candidate-espace.component.html',
  styleUrl: './candidate-espace.component.css'
})
export class CandidateEspaceComponent implements OnInit {
  currentUser: CurrentUser | null = null;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit() {
    this.authService.getMe().subscribe({
      next: (res) => {
        this.currentUser = res.user;
        console.log('Utilisateur récupéré :', this.currentUser);
      },
      error: err => console.error('Erreur récupération user:', err)
    });
  }

  logout(): void {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      this.authService.clearSession();
      this.router.navigate(['auth/login']);
      return;
    }

    this.authService.logout(refreshToken).subscribe({
      next: () => {
        this.authService.clearSession();
        this.router.navigate(['auth/login']);
      },
      error: (err) => {
        console.error('Logout error', err);
        this.authService.clearSession();
        this.router.navigate(['/login']);
      }
    });
  }
}