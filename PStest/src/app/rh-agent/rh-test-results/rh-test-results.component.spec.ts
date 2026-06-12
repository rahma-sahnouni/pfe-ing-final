import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RhTestResultsComponent } from './rh-test-results.component';

describe('RhTestResultsComponent', () => {
  let component: RhTestResultsComponent;
  let fixture: ComponentFixture<RhTestResultsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RhTestResultsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RhTestResultsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
