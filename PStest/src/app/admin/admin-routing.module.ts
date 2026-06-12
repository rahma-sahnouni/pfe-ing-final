import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { EspaceAdminComponent } from './espace-admin/espace-admin.component';
import { UserMangementComponent } from './user-mangement/user-mangement.component';
import { JobsOverviewComponent } from '../shared/components/jobs-overview/jobs-overview.component';
import { InterviewSchedulerComponent } from '../shared/components/interview-scheduler/interview-scheduler.component';

const routes: Routes = [
  {
    path: '',
    component: EspaceAdminComponent,
    children: [
      { path: '', redirectTo: 'userMangement', pathMatch: 'full' },
      { path: 'userMangement', component: UserMangementComponent },
      { path: 'candidates', component: JobsOverviewComponent },
      
            { path: 'interview-scheduler',      component: InterviewSchedulerComponent },


    ]
  }
]
@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AdminRoutingModule { }
