import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CandidateEspaceComponent } from './candidate-espace.component';

describe('CandidateEspaceComponent', () => {
  let component: CandidateEspaceComponent;
  let fixture: ComponentFixture<CandidateEspaceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CandidateEspaceComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CandidateEspaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
