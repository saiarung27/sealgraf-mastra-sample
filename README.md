# Sealgraf + Mastra — ask before it spends

A minimal Mastra sample: a procurement agent with one paid tool. The tool
asks **Sealgraf** for permission before any money moves, and fails closed —
if Sealgraf does not clearly allow the spend, nothing is bought.

> **Sample / educational — review before using in production.** The
> purchase step is a stub, and Sealgraf's decisions are made server-side;
> this repo contains only the client side. Support is best-effort: the
> Sealgraf API is the supported surface.

Sealgraf is a permission layer for agent spending. The owner sets limits on
a permission slip (per-purchase cap, period cap, categories, an
ask-me-first threshold). The agent checks each purchase against the slip
before buying. Every completed spend is sealed into a receipt that records
the approval and the agent's report of what it paid, side by side, so
neither side can rewrite the record afterwards. Receipts are
tamper-evident, and anyone holding a receipt's check code can open its
public face — no account needed.

## How the sample works

```
agent wants to buy
      │
      ▼
check_permission  ── Sealgraf's hosted MCP (https://sealgraf.com/mcp)
      │
      ├─ allow ──────────────► buy, then submit completion over REST ──► sealed receipt
      ├─ needs_human_approval ► owner decides on their own screen;
      │                         token is claimed over REST if approved
      └─ deny ─────────────────► stop. Nothing is bought.
```

Files:

- `src/sealgraf.ts` — the Sealgraf client. The check goes through Mastra's
  `MCPClient` against the hosted MCP server. Claiming an approval's token
  and submitting completion are REST calls — on purpose, Sealgraf has no
  completion tool in MCP, so finishing a spend is always an explicit act.
- `src/agents/procurement-agent.ts` — the agent and its paid tool
  (`buyOfficeSupplies`). The purchase itself is a clearly marked stub:
  swap in your real checkout and the permission flow stays the same.
- `src/index.ts` — the Mastra instance.

## Run it

1. Create a Sealgraf account and a permission slip, and issue an
   agent-scope API key for the slip (setup guide:
   https://sealgraf.com/developers/setup).
2. Copy `.env.example` to `.env` and fill in `SEALGRAF_API_KEY`,
   `SEALGRAF_MANDATE_ID`, `SEALGRAF_AGENT_ID`, and a `MODEL_ID`.
3. `npm install`, then run with your usual Mastra dev setup and ask the
   agent to buy something, e.g. *"Buy 10 reams of A4 paper from Staples
   for $42.50."*

Watch the three outcomes: under the slip's limits it buys and seals a
receipt; above the ask-first threshold it waits for the owner; outside the
limits it refuses and buys nothing.

## See a real receipt first

This flow ran for real on November 3, 2026: an agent checked a $9.98
purchase, the owner approved it, the agent reported paying $9.72 at
Lowe's (order 300901307262453072), and Sealgraf sealed the receipt.
Open it the way anyone can:

- Go to **https://sealgraf.com/check**
- Type the check code: **a424e427cfcc419c**
- Click **Check this receipt**

That's Receipt № 000030. The approval on it is proven; the purchase is
the agent's report, pinned next to the approval so the two can be
compared. That distinction is the product.
