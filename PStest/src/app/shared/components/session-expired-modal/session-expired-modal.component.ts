// shared/session-expired-modal/session-expired-modal.component.ts
import {
  Component, OnInit, OnDestroy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule }          from '@angular/common';
import { Router }                from '@angular/router';
import { Subscription }          from 'rxjs';
import { AuthService }           from '../../../_services/auth.service';

@Component({
  selector:    'app-session-expired-modal',
  templateUrl: './session-expired-modal.component.html',
  styleUrls:   ['./session-expired-modal.component.css']
})
export class SessionExpiredModalComponent implements OnInit, OnDestroy {
  visible   = false;
  countdown = 10;

  private sub!: Subscription;
  private timer: any;

  constructor(
    private sessionSvc: AuthService,
    private authService: AuthService,
    private router:      Router,
    private cdr:         ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.sub = this.sessionSvc.expired$.subscribe(triggered => {
      if (triggered && !this.visible) this.show();
    });
  }

  show() {
    this.visible   = true;
    this.countdown = 10;
    this.cdr.detectChanges();

    this.timer = setInterval(() => {
      this.countdown--;
      this.cdr.detectChanges();
      if (this.countdown <= 0) this.goToLogin();
    }, 1000);
  }

  goToLogin() {
    clearInterval(this.timer);
    this.visible = false;
    this.authService.clearSession();   // uses your existing AuthService method
    this.sessionSvc.resetExpired();
    this.router.navigate(['/auth/login']);
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    clearInterval(this.timer);
  }
}