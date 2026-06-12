import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RhEspaceComponent } from './rh-espace/rh-espace.component';
import { JobsRHComponent } from './jobs-rh/jobs-rh.component';

import { JobTestsComponent } from './job-tests/job-tests.component';
import { TestConfiguratorComponent } from './test-configurator/test-configurator.component';

import { RhTestResultsComponent } from './rh-test-results/rh-test-results.component';
import { JobsOverviewComponent } from '../shared/components/jobs-overview/jobs-overview.component';
import { JobCandidatesComponent } from './job-candidates/job-candidates.component';
import { InterviewSchedulerComponent } from '../shared/components/interview-scheduler/interview-scheduler.component';

const routes: Routes = [
  {
    path: '',
    component: RhEspaceComponent,
    children: [
      { path: '', redirectTo: 'jobs', pathMatch: 'full' },
      { path: 'jobs', component: JobsRHComponent },
        { path: 'jobs/:id/candidates', component: JobCandidatesComponent },

      { path: 'candidates', component: JobsOverviewComponent },

  /* ── Job Tests ── */
      { path: 'job-tests',              component: JobTestsComponent },
      { path: 'job-tests/:jobId',       component: TestConfiguratorComponent },
      { path: 'job-tests-results',      component: RhTestResultsComponent },
            { path: 'interview-scheduler',      component: InterviewSchedulerComponent },


    ]
  }
]

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class RhAgentRoutingModule { }
