import { describe, it, expect } from 'vitest';
import {
  decayWeight,
  isWithinActiveWindow,
  computeLambda,
  DEFAULT_DECAY_CONFIG,
} from '../../src/reputation/decay.js';

const MS_PER_DAY = 86_400_000;

describe('decay', () => {
  describe('computeLambda', () => {
    it('returns ln(2) / halfLifeDays', () => {
      const lambda = computeLambda(90);
      expect(lambda).toBeCloseTo(Math.LN2 / 90, 10);
    });
  });

  describe('decayWeight', () => {
    it('returns 1.0 at t=0 (event just happened)', () => {
      const now = new Date('2025-06-01T00:00:00.000Z');
      const eventTimestamp = now.toISOString();
      const weight = decayWeight(eventTimestamp, now);
      expect(weight).toBe(1.0);
    });

    it('returns approximately 0.5 at t=halfLife (90 days)', () => {
      const now = new Date('2025-06-01T00:00:00.000Z');
      const halfLifeMs = DEFAULT_DECAY_CONFIG.halfLifeDays * MS_PER_DAY;
      const eventTime = new Date(now.getTime() - halfLifeMs);
      const weight = decayWeight(eventTime.toISOString(), now);
      expect(weight).toBeCloseTo(0.5, 5);
    });

    it('returns approximately 0.25 at t=2*halfLife', () => {
      const now = new Date('2025-06-01T00:00:00.000Z');
      const twoHalfLifeMs = 2 * DEFAULT_DECAY_CONFIG.halfLifeDays * MS_PER_DAY;
      const eventTime = new Date(now.getTime() - twoHalfLifeMs);
      const weight = decayWeight(eventTime.toISOString(), now);
      expect(weight).toBeCloseTo(0.25, 5);
    });

    it('returns 1.0 for future events (negative deltaT)', () => {
      const now = new Date('2025-06-01T00:00:00.000Z');
      const futureEvent = new Date(now.getTime() + 10 * MS_PER_DAY);
      const weight = decayWeight(futureEvent.toISOString(), now);
      expect(weight).toBe(1.0);
    });

    it('returns value between 0 and 1 for past events', () => {
      const now = new Date('2025-06-01T00:00:00.000Z');
      const pastEvent = new Date(now.getTime() - 30 * MS_PER_DAY);
      const weight = decayWeight(pastEvent.toISOString(), now);
      expect(weight).toBeGreaterThan(0);
      expect(weight).toBeLessThan(1);
    });

    it('respects custom halfLifeDays config', () => {
      const now = new Date('2025-06-01T00:00:00.000Z');
      const customConfig = { halfLifeDays: 30 };
      const eventTime = new Date(now.getTime() - 30 * MS_PER_DAY);
      const weight = decayWeight(eventTime.toISOString(), now, customConfig);
      expect(weight).toBeCloseTo(0.5, 5);
    });
  });

  describe('isWithinActiveWindow', () => {
    it('returns true for recent events', () => {
      const now = new Date('2025-06-01T00:00:00.000Z');
      const recentEvent = new Date(now.getTime() - 10 * MS_PER_DAY);
      const result = isWithinActiveWindow(recentEvent.toISOString(), now);
      expect(result).toBe(true);
    });

    it('returns true for events exactly at 2 * halfLife boundary', () => {
      const now = new Date('2025-06-01T00:00:00.000Z');
      const boundaryEvent = new Date(now.getTime() - 2 * DEFAULT_DECAY_CONFIG.halfLifeDays * MS_PER_DAY);
      const result = isWithinActiveWindow(boundaryEvent.toISOString(), now);
      expect(result).toBe(true);
    });

    it('returns false for events older than 2 * halfLife', () => {
      const now = new Date('2025-06-01T00:00:00.000Z');
      const oldEvent = new Date(now.getTime() - (2 * DEFAULT_DECAY_CONFIG.halfLifeDays + 1) * MS_PER_DAY);
      const result = isWithinActiveWindow(oldEvent.toISOString(), now);
      expect(result).toBe(false);
    });

    it('returns true for future events', () => {
      const now = new Date('2025-06-01T00:00:00.000Z');
      const futureEvent = new Date(now.getTime() + 10 * MS_PER_DAY);
      const result = isWithinActiveWindow(futureEvent.toISOString(), now);
      expect(result).toBe(true);
    });
  });
});
