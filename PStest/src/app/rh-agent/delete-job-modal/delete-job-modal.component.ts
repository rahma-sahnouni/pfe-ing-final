import { Component, Input, Output, EventEmitter } from '@angular/core';
import { JobOffer, JobOfferService } from '../../_services/job-offer.service';

@Component({
  selector: 'app-delete-job-modal',
  templateUrl: './delete-job-modal.component.html',
  styleUrls: ['./delete-job-modal.component.css']
})
export class DeleteJobModalComponent {
  @Input() job!: JobOffer;
  @Output() closed = new EventEmitter<void>();
  @Output() jobDeleted = new EventEmitter<string>(); // emits the deleted job _id

  deleting = false;
  errorMsg = '';

  constructor(private jobService: JobOfferService) {}

  confirm() {
    this.deleting = true;
    this.errorMsg = '';

    this.jobService.deleteJob(this.job._id!).subscribe({
      next: () => {
        this.deleting = false;
        this.jobDeleted.emit(this.job._id!);
      },
      error: (err) => {
        this.deleting = false;
        this.errorMsg = err.message || 'Failed to delete job.';
      }
    });
  }

  close() {
    this.closed.emit();
  }
}