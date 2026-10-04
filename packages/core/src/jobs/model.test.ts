import { describe, expect, it } from 'vitest';

import { JOB_STATUSES, assertTransition, canTransition, isTerminal } from './model.ts';

describe('job state machine', () => {
  it('allows the happy path', () => {
    const path = [
      'pending',
      'uploading',
      'queued',
      'processing',
      'finalizing',
      'completed',
      'expired',
    ] as const;
    for (let i = 0; i < path.length - 1; i++)
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });

  it('allows retries and cancellation of active jobs', () => {
    expect(canTransition('processing', 'queued')).toBe(true);
    for (const status of ['pending', 'uploading', 'queued', 'processing', 'finalizing'] as const) {
      expect(canTransition(status, 'cancelled')).toBe(true);
      expect(canTransition(status, 'failed')).toBe(true);
    }
  });

  it('never leaves terminal states except to expire', () => {
    for (const status of JOB_STATUSES.filter(isTerminal)) {
      for (const next of JOB_STATUSES) {
        expect(canTransition(status, next)).toBe(next === 'expired' && status !== 'expired');
      }
    }
    expect(() => assertTransition('completed', 'processing')).toThrow('invalid job transition');
  });
});
