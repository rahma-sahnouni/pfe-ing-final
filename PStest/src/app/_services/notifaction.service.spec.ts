import { TestBed } from '@angular/core/testing';

import { NotifactionService } from './notifaction.service';

describe('NotifactionService', () => {
  let service: NotifactionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotifactionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
