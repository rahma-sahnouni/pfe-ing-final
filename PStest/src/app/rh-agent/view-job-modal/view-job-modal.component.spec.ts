import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViewJobModalComponent } from './view-job-modal.component';

describe('ViewJobModalComponent', () => {
  let component: ViewJobModalComponent;
  let fixture: ComponentFixture<ViewJobModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ViewJobModalComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ViewJobModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
