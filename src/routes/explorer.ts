import { Router } from 'express';
import { ReputationEngine } from '../reputation/engine.js';
import { EventLog } from '../storage/event-log.js';
import { ReputationCache } from '../storage/cache.js';
import { getOrComputeVector, validateAddress } from './reputation.js';
import type { EvmAddress, ReputationEvent } from '../types/index.js';

// ponytail: volumeWeight is log(1+decayedCount), unbounded — 5 is a
// display-only cap for the bar chart, not a real ceiling on the metric.
const VOLUME_WEIGHT_BAR_MAX = 5;
const RECENT_AGENTS_LIMIT = 25;
const RECENT_EVENTS_LIMIT = 50;

export function createExplorerRouter(
  eventLog: EventLog,
  cache: ReputationCache,
  engine: ReputationEngine,
): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const address = req.query['address'];
    if (typeof address === 'string' && address.length > 0) {
      res.redirect(302, `/explorer/${encodeURIComponent(address)}`);
      return;
    }

    const rows = eventLog.getDatabase().prepare(
      `SELECT agent_id, COUNT(*) as count, MAX(timestamp) as last_ts
       FROM events GROUP BY agent_id ORDER BY last_ts DESC LIMIT ?`
    ).all(RECENT_AGENTS_LIMIT) as Array<{ agent_id: string; count: number; last_ts: string }>;

    res.type('html').send(renderSearchPage(rows));
  });

  router.get('/:agentId', (req, res) => {
    const agentId = validateAddress(req.params['agentId']);
    if (!agentId) {
      res.status(400).type('html').send(renderMessagePage('Invalid address', 'That is not a valid EVM address.'));
      return;
    }

    const agent = eventLog.getAgent(agentId);
    if (!agent) {
      res.status(404).type('html').send(renderMessagePage('Agent not found', `No reputation events found for ${escapeHtml(agentId)}.`));
      return;
    }

    const vector = getOrComputeVector(agentId, eventLog, cache, engine);
    const summary = engine.computeSummary(agentId, vector);
    const events = eventLog.getEventsByAgent(agentId).slice(-RECENT_EVENTS_LIMIT).reverse();

    res.type('html').send(renderAgentPage(agentId, summary, events));
  });

  return router;
}

// ─── Rendering ───

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

const PAGE_STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #f7f7f8; color: #1a1a1a; margin: 0; padding: 1.5rem; line-height: 1.5; }
  main { max-width: 800px; margin: 0 auto; }
  h1 { font-size: 1.4rem; }
  a { color: #2454ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  input[type=text] { font-size: 1rem; padding: 0.5rem; width: 100%; max-width: 420px; box-sizing: border-box;
    border: 1px solid #ccc; border-radius: 6px; }
  button { font-size: 1rem; padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid #2454ff;
    background: #2454ff; color: #fff; cursor: pointer; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #e0e0e0; word-break: break-word; }
  ul { list-style: none; padding: 0; }
  li { padding: 0.4rem 0; border-bottom: 1px solid #e8e8e8; }
  .bar-row { margin: 0.6rem 0; }
  .bar-label { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 0.2rem; }
  .bar-track { background: #e5e5e5; border-radius: 4px; height: 10px; overflow: hidden; }
  .bar-fill { background: #2454ff; height: 100%; }
  .composite { font-size: 2.5rem; font-weight: 700; }
  .meta { color: #555; font-size: 0.9rem; }
  .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; }
`;

function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>${body}</main>
</body>
</html>`;
}

function renderMessagePage(title: string, message: string): string {
  return renderPage(title, `
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <p><a href="/explorer">Back to explorer</a></p>
  `);
}

function renderSearchPage(rows: Array<{ agent_id: string; count: number; last_ts: string }>): string {
  const list = rows.length === 0
    ? '<p class="meta">No agent activity yet.</p>'
    : `<ul>${rows.map((r) => `
      <li>
        <a href="/explorer/${escapeHtml(r.agent_id)}">${escapeHtml(r.agent_id)}</a>
        <span class="meta"> — ${escapeHtml(r.count)} event${r.count === 1 ? '' : 's'}, last ${escapeHtml(r.last_ts)}</span>
      </li>`).join('')}</ul>`;

  return renderPage('Agent Reputation Explorer', `
    <h1>Agent Reputation Explorer</h1>
    <form method="GET" action="/explorer">
      <input type="text" name="address" placeholder="0x... agent address" required>
      <button type="submit">Look up</button>
    </form>
    <h2>Recently active agents</h2>
    ${list}
  `);
}

function bar(label: string, value: number, max: number): string {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `
    <div class="bar-row">
      <div class="bar-label"><span>${escapeHtml(label)}</span><span>${value.toFixed(3)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
    </div>`;
}

function summarizeEventData(event: ReputationEvent): string {
  const data = event.data;
  switch (data.type) {
    case 'transaction_completed':
      return `${data.completedSuccessfully ? 'Completed' : 'Failed'} — $${data.valueUsd} in ${data.durationMs}ms`;
    case 'sla_verified':
      return `${data.metSla ? 'Met' : 'Missed'} SLA (${data.slaType}): ${data.measuredValue} vs ${data.threshold}`;
    case 'arbitration_result':
      return `Arbitration outcome: ${data.outcome} ($${data.valueUsd})`;
    case 'slash':
      return `Slash (${data.severity}): ${data.reason}`;
    case 'attestation':
      return `Attestation (${data.category}, confidence ${data.confidence})${data.comment ? `: ${data.comment}` : ''}`;
    default:
      return '';
  }
}

function renderAgentPage(
  agentId: EvmAddress,
  summary: { reliabilityScore: number; completionRate: number; disputeRate: number; slaAdherence: number; volumeWeight: number; totalEvents: number; isActive: boolean; confidence: number; lastEventTimestamp: string; compositeScore: number },
  events: ReputationEvent[],
): string {
  const rows = events.map((e) => `
    <tr>
      <td>${escapeHtml(e.eventType)}</td>
      <td>${escapeHtml(e.sourceAgentId)}</td>
      <td>${escapeHtml(e.timestamp)}</td>
      <td>${escapeHtml(summarizeEventData(e))}</td>
    </tr>`).join('');

  return renderPage(`Agent ${agentId}`, `
    <p><a href="/explorer">&larr; Back to explorer</a></p>
    <h1>${escapeHtml(agentId)}</h1>
    <div class="card">
      <div class="composite">${escapeHtml(String(summary.compositeScore))} / 100</div>
      ${bar('Reliability', summary.reliabilityScore, 1)}
      ${bar('Completion rate', summary.completionRate, 1)}
      ${bar('Dispute rate', summary.disputeRate, 1)}
      ${bar('SLA adherence', summary.slaAdherence, 1)}
      ${bar('Volume weight', summary.volumeWeight, VOLUME_WEIGHT_BAR_MAX)}
      <p class="meta">
        Confidence: ${escapeHtml(summary.confidence.toFixed(3))} &middot;
        ${summary.isActive ? 'Active' : 'Inactive'} &middot;
        ${escapeHtml(summary.totalEvents)} total events &middot;
        last event ${escapeHtml(summary.lastEventTimestamp || 'never')}
      </p>
    </div>
    <h2>Recent events</h2>
    <table>
      <thead><tr><th>Type</th><th>Source agent</th><th>Timestamp</th><th>Summary</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No events.</td></tr>'}</tbody>
    </table>
  `);
}
