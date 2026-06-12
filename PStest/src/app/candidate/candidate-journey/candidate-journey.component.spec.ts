import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CandidateJourneyComponent } from './candidate-journey.component';

describe('CandidateJourneyComponent', () => {
  let component: CandidateJourneyComponent;
  let fixture: ComponentFixture<CandidateJourneyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CandidateJourneyComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CandidateJourneyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
