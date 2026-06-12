import { TestBed } from '@angular/core/testing';

import { AntiCheatService } from './anti-cheat.service';

describe('AntiCheatService', () => {
  let service: AntiCheatService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AntiCheatService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
