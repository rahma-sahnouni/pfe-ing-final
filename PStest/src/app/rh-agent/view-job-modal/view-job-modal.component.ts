import { Component, Input, Output, EventEmitter } from '@angular/core';
import { JobOffer } from '../../_services/job-offer.service';

@Component({
  selector: 'app-view-job-modal',
  templateUrl: './view-job-modal.component.html',
  styleUrls: ['./view-job-modal.component.css']
})
export class ViewJobModalComponent {
  @Input() job!: JobOffer;
  @Output() closed = new EventEmitter<void>();
  @Output() editRequested = new EventEmitter<JobOffer>();

  close() {
    this.closed.emit();
  }

  get rhTestEnabled(): boolean {
  return !!this.job.testAssignments?.rhTest?.enabled;
}

get techTestEnabled(): boolean {
  return !!this.job.testAssignments?.technicalTest?.enabled;
}

get rhTestDone(): boolean {
  // tests array on the job holds created RH test refs
  return !!(this.job.tests && this.job.tests.length > 0);
}

get techTestDone(): boolean {
  return !!(this.job.technicalTests && this.job.technicalTests.length > 0);
}


get rhAssignedTo(): any[] {
  return this.job.testAssignments?.rhTest?.assignedTo ?? [];
}

get techAssignedTo(): any[] {
  return this.job.testAssignments?.technicalTest?.assignedTo ?? [];
}
}