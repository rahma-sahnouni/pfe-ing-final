import { ComponentFixture, TestBed } from '@angular/core/testing';

import { JobsRHComponent } from './jobs-rh.component';

describe('JobsRHComponent', () => {
  let component: JobsRHComponent;
  let fixture: ComponentFixture<JobsRHComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobsRHComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(JobsRHComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
