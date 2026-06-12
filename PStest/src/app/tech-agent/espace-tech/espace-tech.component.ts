import { Component, OnInit, Renderer2 } from '@angular/core';
import { AuthService, CurrentUser } from '../../_services/auth.service';
import { Router } from '@angular/router';
import { NotificationService, AppNotification } from '../../_services/notifaction.service';

@Component({
  selector: 'app-espace-tech',
  templateUrl: './espace-tech.component.html',
  styleUrls: ['./espace-tech.component.css']
})
export class EspaceTechComponent implements OnInit {
  currentUser: CurrentUser | null = null;
  isDarkMode = true;
  showNotifications = false;

  // Badges sidebar
  testManagementBadge = 0;
  testsResultsBadge = 0;
  interviewSchedulerBadge = 0;

  constructor(
    private authService: AuthService,
    private renderer: Renderer2,
    private router: Router,
    public notifService: NotificationService
  ) {
    this.updateBodyClass();
  }

  ngOnInit() {
    this.authService.getMe().subscribe({
      next: (res) => {
        this.currentUser = res.user;
        const token = localStorage.getItem('accessToken');
        if (token) {
          this.notifService.connect(token);
          this.notifService.notifications$.subscribe(notifications => {
            this.updateSidebarBadges(notifications);
          });
        }
      },
      error: err => console.error('Erreur récupération user:', err)
    });
  }

  private updateSidebarBadges(notifications: AppNotification[]) {
    if (!notifications) return;
    const unread = notifications.filter(n => !n.read);

    // "Test Management" — assigné pour créer un test technique
    this.testManagementBadge = unread.filter(n =>
      ['TECH_TEST_ASSIGNMENT'].includes(n.type)
    ).length;

    // "Tests Results" — un test a été soumis
    this.testsResultsBadge = unread.filter(n =>
      ['TEST_SUBMITTED', 'TECH_TEST_SUBMITTED'].includes(n.type)
    ).length;

    // "Interview Scheduler" — assigné pour conduire un entretien technique
    this.interviewSchedulerBadge = unread.filter(n =>
      ['TECH_INTERVIEW_ASSIGNMENT'].includes(n.type)
    ).length;
  }

  onNavClick(types: string[]) {
    if (!types.length) return;
    this.notifService.markReadByTypes(types).subscribe();
  }

  toggleNotifications() {
    this.showNotifications = !this.showNotifications;
    if (this.showNotifications) this.notifService.markAllRead().subscribe();
  }

  toggleTheme() {
    this.isDarkMode = !this.isDarkMode;
    this.updateBodyClass();
  }

  private updateBodyClass() {
    if (this.isDarkMode) {
      this.renderer.addClass(document.body, 'dark-mode');
      this.renderer.removeClass(document.body, 'light-mode');
    } else {
      this.renderer.addClass(document.body, 'light-mode');
      this.renderer.removeClass(document.body, 'dark-mode');
    }
  }

  logout(): void {
    this.notifService.disconnect();
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      this.authService.clearSession();
      this.router.navigate(['/auth/login']);
      return;
    }
    this.authService.logout(refreshToken).subscribe({
      next: () => { this.authService.clearSession(); this.router.navigate(['/auth/login']); },
      error: () => { this.authService.clearSession(); this.router.navigate(['/auth/login']); }
    });
  }
}