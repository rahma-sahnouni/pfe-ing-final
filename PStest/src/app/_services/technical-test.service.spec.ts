import { TestBed } from '@angular/core/testing';

import { TechnicalTestService } from './technical-test.service';

describe('TechnicalTestService', () => {
  let service: TechnicalTestService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TechnicalTestService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
