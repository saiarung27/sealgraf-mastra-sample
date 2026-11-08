/**
 * A small procurement agent with one paid tool.
 *
 * The rule the sample demonstrates: the agent may only spend after Sealgraf
 * says the spend is permitted. The paid tool checks first and fails closed —
 * a denial, a refusal, a network error, or any response that is not a clear
 * "allow" means the purchase does not happen.
 */

import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  checkPermission,
  claimDecisionToken,
  submitCompletion,
} from "../sealgraf";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  }
  return value;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * STUB — replace this with your real checkout (a store API, a browser flow,
 * a procurement system). In this sample it only "places an order" and
 * returns the merchant reference a real order would give you. Completion
 * evidence is the agent's report of what it paid; Sealgraf seals that
 * report next to the approval so the two can be compared by anyone.
 */
async function placeOrderStub(input: {
  item: string;
  amountMinor: number;
  currency: string;
  counterparty: string;
}): Promise<{ orderRef: string; chargedAmountMinor: number }> {
  return {
    orderRef: `DEMO-ORDER-${Date.now()}`,
    chargedAmountMinor: input.amountMinor,
  };
}

export const buyOfficeSupplies = createTool({
  id: "buy-office-supplies",
  description:
    "Buy office supplies from a supplier. Asks Sealgraf for permission first; " +
    "buys only if Sealgraf allows the spend, and seals a receipt afterwards.",
  inputSchema: z.object({
    item: z.string().describe("What to buy, e.g. 'A4 paper, 10 reams'"),
    supplier: z.string().describe("Who would be paid, e.g. 'Staples'"),
    amountMinor: z
      .number()
      .int()
      .positive()
      .describe("Total price in cents, e.g. 4250 for $42.50"),
    currency: z.string().default("USD"),
  }),
  outputSchema: z.object({
    status: z.enum(["completed", "denied", "waiting_for_owner", "not_completed"]),
    message: z.string(),
    receiptId: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { item, supplier, amountMinor, currency } = context;

    // 1. Ask BEFORE buying. Any failure here stops the purchase:
    //    an unreachable checker is not permission.
    let check;
    try {
      check = await checkPermission({
        mandateId: requireEnv("SEALGRAF_MANDATE_ID"),
        agentId: process.env.SEALGRAF_AGENT_ID ?? "procurement-agent",
        category: "office_supplies",
        amountMinor,
        currency,
        counterparty: supplier,
        description: item,
        idempotencyKey: `buy-${Date.now()}`,
      });
    } catch (error) {
      return {
        status: "not_completed" as const,
        message: `Could not get a permission answer from Sealgraf, so nothing was bought. (${(error as Error).message})`,
      };
    }

    const outcome = check.decision.outcome;

    // 2. Denied: fail closed. The reason code is the product's own
    //    (over_per_purchase_cap, category_not_allowed, mandate_expired, ...).
    if (outcome === "deny") {
      return {
        status: "denied" as const,
        message: `Sealgraf denied this spend (${check.decision.reason_code}). Nothing was bought.`,
      };
    }

    let decisionToken = check.decision_token;

    // 3. Above the owner's ask-first threshold: the owner decides on their
    //    own screen. This sample waits a short while, then gives up rather
    //    than buying unapproved. A production agent would poll the check
    //    record (GET /v1/preauthorize/{id}) about every 30 seconds.
    if (outcome === "needs_human_approval") {
      for (let attempt = 0; attempt < 4 && !decisionToken; attempt++) {
        await sleep(30_000);
        try {
          const claimed = await claimDecisionToken(check.preauth_id);
          decisionToken = claimed.decision_token;
        } catch {
          // Not approved yet (or the owner declined) — keep waiting briefly.
        }
      }
      if (!decisionToken) {
        return {
          status: "waiting_for_owner" as const,
          message:
            "This spend is waiting for the owner's decision in Sealgraf. Nothing was bought.",
        };
      }
    }

    if (outcome !== "allow" && outcome !== "needs_human_approval") {
      return {
        status: "not_completed" as const,
        message: `Unexpected Sealgraf outcome "${outcome}". Nothing was bought.`,
      };
    }
    if (!decisionToken) {
      return {
        status: "not_completed" as const,
        message: "Sealgraf allowed the spend but returned no decision token. Nothing was bought.",
      };
    }

    // 4. Buy (stub), with the exact amount and supplier that were checked.
    const order = await placeOrderStub({
      item,
      amountMinor,
      currency,
      counterparty: supplier,
    });

    // 5. Seal it: report the order back to Sealgraf against the token.
    //    The receipt records the approval and this report together.
    const receipt = await submitCompletion(
      check.preauth_id,
      decisionToken,
      `completion-${check.preauth_id}`,
      {
        counterpartyReceiptRef: order.orderRef,
        note: item,
        completedAmountMinor: order.chargedAmountMinor,
      },
    );

    return {
      status: "completed" as const,
      message: `Bought "${item}" from ${supplier}. Sealgraf sealed the receipt.`,
      receiptId: receipt?.receipt_id,
    };
  },
});

export const procurementAgent = new Agent({
  name: "Procurement Agent",
  instructions:
    "You help buy office supplies. Whenever a purchase is requested, use the " +
    "buy-office-supplies tool — it asks Sealgraf for permission before any " +
    "money moves. Never claim a purchase happened unless the tool says it " +
    "completed, and report denials and owner-waits honestly.",
  model: process.env.MODEL_ID ?? "openai/gpt-4o-mini",
  tools: { buyOfficeSupplies },
});
