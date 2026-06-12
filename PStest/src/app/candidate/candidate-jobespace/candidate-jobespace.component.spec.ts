import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CandidateJOBEspaceComponent } from './candidate-jobespace.component';

describe('CandidateJOBEspaceComponent', () => {
  let component: CandidateJOBEspaceComponent;
  let fixture: ComponentFixture<CandidateJOBEspaceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CandidateJOBEspaceComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CandidateJOBEspaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
