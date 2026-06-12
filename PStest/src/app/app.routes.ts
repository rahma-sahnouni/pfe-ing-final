import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () =>
      import('./auth/auth.module').then(m => m.AuthModule)
  },
  {
    path: 'admin',
    loadChildren: () =>
      import('./admin/admin.module').then(m => m.AdminModule)
  },
  {
    path: 'rh',
    loadChildren: () =>
      import('./rh-agent/rh-agent.module').then(m => m.RhAgentModule)
  },
    {
    path: 'tech',
    loadChildren: () =>
      import('./tech-agent/tech-agent.module').then(m => m.TechAgentModule)
  },
  {
    path: 'candidate',
    loadChildren: () =>
      import('./candidate/candidate.module').then(m => m.CandidateModule)
  },
  { path: '', redirectTo: 'auth/login', pathMatch: 'full' }, // page par défaut
  { path: '**', redirectTo: 'auth/login' } // 404 redirect
];