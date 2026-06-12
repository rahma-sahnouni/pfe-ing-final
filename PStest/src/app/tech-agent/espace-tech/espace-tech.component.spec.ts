import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EspaceTechComponent } from './espace-tech.component';

describe('EspaceTechComponent', () => {
  let component: EspaceTechComponent;
  let fixture: ComponentFixture<EspaceTechComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EspaceTechComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EspaceTechComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
