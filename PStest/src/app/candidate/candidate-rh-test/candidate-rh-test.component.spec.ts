import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CandidateRhTestComponent } from './candidate-rh-test.component';

describe('CandidateRhTestComponent', () => {
  let component: CandidateRhTestComponent;
  let fixture: ComponentFixture<CandidateRhTestComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CandidateRhTestComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CandidateRhTestComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
