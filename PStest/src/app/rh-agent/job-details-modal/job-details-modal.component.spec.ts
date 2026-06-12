import { ComponentFixture, TestBed } from '@angular/core/testing';

import { JobDetailsModalComponent } from './job-details-modal.component';

describe('JobDetailsModalComponent', () => {
  let component: JobDetailsModalComponent;
  let fixture: ComponentFixture<JobDetailsModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobDetailsModalComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(JobDetailsModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
