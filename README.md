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
before buying. After a purchase, the agent reports it to Sealgraf, which
seals the approval and the agent's report of what it paid into a receipt,
side by side, so neither side can rewrite the record afterwards. If that
report itself fails, the tool says so plainly — the purchase happened but
was not sealed, and there is no receipt for it. Receipts are
tamper-evident, and anyone holding a receipt's check code can open its
public face — no account needed.

## How the sample works

```
agent wants to buy
      │
      ▼
check_permission  ── Sealgraf's hosted MCP (https://sealgraf.com/mcp)
      │
      ├─ allow ──────────────► buy, then report the purchase over REST ──► sealed receipt
      │                         (if the report fails: bought, but not sealed —
      │                          the tool says so, and there is no receipt)
      ├─ needs_human_approval ► owner decides on their own screen;
      │                         token is claimed over REST if approved
      └─ deny ─────────────────► stop. Nothing is bought.
```

Files:

- `src/sealgraf.ts` — the Sealgraf client. The check goes through Mastra's
  `MCPClient` against the hosted MCP server. Claiming an approval's token
  and submitting the completion are REST calls in this sample, on
  purpose: finishing a spend stays an explicit act in the client.
  (Sealgraf's MCP server also offers completion as its
  `report_purchase` tool; this sample deliberately closes spends
  over REST.)
- `src/agents/procurement-agent.ts` — the agent and its paid tool
  (`buyOfficeSupplies`). The purchase itself is a clearly marked stub:
  swap in your real checkout and the permission flow stays the same.
- `src/mastra/index.ts` — the Mastra instance (the CLI's default layout).

## Run it

Requires Node.js 22.13 or newer.

1. Create a Sealgraf account and a permission slip, and issue an
   agent-scope API key for the slip (setup guide:
   https://sealgraf.com/developers/setup).
2. Copy `.env.example` to `.env` and fill in `SEALGRAF_API_KEY` and
   `SEALGRAF_MANDATE_ID` (`SEALGRAF_AGENT_ID` and `MODEL_ID` already
   carry the sample's defaults). The Mastra CLI loads `.env` from the
   project root on every command below — no extra step. (To run
   against a staging deployment or a local test double instead of
   production, set `SEALGRAF_BASE_URL` — see `.env.example`.)
3. Install the pinned dependencies from the lockfile:

   ```
   npm ci
   ```

4. Start the agent in dev mode (the playground opens on
   http://localhost:4111):

   ```
   npm run dev
   ```

   For a production-style run instead: `npm run build`, then
   `npm start`.

5. Ask the agent to buy something, e.g. *"Buy 10 reams of A4 paper from
   Staples for $42.50."*

Watch the outcomes: under the slip's limits it buys and the receipt is
sealed; above the ask-first threshold it waits for the owner; outside
the limits it refuses and buys nothing. And if a purchase ever goes
through but the sealing report fails, the tool returns
`bought_not_sealed` — bought, honestly reported, but with no receipt.

## See a real receipt first

> **Deliberately public demo.** The receipt and check code below are
> shared on purpose: the check code is the bearer key to this one
> receipt's public face, and publishing it is safe because the receipt
> is a demo we want anyone to inspect. Use your own receipts the same
> way — and never publish a check code for a purchase you want kept
> private.

This flow ran for real on November 3, 2026: an agent checked a
purchase against its owner's limits, reported what it paid, and
Sealgraf sealed the receipt. The public face shows it is genuine
and sealed, when it happened, and the kind of purchase — the
details live with the owner.
Open it the way anyone can:

- Go to **https://sealgraf.com/check**
- Type the check code: **a424e427cfcc419c**
- Click **Check this receipt**

That's Receipt № 000030. The approval on it is proven; the purchase is
the agent's report, pinned next to the approval so the two can be
compared. That distinction is the product.
