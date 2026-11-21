import { describe, it, expect } from "vitest";
import { buildHermesTools } from "./tools";
import type { ServiceContext } from "@/lib/services/context";

describe("registro de revisão de prospecção", () => {
  it("disponibiliza as ferramentas de leitura no Hermes", () => {
    const tools = buildHermesTools({ channel: "web" } as ServiceContext);
    expect(tools.list_prospect_searches).toBeDefined();
    expect(tools.list_prospect_results).toBeDefined();
  });
});
