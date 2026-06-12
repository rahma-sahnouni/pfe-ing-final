import { Injectable } from '@angular/core';
import {
  HttpInterceptor, HttpRequest,
  HttpHandler, HttpEvent, HttpErrorResponse
} from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, switchMap, filter, take } from 'rxjs/operators';
import { AuthService } from '../_services/auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isRefreshing = false;
  private refreshTokenSubject = new BehaviorSubject<string | null>(null);

  constructor(private authSvc: AuthService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Évite de boucler sur l'endpoint de refresh
    if (req.url.includes('/refresh-token')) {
      return next.handle(req);
    }

    const token = localStorage.getItem('accessToken');
    let authReq = req;
    if (token) {
      authReq = req.clone({
        setHeaders: { Authorization: `Bearer ${token}` }
      });
    }

    return next.handle(authReq).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401 && !req.url.includes('/login')) {
          return this.handle401Error(authReq, next);
        }
        return throwError(() => error);
      })
    );
  }

  private handle401Error(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);

      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        this.authSvc.markExpired();
        this.authSvc.clearSession();
        return throwError(() => new Error('No refresh token'));
      }

      return this.authSvc.refreshToken(refreshToken).pipe(
        switchMap((response) => {
          this.isRefreshing = false;
          if (response.success) {
            localStorage.setItem('accessToken', response.accessToken);
            localStorage.setItem('refreshToken', response.refreshToken);
            // Le currentUserSubject est déjà mis à jour dans refreshToken()
            this.refreshTokenSubject.next(response.accessToken);
            // Rejoue la requête initiale avec le nouveau token
            const newAuthReq = request.clone({
              setHeaders: { Authorization: `Bearer ${response.accessToken}` }
            });
            return next.handle(newAuthReq);
          } else {
            this.authSvc.markExpired();
            this.authSvc.clearSession();
            return throwError(() => new Error('Refresh failed'));
          }
        }),
        catchError((err) => {
          this.isRefreshing = false;
          this.authSvc.markExpired();
          this.authSvc.clearSession();
          return throwError(() => err);
        })
      );
    } else {
      // Si un refresh est déjà en cours, attends le nouveau token
      return this.refreshTokenSubject.pipe(
        filter(token => token !== null),
        take(1),
        switchMap(token => {
          const newAuthReq = request.clone({
            setHeaders: { Authorization: `Bearer ${token}` }
          });
          return next.handle(newAuthReq);
        })
      );
    }
  }
}