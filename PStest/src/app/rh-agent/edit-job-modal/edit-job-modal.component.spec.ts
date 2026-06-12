import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditJobModalComponent } from './edit-job-modal.component';

describe('EditJobModalComponent', () => {
  let component: EditJobModalComponent;
  let fixture: ComponentFixture<EditJobModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditJobModalComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EditJobModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
