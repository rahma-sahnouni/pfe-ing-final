import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TechJobComponent } from './tech-job.component';

describe('TechJobComponent', () => {
  let component: TechJobComponent;
  let fixture: ComponentFixture<TechJobComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TechJobComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TechJobComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
