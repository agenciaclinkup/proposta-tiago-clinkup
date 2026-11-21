import { expect, it } from "vitest";
import { parseProspectFile } from "./import-file";
it("lê CSV com aspas e JSON estruturado", () => {
  expect(parseProspectFile('cnpj,name,city\n11222333000181,"Empresa, Ltda",Recife', "csv")).toEqual([{ cnpj: "11222333000181", name: "Empresa, Ltda", city: "Recife" }]);
  expect(parseProspectFile('[{"cnpj":"11222333000181","name":"Empresa"}]', "json")).toEqual([{ cnpj: "11222333000181", name: "Empresa" }]);
});
it("rejeita CSV malformado", () => { expect(() => parseProspectFile('cnpj,name\n1,"Empresa', "csv")).toThrow(); });
