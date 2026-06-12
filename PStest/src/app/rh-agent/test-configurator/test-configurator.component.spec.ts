import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TestConfiguratorComponent } from './test-configurator.component';

describe('TestConfiguratorComponent', () => {
  let component: TestConfiguratorComponent;
  let fixture: ComponentFixture<TestConfiguratorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestConfiguratorComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TestConfiguratorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
