import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CandidateEspaceComponent } from './candidate-espace/candidate-espace.component';
import { CandidateJOBEspaceComponent } from './candidate-jobespace/candidate-jobespace.component';
import { CandidateProfileComponent } from './candidate-profile/candidate-profile.component';
import { MyApplicationsComponent } from './my-applications/my-applications.component';
import { CandidateJourneyComponent } from './candidate-journey/candidate-journey.component';
import { CandidateTechTestComponent } from './candidate-tech-test/candidate-tech-test.component';
import { CandidateRhTestComponent } from './candidate-rh-test/candidate-rh-test.component';


const routes: Routes = [
  {
    path: '',
    component: CandidateEspaceComponent,
    children: [
      { path: '', redirectTo: 'my_applications', pathMatch: 'full' },
      { path: 'my_applications',          component: MyApplicationsComponent },
      { path: 'jobs',                      component: CandidateJOBEspaceComponent },
      { path: 'profile',                   component: CandidateProfileComponent },
      { path: 'my-journey',                component: CandidateJourneyComponent },
      { path: 'rh-test/:jobId/:testId',    component: CandidateRhTestComponent },  
      { path: 'tech-test/:jobId/:testId',  component: CandidateTechTestComponent }, 
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CandidateRoutingModule { }
