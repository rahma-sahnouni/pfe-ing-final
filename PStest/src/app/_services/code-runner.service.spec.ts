import { TestBed } from '@angular/core/testing';

import { CodeRunnerService } from './code-runner.service';

describe('CodeRunnerService', () => {
  let service: CodeRunnerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CodeRunnerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
