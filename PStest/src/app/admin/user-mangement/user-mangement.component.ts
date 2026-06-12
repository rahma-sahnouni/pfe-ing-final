import { Component, OnInit } from '@angular/core';
import { UserService, UserApi } from '../../_services/user.service';

export interface User {
  id: string;
  name: string;
  joinDate: string;
  initials: string;
  role: 'HR Manager' | 'Tech Evaluator' | 'Admin' | 'Candidate' | 'Unknown';
  email: string;
  status: 'Active' | 'Inactive';
  lastLogin: string;
}

export interface NewUserForm {
  name: string;
  email: string;
  password: string;
  role: 'Admin' | 'HR Manager' | 'Candidate' | 'Tech Evaluator';
  department?: string;
}

export interface EditUserForm {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'HR Manager' | 'Candidate' | 'Tech Evaluator';
  status: 'Active' | 'Inactive';
}

@Component({
  selector: 'app-user-mangement',
  templateUrl: './user-mangement.component.html',
  styleUrls: ['./user-mangement.component.css']
})
export class UserMangementComponent implements OnInit {

  // Rôles disponibles pour le filtre latéral
  roleOptions = ['All', 'HR Manager', 'Tech Evaluator', 'Admin', 'Candidate'];
  selectedRole = 'All';

  searchQuery = '';

  allUsers: User[] = [];

  showCreateModal = false;
  showPassword = false;

  newUser: NewUserForm = this.emptyForm();
  errorMessage = '';

  // Edit modal
  showEditModal = false;
  editUser: EditUserForm = { id: '', name: '', email: '', role: 'HR Manager', status: 'Active' };
  editErrorMessage = '';

  // Delete confirmation
  showDeleteConfirm = false;
  deleteUserId: string | null = null;
  deleteUserName = '';

  constructor(private userService: UserService) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  // ──────────────── LOAD USERS ────────────────
  loadUsers(): void {
    this.userService.getUsers().subscribe({
      next: (users: UserApi[]) => {
        this.allUsers = users.map(u => {
          const name = u.name?.trim() || u.email?.split('@')[0] || 'Unknown';
          const initials = name.substring(0, 2).toUpperCase();

          let roleMapped: User['role'];
          switch (u.role) {
            case 'rh': roleMapped = 'HR Manager'; break;
            case 'admin': roleMapped = 'Admin'; break;
            case 'candidate': roleMapped = 'Candidate'; break;
            case 'technical evaluator': roleMapped = 'Tech Evaluator'; break;
            default: roleMapped = 'Unknown';
          }

          return {
            id: u.id,
            name,
            initials,
            email: u.email,
            role: roleMapped,
            status: u.isActive ? 'Active' : 'Inactive',
            lastLogin: u.lastLogin
              ? new Date(u.lastLogin).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })
              : 'Never',
            joinDate: u.createdAt
              ? `Joined ${new Date(u.createdAt).toLocaleString('en-US', { month: 'short', year: 'numeric' })}`
              : 'Unknown'
          } as User;
        });
      },
      error: (err) => {
        console.error('Erreur lors du chargement des utilisateurs:', err);
      }
    });
  }

  // Filtrer par rôle + recherche (sans pagination)
  get filteredUsers(): User[] {
    let filtered = this.allUsers;
    if (this.selectedRole !== 'All') {
      filtered = filtered.filter(u => u.role === this.selectedRole);
    }
    const q = this.searchQuery.toLowerCase();
    if (q) {
      filtered = filtered.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
      );
    }
    return filtered;
  }

  // Stats
  get totalUsers(): number {
    return this.allUsers.length;
  }

  get activeNow(): number {
    return this.allUsers.filter(u => u.status === 'Active').length;
  }

  get hrManagers(): number {
    return this.allUsers.filter(u => u.role === 'HR Manager').length;
  }

  get techEvaluators(): number {
    return this.allUsers.filter(u => u.role === 'Tech Evaluator').length;
  }

  onSearch() {
    // juste pour déclencher la détection de changement – la recherche est réactive
  }

  // ──────────────── CREATE MODAL ────────────────
  private emptyForm(): NewUserForm {
    return {
      name: '',
      email: '',
      password: this.generatePassword(),
      role: 'HR Manager',
      department: 'Engineering'
    };
  }

  private generatePassword(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$';
    return Array.from({ length: 12 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  }

  openCreateModal() {
    this.newUser = this.emptyForm();
    this.showPassword = false;
    this.errorMessage = '';
    this.showCreateModal = true;
  }

  closeCreateModal() {
    this.showCreateModal = false;
    this.errorMessage = '';
  }

  isFormValid(): boolean {
    return (
      this.newUser.name.trim().length > 0 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.newUser.email)
    );
  }

  saveUser() {
    if (!this.isFormValid()) return;

    const backendRole = (() => {
      switch (this.newUser.role) {
        case 'Admin': return 'admin';
        case 'HR Manager': return 'rh';
        case 'Candidate': return 'candidate';
        case 'Tech Evaluator': return 'technical evaluator';
        default: return 'rh';
      }
    })();

    const payload: any = {
      email: this.newUser.email,
      password: this.newUser.password,
      role: backendRole,
      name: this.newUser.name.trim()
    };

    if (backendRole === 'candidate') {
      payload.phone = this.newUser.department || '';
      payload.jobOffer = null;
      payload.experience = 0;
    }

    this.userService.createUser(payload).subscribe({
      next: () => {
        this.loadUsers();
        this.closeCreateModal();
      },
      error: (err) => {
        console.error('Full error body:', JSON.stringify(err.error));
        if (err.error?.errors?.length) {
          this.errorMessage = err.error.errors.join(', ');
        } else {
          this.errorMessage = err.error?.message || 'Erreur serveur';
        }
      }
    });
  }

  // ──────────────── EDIT MODAL ────────────────
  openEditModal(user: User) {
    let editRole: EditUserForm['role'];
    switch (user.role) {
      case 'HR Manager': editRole = 'HR Manager'; break;
      case 'Tech Evaluator': editRole = 'Tech Evaluator'; break;
      case 'Admin': editRole = 'Admin'; break;
      case 'Candidate': editRole = 'Candidate'; break;
      default: editRole = 'HR Manager';
    }

    this.editUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: editRole,
      status: user.status
    };
    this.editErrorMessage = '';
    this.showEditModal = true;
  }

  closeEditModal() {
    this.showEditModal = false;
    this.editErrorMessage = '';
  }

  isEditFormValid(): boolean {
    return (
      this.editUser.name.trim().length > 0 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.editUser.email)
    );
  }

  // ──────────────── DELETE CONFIRMATION ────────────────
  confirmDelete(user: User) {
    this.deleteUserId = user.id;
    this.deleteUserName = user.name;
    this.showDeleteConfirm = true;
  }

  closeDeleteConfirm() {
    this.showDeleteConfirm = false;
    this.deleteUserId = null;
    this.deleteUserName = '';
  }

  deleteUser() {
    if (!this.deleteUserId) return;

    this.userService.deleteUser(this.deleteUserId).subscribe({
      next: () => {
        this.loadUsers();
        this.closeDeleteConfirm();
      },
      error: (err) => {
        console.error('Delete error:', err);
        alert('Failed to delete user: ' + (err.error?.message || 'Unknown error'));
        this.closeDeleteConfirm();
      }
    });
  }
  // Retourne le nombre d'utilisateurs pour un rôle donné (ou total si 'All')
getRoleCount(role: string): number {
  if (role === 'All') {
    return this.allUsers.length;
  }
  return this.allUsers.filter(user => user.role === role).length;
}
// View details modal (candidats)
showDetailsModal = false;
selectedCandidate: User | null = null;

openDetailsModal(user: User) {
  this.selectedCandidate = user;
  this.showDetailsModal = true;
}

closeDetailsModal() {
  this.showDetailsModal = false;
  this.selectedCandidate = null;
}
}