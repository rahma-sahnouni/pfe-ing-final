import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TechTestsDetailsComponent } from './tech-tests-details.component';

describe('TechTestsDetailsComponent', () => {
  let component: TechTestsDetailsComponent;
  let fixture: ComponentFixture<TechTestsDetailsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TechTestsDetailsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TechTestsDetailsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
