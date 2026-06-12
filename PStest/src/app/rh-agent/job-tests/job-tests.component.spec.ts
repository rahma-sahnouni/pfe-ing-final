import { ComponentFixture, TestBed } from '@angular/core/testing';

import { JobTestsComponent } from './job-tests.component';

describe('JobTestsComponent', () => {
  let component: JobTestsComponent;
  let fixture: ComponentFixture<JobTestsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobTestsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(JobTestsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
