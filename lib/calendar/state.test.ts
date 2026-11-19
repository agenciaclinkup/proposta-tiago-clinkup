import { describe, expect, it } from "vitest";
import { canEditPost, statusLabel } from "./state";

describe("estados do calendário", () => {
  it("permite editar novo post, rascunho e agendamento, mas bloqueia estados do publicador", () => {
    expect([null, "draft", "scheduled"].map(canEditPost)).toEqual([true, true, true]);
    expect(["publishing", "published", "failed", "unknown"].map(canEditPost)).toEqual([false, false, false, false]);
  });
  it("apresenta estados em português", () => {
    expect(["draft", "scheduled", "publishing", "published", "failed"].map(statusLabel)).toEqual(["Rascunho", "Agendado", "Em publicação", "Publicado", "Falhou"]);
  });
});
