import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GlobalDashboardComponent } from './global-dashboard.component';

describe('GlobalDashboardComponent', () => {
  let component: GlobalDashboardComponent;
  let fixture: ComponentFixture<GlobalDashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GlobalDashboardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GlobalDashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
