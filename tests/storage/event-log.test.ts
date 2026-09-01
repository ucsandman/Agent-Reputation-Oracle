import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventLog } from '../../src/storage/event-log.js';
import type { ReputationEvent, EvmAddress } from '../../src/types/index.js';
import { v4 as uuidv4 } from 'uuid';

const AGENT_ID: EvmAddress = '0x1111111111111111111111111111111111111111';
const SOURCE_AGENT_ID: EvmAddress = '0x2222222222222222222222222222222222222222';

function makeEvent(overrides?: Partial<ReputationEvent>): ReputationEvent {
  return {
    id: uuidv4(),
    agentId: AGENT_ID,
    eventType: 'transaction_completed',
    timestamp: new Date().toISOString(),
    data: {
      type: 'transaction_completed',
      completedSuccessfully: true,
      valueUsd: 100,
      durationMs: 5000,
    },
    proof: {
      signature: '0xdead' as `0x${string}`,
      signer: SOURCE_AGENT_ID,
      domain: 'AgentReputationOracle',
      typedDataHash: '0xbeef' as `0x${string}`,
    },
    sourceAgentId: SOURCE_AGENT_ID,
    ...overrides,
  };
}

describe('EventLog', () => {
  let eventLog: EventLog;

  beforeEach(() => {
    eventLog = new EventLog(':memory:');
  });

  afterEach(() => {
    eventLog.close();
  });

  describe('appendEvent and read back', () => {
    it('appends an event and reads it back by ID', () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);

      const event = makeEvent();
      const inserted = eventLog.appendEvent(event);
      expect(inserted).toBe(true);

      const retrieved = eventLog.getEventById(event.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(event.id);
      expect(retrieved!.agentId).toBe(event.agentId);
      expect(retrieved!.eventType).toBe(event.eventType);
      expect(retrieved!.data).toEqual(event.data);
      expect(retrieved!.sourceAgentId).toBe(event.sourceAgentId);
    });
  });

  describe('idempotency', () => {
    it('duplicate event ID is silently ignored', () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);

      const event = makeEvent();
      const first = eventLog.appendEvent(event);
      const second = eventLog.appendEvent(event);

      expect(first).toBe(true);
      expect(second).toBe(false);

      // Only one event should exist
      const events = eventLog.getEventsByAgent(AGENT_ID);
      expect(events.length).toBe(1);
    });
  });

  describe('getEventsByAgent', () => {
    it('returns events for the specified agent', () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);

      const event1 = makeEvent({ timestamp: '2025-01-01T00:00:00.000Z' });
      const event2 = makeEvent({ timestamp: '2025-01-02T00:00:00.000Z' });
      eventLog.appendEvent(event1);
      eventLog.appendEvent(event2);

      const events = eventLog.getEventsByAgent(AGENT_ID);
      expect(events.length).toBe(2);
    });

    it('filters by eventType', () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);

      const txEvent = makeEvent({
        eventType: 'transaction_completed',
        data: {
          type: 'transaction_completed',
          completedSuccessfully: true,
          valueUsd: 100,
          durationMs: 5000,
        },
      });
      const slaEvent = makeEvent({
        eventType: 'sla_verified',
        data: {
          type: 'sla_verified',
          metSla: true,
          slaType: 'latency',
          measuredValue: 100,
          threshold: 200,
        },
      });

      eventLog.appendEvent(txEvent);
      eventLog.appendEvent(slaEvent);

      const txEvents = eventLog.getEventsByAgent(AGENT_ID, { eventType: 'transaction_completed' });
      expect(txEvents.length).toBe(1);
      expect(txEvents[0]!.eventType).toBe('transaction_completed');
    });

    it('filters by since/until timestamps', () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);

      const event1 = makeEvent({ timestamp: '2025-01-01T00:00:00.000Z' });
      const event2 = makeEvent({ timestamp: '2025-06-01T00:00:00.000Z' });
      const event3 = makeEvent({ timestamp: '2025-12-01T00:00:00.000Z' });

      eventLog.appendEvent(event1);
      eventLog.appendEvent(event2);
      eventLog.appendEvent(event3);

      const filtered = eventLog.getEventsByAgent(AGENT_ID, {
        since: '2025-03-01T00:00:00.000Z',
        until: '2025-09-01T00:00:00.000Z',
      });
      expect(filtered.length).toBe(1);
      expect(filtered[0]!.id).toBe(event2.id);
    });

    it('supports limit and offset', () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);

      for (let i = 0; i < 5; i++) {
        eventLog.appendEvent(makeEvent({ timestamp: `2025-01-0${i + 1}T00:00:00.000Z` }));
      }

      const page1 = eventLog.getEventsByAgent(AGENT_ID, { limit: 2, offset: 0 });
      expect(page1.length).toBe(2);

      const page2 = eventLog.getEventsByAgent(AGENT_ID, { limit: 2, offset: 2 });
      expect(page2.length).toBe(2);

      const page3 = eventLog.getEventsByAgent(AGENT_ID, { limit: 2, offset: 4 });
      expect(page3.length).toBe(1);
    });
  });

  describe('ensureAgent', () => {
    it('creates an agent record', () => {
      eventLog.ensureAgent(AGENT_ID);

      const agent = eventLog.getAgent(AGENT_ID);
      expect(agent).not.toBeNull();
      expect(agent!.id).toBe(AGENT_ID);
      expect(agent!.previousAddresses).toEqual([]);
      expect(agent!.metadata).toEqual({});
    });

    it('is idempotent - calling twice does not throw', () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(AGENT_ID);

      const agent = eventLog.getAgent(AGENT_ID);
      expect(agent).not.toBeNull();
    });
  });

  describe('countEventsByAgentSince', () => {
    it('counts events since a given timestamp', () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);

      // Append events - the created_at is set by SQLite's datetime('now')
      const event1 = makeEvent({ timestamp: '2025-01-01T00:00:00.000Z' });
      const event2 = makeEvent({ timestamp: '2025-06-01T00:00:00.000Z' });
      eventLog.appendEvent(event1);
      eventLog.appendEvent(event2);

      // Count since a time far in the past should return all events
      const count = eventLog.countEventsByAgentSince(AGENT_ID, '2000-01-01T00:00:00.000Z');
      expect(count).toBe(2);
    });

    it('returns 0 when no events match', () => {
      eventLog.ensureAgent(AGENT_ID);

      const count = eventLog.countEventsByAgentSince(AGENT_ID, '2099-01-01T00:00:00.000Z');
      expect(count).toBe(0);
    });
  });

  describe('getAttesterDistribution', () => {
    it('returns correct counts per source agent', () => {
      const sourceB: EvmAddress = '0x3333333333333333333333333333333333333333';

      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);
      eventLog.ensureAgent(sourceB);

      eventLog.appendEvent(makeEvent({ sourceAgentId: SOURCE_AGENT_ID }));
      eventLog.appendEvent(makeEvent({ sourceAgentId: SOURCE_AGENT_ID }));
      eventLog.appendEvent(makeEvent({ sourceAgentId: sourceB }));

      const distribution = eventLog.getAttesterDistribution(AGENT_ID);

      expect(distribution.get(SOURCE_AGENT_ID)).toBe(2);
      expect(distribution.get(sourceB)).toBe(1);
      expect(distribution.size).toBe(2);
    });

    it('returns empty map for unknown agent', () => {
      const distribution = eventLog.getAttesterDistribution('0x9999999999999999999999999999999999999999' as EvmAddress);
      expect(distribution.size).toBe(0);
    });
  });
});

describe('countEventsByAgentSince', () => {
  let log: EventLog;
  beforeEach(() => { log = new EventLog(':memory:'); log.ensureAgent(AGENT_ID); log.ensureAgent(SOURCE_AGENT_ID); });
  afterEach(() => log.close());

  it('counts events appended in the last hour when given an ISO timestamp', () => {
    log.appendEvent(makeEvent());
    log.appendEvent(makeEvent());
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    expect(log.countEventsByAgentSince(AGENT_ID, oneHourAgo)).toBe(2);
  });

  it('returns 0 for a future cutoff', () => {
    log.appendEvent(makeEvent());
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(log.countEventsByAgentSince(AGENT_ID, future)).toBe(0);
  });
});
