import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
export interface UserApi {
  id: string;
  email: string;
    name?: string | null; // <== ajouter ceci
  role: string | null; 
  isActive: boolean;
  lastLogin: string;
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class UserService {

  private apiUrl = 'http://localhost:3000/api/admin/users';

  constructor(private http: HttpClient) {}

  getUsers(): Observable<UserApi[]> {
    return this.http.get<UserApi[]>(this.apiUrl);
  }

  createUser(data: { email: string; password: string; role: string }) {
    return this.http.post(this.apiUrl, data);
  }



deleteUser(id: string): Observable<any> {
  return this.http.delete(`${this.apiUrl}/${id}`);
}

}