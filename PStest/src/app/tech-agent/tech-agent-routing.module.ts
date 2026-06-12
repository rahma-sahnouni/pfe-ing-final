import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { EspaceTechComponent } from './espace-tech/espace-tech.component';
import { TechJobComponent } from './tech-job/tech-job.component';
// import supprimée : TechTestsResultsComponent
import { TechTestsDetailsComponent } from './tech-tests-details/tech-tests-details.component';
import { GlobalDashboardComponent } from '../shared/components/global-dashboard/global-dashboard.component';
import { JobsOverviewComponent } from '../shared/components/jobs-overview/jobs-overview.component';
import { InterviewSchedulerComponent } from '../shared/components/interview-scheduler/interview-scheduler.component';

const routes: Routes = [
  {
    path: '',
    component: EspaceTechComponent,
    children: [
      { path: '', redirectTo: 'jobs', pathMatch: 'full' },
      { path: 'jobs', component: TechJobComponent },
      { path: 'candidates', component: JobsOverviewComponent },
      // Ligne suivante supprimée : { path: 'techTestResults', component: TechTestsResultsComponent },
      { path: 'tests/:testId', component: TechTestsDetailsComponent },
      { path: 'dashboard', component: GlobalDashboardComponent },
      { path: 'interview-scheduler', component: InterviewSchedulerComponent },
    ]
  }
]
@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class TechAgentRoutingModule { }