import { TestBed } from '@angular/core/testing';

import { InterviewSessionService } from './interview-session.service';

describe('InterviewSessionService', () => {
  let service: InterviewSessionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(InterviewSessionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
