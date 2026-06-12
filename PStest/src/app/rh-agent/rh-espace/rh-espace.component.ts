// src/app/rh-agent/rh-espace/rh-espace.component.ts
import { Component, OnInit, Renderer2 } from '@angular/core';
import { AuthService, CurrentUser } from '../../_services/auth.service';
import { Router } from '@angular/router';
import { NotificationService, AppNotification } from '../../_services/notifaction.service';

@Component({
  selector: 'app-rh-espace',
  templateUrl: './rh-espace.component.html',
  styleUrls: ['./rh-espace.component.css']
})
export class RhEspaceComponent implements OnInit {
  currentUser: CurrentUser | null = null;
  isDarkMode = true;
  showNotifications = false;

  // Badges pour le sidebar
  testsBadge = 0;
  testsResultsBadge = 0;
  myJobsBadge = 0;
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
          // Mise à jour des badges à chaque changement de notifications
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
  console.log('[badges] total:', notifications.length, '| unread:', unread.length); // 👈 debug

  this.testsBadge = unread.filter(n =>
    ['RH_TEST_ASSIGNMENT', 'TECH_TEST_ASSIGNMENT'].includes(n.type)
  ).length;

  this.testsResultsBadge = unread.filter(n =>
    ['TEST_SUBMITTED', 'RH_TEST_SUBMITTED', 'TECH_TEST_SUBMITTED'].includes(n.type)
  ).length;

  this.myJobsBadge = unread.filter(n =>
    ['TECH_TEST_ASSIGNMENT', 'RH_ASSESSMENT_COMPLETE'].includes(n.type)
  ).length;

  this.interviewSchedulerBadge = unread.filter(n =>
    ['RH_INTERVIEW_ASSIGNMENT', 'TECH_INTERVIEW_ASSIGNMENT'].includes(n.type)
  ).length;
  this.myJobsBadge = unread.filter(n =>
  ['TECH_TEST_ASSIGNMENT', 'RH_ASSESSMENT_COMPLETE', 
   'technical_test_assigned', 'rh_test_completed'].includes(n.type)  // ✅ ajout
).length;
}

onNavClick(types: string[]) {
  if (!types.length) return;
  this.notifService.markReadByTypes(types).subscribe();
}
toggleNotifications() {
  this.showNotifications = !this.showNotifications;
  if (this.showNotifications) {
    // markAllRead() → notificationsSubject émet → updateSidebarBadges() → badges = 0
    this.notifService.markReadByTypes([]).subscribe();
  }
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