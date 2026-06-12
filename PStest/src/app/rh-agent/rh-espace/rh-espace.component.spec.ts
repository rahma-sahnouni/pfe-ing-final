import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RhEspaceComponent } from './rh-espace.component';

describe('RhEspaceComponent', () => {
  let component: RhEspaceComponent;
  let fixture: ComponentFixture<RhEspaceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RhEspaceComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RhEspaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
