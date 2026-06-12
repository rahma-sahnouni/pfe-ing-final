import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CandidateTechTestComponent } from './candidate-tech-test.component';

describe('CandidateTechTestComponent', () => {
  let component: CandidateTechTestComponent;
  let fixture: ComponentFixture<CandidateTechTestComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CandidateTechTestComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CandidateTechTestComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
