# Outreach: 3-Day Demand Test

Goal: find out if anyone running agents or an agent marketplace actually has a
"bad agent" problem today, before building more of the oracle. This is a
demand test, not a sales push. Three days, one question, no pitch.

Rule: only reach out from the channels below. Do not cold-email anyone whose
address isn't publicly listed. Do not DM. Post in public channels
(GitHub issue/discussion, Discord, reply to their own X post) so the ask
looks like what it is: one builder asking a question in public.

## Targets

Evidence for every row below was checked directly (repo page, X profile, or
site) on 2026-09-01. No handle here is guessed.

| # | Target | What they run | Why a bad agent hurts them | Best public channel | Evidence |
|---|--------|----------------|------------------------------|----------------------|----------|
| 1 | x402 Foundation | Governs the x402 HTTP payment protocol standard (Coinbase + Cloudflare + Linux Foundation) | A bad agent that exploits the payment flow (malformed 402 responses, fraudulent claims) damages trust in the standard itself, not just one app | GitHub Issues on the foundation repo | [github.com/x402-foundation/x402](https://github.com/x402-foundation/x402) (6.6k stars, Issues enabled, no Discussions tab) |
| 2 | Coinbase AgentKit | Wallet + onchain toolkit that agent developers plug into their agents | A bad agent built with AgentKit that scams or drains a wallet lands back on Coinbase's support queue and reputation | GitHub Issues on the repo, or CDP Discord | [github.com/coinbase/agentkit](https://github.com/coinbase/agentkit) (Issues enabled, no Discussions tab); Discord referenced in [CONTRIBUTING.md](https://github.com/coinbase/agentkit/blob/main/CONTRIBUTING.md) |
| 3 | x402 Bazaar | Coinbase's discovery index of 100+ paid x402 APIs agents call automatically | An agent calling a malicious or broken listed service loses real USDC with no recourse, the opposite of "search engine for agents" | X reply to @CoinbaseDev's Bazaar launch thread | [x.com/CoinbaseDev/status/1965445897489428869](https://x.com/CoinbaseDev/status/1965445897489428869) |
| 4 | x402scan | Ecosystem explorer/analytics for x402 payment traffic, built by Merit Systems | Bad actors spoofing or wash-trading payments corrupt the exact data the explorer reports as ecosystem activity | X @x402scan | [x.com/x402scan](https://x.com/x402scan), [github.com/Merit-Systems/x402scan](https://github.com/Merit-Systems/x402scan) |
| 5 | PayAI Network | x402 payment facilitator settling agent-to-agent payments on Solana + EVM | A facilitator that lets a bad agent's payment through, or gets used for wash volume, damages its pitch as a neutral, trustworthy rail | X @PayAINetwork | [x.com/PayAINetwork](https://x.com/PayAINetwork), [github.com/PayAINetwork](https://github.com/PayAINetwork) |
| 6 | 8004scan (AltLayer) | Explorer indexing 20k+ ERC-8004 agents, including onchain reputation/feedback | Their product's entire value is presenting reputation and feedback data; Sybil or garbage feedback pollutes exactly that | X @8004_scan | [x.com/yq_acc/status/2003501564691120232](https://x.com/yq_acc/status/2003501564691120232) (AltLayer team confirming the @8004_scan account), [8004scan.io](https://8004scan.io) |
| 7 | RNWY (AI Rights Institute) | Sells "trust intelligence and reputation scoring" for ERC-8004 agents | Reputation scoring is the whole product; unreliable underlying signal is an existential problem for them, not a side issue | X @RNWY_official, or GitHub | [x.com/RNWY_official](https://x.com/RNWY_official), [github.com/rnwy](https://github.com/rnwy), [rnwy.com/explorer](https://rnwy.com/explorer) |
| 8 | Veylux | Early reference implementation of a Sybil-resistant trust protocol for agents (staking, cluster analysis, decayed reputation) | Working the same problem from a different angle; likely has a direct opinion on what actually works and what doesn't | GitHub Issues | [github.com/kenjimoto999/veylux](https://github.com/kenjimoto999/veylux) (small early-stage repo, 1 star, Issues enabled, no other contact listed) |
| 9 | Agent Arena (Vistara Labs) | On-chain registry and search layer for ERC-8004 agents | Same reputation-pollution problem as any agent explorer: bad agents in the registry make the search layer less useful | X @vistaralabs | [x.com/vistaralabs](https://x.com/vistaralabs), [github.com/vistara-apps/agent-arena-v1](https://github.com/vistara-apps/agent-arena-v1) |
| 10 | ChaosChain | Accountability layer pitched as letting businesses "trust agents with real money" | A single bad agent slipping through breaks their core sales pitch directly | GitHub Issues or Discussions | [github.com/ChaosChain/trustless-agents-erc-ri](https://github.com/ChaosChain/trustless-agents-erc-ri) (54 stars, 10 open issues, README links to GitHub Discussions) |
| 11 | Virtuals Protocol | Agent Commerce Protocol (ACP): agents hire each other for on-chain USDC-escrowed jobs | A bad agent that takes escrowed payment and doesn't deliver breaks trust in the escrow/hiring flow for the whole marketplace | Discord, or X @virtuals_io | [discord.com/invite/virtualsio](https://discord.com/invite/virtualsio) (12.7k members), [x.com/virtuals_io](https://x.com/virtuals_io) |
| 12 | Olas (Autonolas) | Decentralized marketplace where agents offer skills and hire other agents | Paying to hire an unreliable agent with no recourse is the direct failure mode of a peer-to-peer agent marketplace | Discord | [discord.com/invite/BQzYqhjGjQ](https://discord.com/invite/BQzYqhjGjQ) (5.9k members), [github.com/valory-xyz/autonolas-marketplace](https://github.com/valory-xyz/autonolas-marketplace) |
| 13 | Fetch.ai (Agentverse) | Marketplace to browse, discover, and chat with agents | A bad agent surfaced in the marketplace directly damages user trust in the discovery product | X @Fetch_ai | [twitter.com/fetch_ai](https://twitter.com/fetch_ai), [agentverse.ai/marketplace](https://agentverse.ai/marketplace) |
| 14 | Skyfire | Identity and payment rails for autonomous agent transactions ("Know Your Agent") | If an agent Skyfire verified turns out to be a bad actor, it undermines the identity guarantee the whole product is built on | X @trySkyfire | [x.com/trySkyfire](https://x.com/trySkyfire), [skyfire.xyz](https://skyfire.xyz/) |
| 15 | Nevermined | Payments infrastructure for AI agents (72,500+ buyers, 1.38M transactions since May 2025) | Disputes and chargebacks caused by bad agents are a direct, measurable operational cost at that transaction volume | X @Nevermined_io, or Discord | [twitter.com/nevermined_io](https://twitter.com/nevermined_io), [github.com/nevermined-io](https://github.com/nevermined-io), Discord [discord.gg/GZju2qScKq](https://discord.gg/GZju2qScKq) |
| 16 | Smithery | Registry and hosting for 6,000+ MCP servers | A malicious or broken listed server damages trust in the whole registry, since users install directly from it | X @SmitheryDotAI | [twitter.com/SmitheryDotAI](https://twitter.com/SmitheryDotAI), [github.com/smithery-ai](https://github.com/smithery-ai) |
| 17 | Glama | Auto-indexes ~37,000 open-source MCP servers from GitHub | Same problem as Smithery, at larger scale: bad servers in the index directly hurt users who install from it | X @glamaai | [x.com/glamaai](https://x.com/glamaai), [github.com/punkpeye](https://github.com/punkpeye) |
| 18 | PulseMCP | MCP ecosystem newsletter and directory run by MCP Steering Committee members | Recommending a bad or malicious MCP server in the weekly digest burns the credibility their whole newsletter depends on | X @pulsemcp | [x.com/pulsemcp](https://x.com/pulsemcp), [github.com/pulsemcp](https://github.com/pulsemcp) |
| 19 | Official MCP Registry | Canonical namespace registry that MCP clients read server listings from | It's the base layer every MCP client trusts by default; a malicious registered server is a supply-chain risk for all of them | GitHub Discussions | [github.com/modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry) (Discussions tab enabled) |
| 20 | Google A2A Project | Agent2Agent (A2A) protocol for agent-to-agent task delegation, now under the Linux Foundation | Agents delegating work to other agents over A2A have no protocol-native way to know who's reliable before they delegate | GitHub Discussions | [github.com/a2aproject/A2A](https://github.com/a2aproject/A2A) (Discussions and Discord both referenced in the repo) |

## Message Template

Use as a starting point, adjust the bracketed part to name their actual
product, keep it to three sentences, post it as a genuine question:

> Hey, quick question, I'm not selling anything. I'm building a reputation
> oracle for AI agents and trying to figure out if it solves a real problem
> before I build more of it: when an agent on [their platform/registry] turns
> out to be unreliable or a bad actor, how do you handle that today, a
> blocklist, a manual review queue, something else? Genuinely just trying to
> learn what already exists.

## Decision Rubric

- **2 or more replies** that describe an internal blocklist, a manual review
  queue, or some other existing process for handling bad agents: that's real
  demand. Proceed with the oracle as a product, and follow up with those
  specific replies first.
- **0 or 1 reply**, or replies that shrug it off as a non-problem: shelve the
  demand-test thesis. Keep the oracle as a public reference implementation
  (open source, documented, demoable) rather than building a go-to-market
  plan around it.

Anything in between (a couple of vague or lukewarm replies) means wait for
day 3 before deciding rather than calling it early.

## Tracking

| Target | Sent date | Reply | Signal |
|--------|-----------|-------|--------|
| x402 Foundation | 2026-09-01 (https://github.com/x402-foundation/x402/issues/3345) | 2026-09-02: minia2auk (runs a live x402 resource server) confirmed blocklists + manual review are the status quo; pressure-tested portability and key rotation | Replied 2026-09-02 with GET /v1/events and token-keyed ERC-8004 ids (commit e982666). minia2auk 2026-09-02: accepted both fixes; ranked cost signals (ERC-8004 identity as binding layer, settlement history weighted highest, stake as spam floor only); flagged the second attribution hop (agent vs principal). Replied 2026-09-02 (https://github.com/x402-foundation/x402/issues/3345#issuecomment-5511547277): id binds to the token held by the principal, runtime swaps under the same token are now recorded (importer indexes URIUpdated, free GET /v1/agents/:agentId, explorer). minia2auk 2026-09-02 15:40: asked for one derived scalar (events settled under the current agentURI) and an explicit doc statement that the receipt binds principal + declared agentURI over time, not the runtime; runtime swaps without a URI change need TEE or signed model hash attestation, out of scope. Shipped both in 127e6c3 (eventsUnderCurrentUri on /v1/agents and explorer, ceiling paragraph in erc8004.md and README). Follow-up posted 2026-09-02 (https://github.com/x402-foundation/x402/issues/3345#issuecomment-5513191628): eventsUnderCurrentUri shipped with the caveat that URI-rewriting agents read zero, ceiling documented, live URL with ~460k backfilled events |
| Coinbase AgentKit | 2026-09-01 (https://github.com/coinbase/agentkit/issues/1476) | | |
| x402 Bazaar | | | |
| x402scan | | | |
| PayAI Network | | | |
| 8004scan (AltLayer) | | | |
| RNWY | | | |
| Veylux | 2026-09-01 (https://github.com/kenjimoto999/veylux/issues/1) | | |
| Agent Arena (Vistara Labs) | | | |
| ChaosChain | 2026-09-01 (https://github.com/ChaosChain/trustless-agents-erc-ri/issues/20) | | |
| Virtuals Protocol | | | |
| Olas (Autonolas) | | | |
| Fetch.ai (Agentverse) | | | |
| Skyfire | | | |
| Nevermined | | | |
| Smithery | | | |
| Glama | | | |
| PulseMCP | | | |
| Official MCP Registry | 2026-09-01 (https://github.com/modelcontextprotocol/registry/discussions/1603) | | |
| Google A2A Project | 2026-09-01 (https://github.com/a2aproject/A2A/discussions/2201) | | |

## Targets Considered and Dropped

The `awesome-erc8004` community list surfaces 60+ additional named projects
(reputation oracles, escrow protocols, agent passports, and similar). Most
were dropped: single-commit repos with no real activity, generic
copy-pasted descriptions, or no reachable channel beyond a personal GitHub
handle with no history. Including them would pad the count without adding
real signal. Supporting context, not a target: the paper "Can Trustless
Agents Be Trusted? An Empirical Study of the ERC-8004 Decentralized AI Agent
Ecosystem" ([arxiv.org/abs/2606.26028](https://arxiv.org/abs/2606.26028))
measured Sybil-flagged reviewer rates of 59.2% to 90.6% across chains in the
ERC-8004 Reputation Registry, worth citing if anyone asks why this matters.

## Ready to Paste (X and Discord)

Posted from GitHub on 2026-09-01: the six rows above. The rest need a logged-in
X or Discord session. Each block below is the exact text, tailored per target.
Reply on their own post or in their general channel, one per day at most for
X so it does not read as spam.

Live instance since 2026-09-02: https://oracle-production-ab61.up.railway.app (Base
mainnet, ERC-8004 backfilled from the registry deployment block, ~460k events, polling every minute). Only mention it if someone
asks what exists; the question posts stay pitch-free.

**@CoinbaseDev (reply to the Bazaar launch thread, x.com/CoinbaseDev/status/1965445897489428869)**
> Quick question, not selling anything. When a service listed in the Bazaar turns out to be broken or malicious and an agent loses USDC calling it, how is that handled today? Blocklist, manual review, nothing yet? Building an open source agent reputation oracle and trying to learn what already exists.

**@x402scan**
> Quick question, not selling anything. When you see spoofed or wash-traded x402 payments in the explorer data, how do you handle it today? Filter list, manual review, or does it just show up as activity? Building an open source reputation oracle for agents and trying to learn what already exists.

**@PayAINetwork**
> Quick question, not selling anything. When an agent paying through PayAI turns out to be a bad actor or wash-trading volume, how do you handle that today? Blocklist, manual review, something else? Building an open source agent reputation oracle and trying to learn what already exists.

**@8004_scan**
> Quick question, not selling anything. With Sybil feedback rates in the ERC-8004 reputation registry measured at 59 to 91 percent, how does 8004scan handle garbage feedback today? Filter, weighting, show it raw? Building an open source attester-weighted scorer on top of the registry and trying to learn what already exists.

**@RNWY_official**
> Quick question, not selling anything. When the underlying ERC-8004 feedback for an agent is Sybil-polluted, how does RNWY handle that in its trust score today? Building an open source attester-weighted scorer and genuinely curious what approach you landed on.

**@vistaralabs (Agent Arena)**
> Quick question, not selling anything. When an agent in the Agent Arena registry turns out to be unreliable or a bad actor, how do you handle that today? Blocklist, review queue, nothing yet? Building an open source agent reputation oracle and trying to learn what already exists.

**Virtuals Discord (general or ACP channel) / @virtuals_io**
> Hey, quick question, not selling anything. When an agent hired through ACP takes the escrowed job and does not deliver, how is that handled today? Blocklist, manual review, dispute flow? Building an open source agent reputation oracle and trying to learn what already exists.

**Olas Discord (general)**
> Hey, quick question, not selling anything. When an agent hired through the Olas marketplace turns out to be unreliable, how is that handled today? Blocklist, review queue, something else? Building an open source agent reputation oracle and trying to learn what already exists.

**@Fetch_ai**
> Quick question, not selling anything. When an agent surfaced in the Agentverse marketplace turns out to be a bad actor, how is that handled today? Blocklist, manual review, reports? Building an open source agent reputation oracle and trying to learn what already exists.

**@trySkyfire**
> Quick question, not selling anything. When a KYA-verified agent later turns out to be a bad actor, how does Skyfire handle that today? Revocation, review queue, something else? Building an open source agent reputation oracle and trying to learn what already exists.

**@Nevermined_io / Nevermined Discord**
> Quick question, not selling anything. At 1M+ agent transactions, how do you handle disputes caused by unreliable agents today? Blocklist, manual review, chargeback flow? Building an open source agent reputation oracle and trying to learn what already exists.

**@SmitheryDotAI**
> Quick question, not selling anything. When a listed MCP server turns out to be broken or malicious, how does Smithery handle it today? Delist, manual review, reports? Building an open source reputation layer for agents and servers and trying to learn what already exists.

**@glamaai**
> Quick question, not selling anything. With 37k auto-indexed MCP servers, how do you handle a malicious or broken one today? Delist, flag, manual review? Building an open source reputation layer for agents and servers and trying to learn what already exists.

**@pulsemcp**
> Quick question, not selling anything. Before you feature an MCP server in the digest, how do you check it is not broken or malicious, and what happens if one turns out bad later? Building an open source reputation layer for agents and servers and trying to learn what already exists.
