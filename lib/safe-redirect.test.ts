import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("mantém caminhos internos", () => {
    expect(safeNextPath("/crm?x=1")).toBe("/crm?x=1");
  });

  it.each(["https://evil.com", "//evil.com", "/\\evil.com", "crm", null])("bloqueia %s", (value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });
});
