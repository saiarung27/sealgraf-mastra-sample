/**
 * Sealgraf client for the sample.
 *
 * Two pieces, exactly as the live product works:
 *
 * 1. The check goes over Sealgraf's hosted MCP server
 *    (https://sealgraf.com/mcp), which exposes the `check_permission` tool.
 *    We reach it through Mastra's MCPClient, the way any Mastra app would.
 *
 * 2. Sealing the spend is deliberately NOT an MCP tool. If the owner has to
 *    approve first, the decision token is claimed over REST
 *    (POST /v1/preauthorize/{id}/decision-token), and the completion
 *    evidence is submitted over REST (POST /v1/preauthorize/{id}/complete).
 *    Both calls use the same agent-scope API key.
 */

import { MCPClient } from "@mastra/mcp";

// Sealgraf's production host. SEALGRAF_BASE_URL overrides it (for a
// staging deployment or a local test double); the MCP endpoint is
// always the base URL's /mcp.
const SEALGRAF_BASE_URL = (
  process.env.SEALGRAF_BASE_URL ?? "https://sealgraf.com"
).replace(/\/+$/, "");
const SEALGRAF_MCP_URL = `${SEALGRAF_BASE_URL}/mcp`;

export interface CheckPermissionArgs {
  mandateId: string;
  agentId: string;
  category: string;
  /** Amount in the currency's minor unit (cents): $42.50 -> 4250. */
  amountMinor: number;
  currency: string;
  counterparty?: string;
  description?: string;
  idempotencyKey?: string;
}

/** What `check_permission` answers. Decision outcomes are the product's own words. */
export interface CheckPermissionResult {
  preauth_id: string;
  decision: {
    outcome: "allow" | "deny" | "needs_human_approval";
    reason_code: string;
    mandate_id: string;
    mandate_version: number;
  };
  state: string;
  /** Present only when the outcome is "allow". Single-use, bound to this exact action. */
  decision_token?: string;
  token_expires_at?: string | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  }
  return value;
}

let sealgrafToolPromise: Promise<any> | undefined;

/**
 * Fetch Sealgraf's `check_permission` tool from the hosted MCP server,
 * connected with this agent's API key. The key is agent-scope: it can ask
 * and read receipts, and it can never create or change the owner's limits.
 */
async function sealgrafCheckPermissionTool(): Promise<any> {
  if (!sealgrafToolPromise) {
    const mcp = new MCPClient({
      servers: {
        sealgraf: {
          url: new URL(SEALGRAF_MCP_URL),
          requestInit: {
            headers: { "X-API-Key": requireEnv("SEALGRAF_API_KEY") },
          },
        },
      },
    });
    sealgrafToolPromise = (async () => {
      const tools = await mcp.listTools();
      const tool =
        tools["sealgraf_check_permission"] ?? tools["check_permission"];
      if (!tool) {
        throw new Error(
          "Sealgraf MCP server did not expose a check_permission tool",
        );
      }
      return tool;
    })();
    // Never cache a failure: if the connection or tool fetch rejects,
    // forget the promise so the next check retries instead of failing
    // with the same stale error for the life of the process.
    sealgrafToolPromise.catch(() => {
      sealgrafToolPromise = undefined;
    });
  }
  return sealgrafToolPromise;
}

/** Ask Sealgraf whether this exact spend is permitted. Call BEFORE buying. */
export async function checkPermission(
  args: CheckPermissionArgs,
): Promise<CheckPermissionResult> {
  const tool = await sealgrafCheckPermissionTool();
  // @mastra/mcp 2.8: tools returned by listTools() take their arguments
  // verbatim as the first execute() argument — the client passes that
  // object straight through as the MCP call's `arguments` (dist/index.js:
  // execute: async (input, context) => ... callTool({ arguments: input })).
  // There is no `{ context: ... }` wrapper.
  const raw = await tool.execute({
    mandate_id: args.mandateId,
    agent_id: args.agentId,
    category: args.category,
    amount_minor: args.amountMinor,
    currency: args.currency,
    ...(args.counterparty ? { counterparty: args.counterparty } : {}),
    ...(args.description ? { description: args.description } : {}),
    ...(args.idempotencyKey ? { idempotency_key: args.idempotencyKey } : {}),
  });
  // MCP tool results may come back as structured content or as a text block.
  const parsed =
    typeof raw === "string" ? JSON.parse(raw) : (raw?.structuredContent ?? raw);
  if (!parsed?.decision?.outcome) {
    throw new Error(
      `Unexpected check_permission response: ${JSON.stringify(raw)}`,
    );
  }
  return parsed as CheckPermissionResult;
}

async function sealgrafRest(
  path: string,
  body: Record<string, unknown>,
): Promise<any> {
  const response = await fetch(`${SEALGRAF_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "X-API-Key": requireEnv("SEALGRAF_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Sealgraf REST ${path} failed (${response.status}): ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * After the owner approves an ask, claim the decision token over REST.
 * Only the key that ran the original check can claim it.
 */
export async function claimDecisionToken(
  preauthId: string,
): Promise<{ decision_token: string; token_expires_at: string }> {
  return sealgrafRest(`/v1/preauthorize/${preauthId}/decision-token`, {});
}

export interface CompletionEvidence {
  /** The merchant's own order/reference id for the purchase. */
  counterpartyReceiptRef: string;
  note: string;
  /** Optional: what was actually charged, in minor units. Defaults to the authorized amount. */
  completedAmountMinor?: number;
}

/**
 * Submit completion evidence over REST. Sealgraf seals it into the receipt:
 * the approved amount, what the agent reports it actually paid, and the
 * merchant reference — so neither side can rewrite the record afterwards.
 */
export async function submitCompletion(
  preauthId: string,
  decisionToken: string,
  completionNonce: string,
  evidence: CompletionEvidence,
): Promise<any> {
  return sealgrafRest(`/v1/preauthorize/${preauthId}/complete`, {
    decision_token: decisionToken,
    completion_nonce: completionNonce,
    evidence: {
      type: "order_confirmation",
      counterparty_receipt_ref: evidence.counterpartyReceiptRef,
      note: evidence.note,
      ...(evidence.completedAmountMinor !== undefined
        ? { completed_amount_minor: evidence.completedAmountMinor }
        : {}),
    },
  });
}
