import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { GlobalDashboardComponent } from './components/global-dashboard/global-dashboard.component';
import { SessionExpiredModalComponent } from './components/session-expired-modal/session-expired-modal.component';
import { JobsOverviewComponent } from './components/jobs-overview/jobs-overview.component';
import { InterviewSchedulerComponent } from './components/interview-scheduler/interview-scheduler.component';

@NgModule({
  declarations: [
    GlobalDashboardComponent,
    SessionExpiredModalComponent,
    JobsOverviewComponent,
    InterviewSchedulerComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule,
  ],
  exports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule,
    // Components
    GlobalDashboardComponent,
    SessionExpiredModalComponent,
    JobsOverviewComponent,
    InterviewSchedulerComponent,
  ],
})
export class SharedModule {}