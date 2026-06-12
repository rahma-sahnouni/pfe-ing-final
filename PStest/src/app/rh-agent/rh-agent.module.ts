import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { RhAgentRoutingModule } from './rh-agent-routing.module';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RhEspaceComponent } from './rh-espace/rh-espace.component';
import { JobsRHComponent } from './jobs-rh/jobs-rh.component';
import { RouterModule } from '@angular/router';
import { CreateJobModalComponent } from './create-job-modal/create-job-modal.component';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ViewJobModalComponent } from './view-job-modal/view-job-modal.component';
import { DeleteJobModalComponent } from './delete-job-modal/delete-job-modal.component';
import { EditJobModalComponent } from './edit-job-modal/edit-job-modal.component';
import { JobTestsComponent } from './job-tests/job-tests.component';
import { TestConfiguratorComponent } from './test-configurator/test-configurator.component';
import { SharedModule } from '../shared/shared.module';
import { JobDetailsModalComponent } from './job-details-modal/job-details-modal.component';
import { JobCandidatesComponent } from './job-candidates/job-candidates.component';

@NgModule({
  declarations: [
    RhEspaceComponent,
    JobsRHComponent,
    CreateJobModalComponent,
    ViewJobModalComponent,
    DeleteJobModalComponent,
    EditJobModalComponent,

    JobTestsComponent,
    TestConfiguratorComponent,
    JobDetailsModalComponent,
    JobCandidatesComponent

  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    RhAgentRoutingModule,
    DragDropModule,
    SharedModule,
    ReactiveFormsModule,
    
  ]
})
export class RhAgentModule { }
