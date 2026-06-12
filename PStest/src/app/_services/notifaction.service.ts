// src/app/_services/notification.service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';

const API_URL = 'http://localhost:3000/api/notifications';
const SOCKET_URL = 'http://localhost:3000';

export interface AppNotification {
  _id?: string;
  message: string;
  type: string;
  jobId: string;
  createdAt: Date;
  read: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {
  private socket!: Socket;
  private notificationsSubject = new BehaviorSubject<AppNotification[]>([]);
  readonly notifications$ = this.notificationsSubject.asObservable();

  private unreadCountSubject = new BehaviorSubject<number>(0);
  readonly unreadCount$ = this.unreadCountSubject.asObservable();

  constructor(private http: HttpClient) {}

  private updateUnreadCount(notifications: AppNotification[]) {
    const count = notifications.filter(n => !n.read).length;
    this.unreadCountSubject.next(count);
  }

  connect(token: string): void {
    if (this.socket?.connected) return;

    // Récupération des notifications existantes
    this.http.get<AppNotification[]>(API_URL).subscribe({
      next: notifs => {
        const mapped = notifs.map(n => ({ ...n, read: n.read ?? false }));
        this.notificationsSubject.next(mapped);
        this.updateUnreadCount(mapped);
      },
      error: err => console.error('[NotificationService] fetch error:', err.message),
    });

    // Connexion socket
    this.socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });

    this.socket.on('notification', (notif: Omit<AppNotification, 'read'>) => {
      const newNotif = { ...notif, read: false, createdAt: new Date(notif.createdAt) };
      const current = this.notificationsSubject.value;
      const updated = [newNotif, ...current];
      this.notificationsSubject.next(updated);
      this.updateUnreadCount(updated);
    });

    this.socket.on('connect_error', err => console.error('[NotificationService] socket error:', err.message));
  }

markReadByTypes(types: string[]): Observable<{ success: boolean }> {
  const result = this.http.patch<{ success: boolean }>(`${API_URL}/read`, { types });
  result.subscribe({
    next: () => {
      const updated = this.notificationsSubject.value.map(n =>
        // ✅ si types est vide → tout marquer lu, sinon filtrer par type
        (types.length === 0 || types.includes(n.type)) ? { ...n, read: true } : n
      );
      this.notificationsSubject.next(updated);
      this.updateUnreadCount(updated);
    },
    error: err => console.error('[markReadByTypes] error:', err)
  });
  return result;
}

// Raccourci pour tout marquer lu (cloche, espace-tech, etc.)
markAllRead(): Observable<{ success: boolean }> {
  return this.markReadByTypes([]);
}
  disconnect(): void {
    this.socket?.disconnect();
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}