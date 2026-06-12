import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CandidateRoutingModule } from './candidate-routing.module';
import { RouterModule } from '@angular/router';
import { CandidateEspaceComponent } from './candidate-espace/candidate-espace.component';
import { CandidateJOBEspaceComponent } from './candidate-jobespace/candidate-jobespace.component';
import { FormsModule } from '@angular/forms';
import { CandidateProfileComponent } from './candidate-profile/candidate-profile.component';
import { CodeEditorComponent } from './code-editor/code-editor.component';
import { AvgTimePipe, CountPassPipe } from '../_pipes/test-results.pipe';
import { MyApplicationsComponent } from './my-applications/my-applications.component';
import { SharedModule } from '../shared/shared.module';
import { CandidateJourneyComponent } from './candidate-journey/candidate-journey.component';
import { CandidateRhTestComponent } from './candidate-rh-test/candidate-rh-test.component';
import { CandidateTechTestComponent } from './candidate-tech-test/candidate-tech-test.component';


@NgModule({
  declarations: [
    CandidateEspaceComponent,
    CandidateJOBEspaceComponent,
    CandidateProfileComponent,
   CodeEditorComponent,
    MyApplicationsComponent,
    CandidateJourneyComponent,
    CandidateRhTestComponent,
    CandidateTechTestComponent
  ],
  imports: [
    CommonModule,
    CandidateRoutingModule,
    RouterModule,
    FormsModule,
    CountPassPipe,
    AvgTimePipe,
    SharedModule
  ]
})
export class CandidateModule { }
