// src/app/_services/auth.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const API = 'http://localhost:3000/api/auth';

export interface CurrentUser {
  id:        string;
  email:     string;
  role:      'admin' | 'rh' | 'candidate' | 'technical evaluator';
  isActive:  boolean;
  lastLogin?: string;
  createdAt?: string;
}

export interface LoginResponse {
  success:      boolean;
  accessToken:  string;
  refreshToken: string;
  user:         CurrentUser;
}

export interface TokenRefreshResponse {
  success:      boolean;
  accessToken:  string;
  refreshToken: string;
  user:         CurrentUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {

  private currentUserSubject = new BehaviorSubject<CurrentUser | null>(null);
  readonly currentUser$ = this.currentUserSubject.asObservable();

  private expiredSubject = new BehaviorSubject<boolean>(false);
  readonly expired$ = this.expiredSubject.asObservable();

  constructor(private http: HttpClient) {}

  // ── Synchronous snapshot ──────────────────────────────────────────────────
  get currentUserValue(): CurrentUser | null {
    return this.currentUserSubject.value;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  login(email: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API}/login`, { email, password });
  }

  register(email: string, password: string, role: string, name: string): Observable<{ success: boolean; user: CurrentUser }> {
    return this.http.post<{ success: boolean; user: CurrentUser }>(`${API}/register`, { email, password, role, name });
  }

  /**
   * Initialise la session utilisateur à partir du token stocké.
   * Doit être appelée avant le chargement de l'application.
   * Retourne une Promise pour APP_INITIALIZER.
   */
  initSession(): Promise<void> {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      return Promise.resolve();
    }
    return this.getMe().toPromise()
      .then(() => {
        // currentUserSubject déjà mis à jour dans getMe() via le tap
      })
      .catch(() => {
        // Token invalide ou expiré
        this.clearSession();
      });
  }

  refreshToken(refreshToken: string): Observable<TokenRefreshResponse> {
    return this.http.post<TokenRefreshResponse>(`${API}/refresh-token`, { refreshToken })
      .pipe(
        tap(res => {
          if (res.success && res.user) {
            this.currentUserSubject.next(res.user);
          }
        })
      );
  }

  logout(refreshToken: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(`${API}/logout`, { refreshToken });
  }

  logoutAll(refreshToken: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(`${API}/logout-all`, { refreshToken });
  }

  // ── Profile ───────────────────────────────────────────────────────────────
  getMe(): Observable<{ success: boolean; user: CurrentUser }> {
    return this.http.get<{ success: boolean; user: CurrentUser }>(`${API}/me`).pipe(
      tap(res => this.currentUserSubject.next(res.user))
    );
  }

  changePassword(currentPassword: string, newPassword: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${API}/change-password`,
      { currentPassword, newPassword }
    );
  }

  // ── Password reset ────────────────────────────────────────────────────────
  forgotPassword(email: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(`${API}/forgot-password`, { email });
  }

  resetPassword(token: string, newPassword: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(`${API}/reset-password`, { token, newPassword });
  }

  // ── Session helpers ───────────────────────────────────────────────────────
  clearSession(): void {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    this.currentUserSubject.next(null);
  }

  markExpired(): void {
    if (!this.expiredSubject.value) this.expiredSubject.next(true);
  }

  resetExpired(): void {
    this.expiredSubject.next(false);
  }
}