import { Mastra } from "@mastra/core";
import { procurementAgent } from "../agents/procurement-agent";

export const mastra = new Mastra({
  agents: { procurementAgent },
});
