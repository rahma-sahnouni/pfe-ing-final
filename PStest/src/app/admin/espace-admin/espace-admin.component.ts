import { Component, OnInit } from '@angular/core';
import { AuthService, CurrentUser } from '../../_services/auth.service';
import { Router } from '@angular/router';   // ← Import corrigé (depuis @angular/router)

@Component({
  selector: 'app-espace-admin',
  templateUrl: './espace-admin.component.html',
  styleUrls: ['./espace-admin.component.css']
})
export class EspaceAdminComponent implements OnInit {
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
      this.router.navigate(['/auth/login']);   // ← Chemin uniformisé
      return;
    }

    this.authService.logout(refreshToken).subscribe({
      next: () => {
        this.authService.clearSession();
        this.router.navigate(['/auth/login']);  // ← Chemin uniformisé
      },
      error: (err) => {
        console.error('Logout error', err);
        this.authService.clearSession();
        this.router.navigate(['/auth/login']);  // ← Chemin uniformisé
      }
    });
  }
}