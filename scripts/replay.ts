import { EventLog } from '../src/storage/event-log.js';
import { ReputationEngine } from '../src/reputation/engine.js';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const DB_PATH = process.env['DB_PATH'] ?? './data/reputation.db';

function replay(): void {
  const eventLog = new EventLog(DB_PATH);
  const engine = new ReputationEngine();

  console.log('Replaying all events from event log...\n');

  let totalEvents = 0;
  const agentEvents = new Map<string, number>();

  for (const batch of eventLog.getAllEvents(100)) {
    for (const event of batch) {
      totalEvents++;
      const current = agentEvents.get(event.agentId) ?? 0;
      agentEvents.set(event.agentId, current + 1);
    }
  }

  console.log(`Total events: ${totalEvents}`);
  console.log(`Unique agents: ${agentEvents.size}\n`);

  // Compute reputation for each agent
  for (const [agentId, count] of agentEvents) {
    const events = eventLog.getEventsByAgent(agentId as `0x${string}`);
    const vector = engine.computeVector(events);

    console.log(`Agent: ${agentId}`);
    console.log(`  Events: ${count}`);
    console.log(`  Reliability: ${vector.reliabilityScore.toFixed(4)}`);
    console.log(`  Completion:  ${vector.completionRate.toFixed(4)}`);
    console.log(`  Dispute:     ${vector.disputeRate.toFixed(4)}`);
    console.log(`  SLA:         ${vector.slaAdherence.toFixed(4)}`);
    console.log(`  Volume:      ${vector.volumeWeight.toFixed(4)}`);
    console.log('');
  }

  eventLog.close();
}

replay();
