import { TestBed } from '@angular/core/testing';

import { TestRHService } from './test-rh.service';

describe('TestRHService', () => {
  let service: TestRHService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TestRHService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
