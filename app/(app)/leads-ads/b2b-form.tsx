"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseProspectFile } from "@/lib/prospecting/import-file";
import { searchB2bAction } from "./actions";

export function B2bForm() {
  const router = useRouter();
  const [type, setType] = useState<"brasilapi" | "commercial" | "import">("brasilapi");
  const [cnpjs, setCnpjs] = useState(""); const [niche, setNiche] = useState(""); const [location, setLocation] = useState("");
  const [count, setCount] = useState(10); const [records, setRecords] = useState<unknown[] | null>(null);
  const [origin, setOrigin] = useState(""); const [legalBasis, setLegalBasis] = useState(""); const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState(""); const [pending, start] = useTransition(); const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function read(file: File) {
    try {
      if (file.size > 262144 || !/\.(csv|json)$/i.test(file.name)) throw new Error("Escolha um CSV ou JSON de até 256 KB.");
      const result = parseProspectFile(await file.text(), file.name.toLowerCase().endsWith(".csv") ? "csv" : "json");
      if (!Array.isArray(result) || result.length < 1 || result.length > 100) throw new Error("A lista deve conter de 1 a 100 registros.");
      setRecords(result); setMessage(`${result.length} registro(s) carregado(s). Confira a origem antes de importar.`); setRequestId(crypto.randomUUID());
    } catch (error) { setRecords(null); setMessage(error instanceof Error ? error.message : "Arquivo inválido."); }
  }
  function submit() {
    setMessage("");
    const base = { requestId, authorized, origin, legalBasis };
    const input = type === "import" ? { ...base, type, records: records ?? [] } : type === "brasilapi" ? { ...base, type, cnpjs: cnpjs.split(/[\s,;]+/).filter(Boolean) } : { ...base, type, niche, location, maxResults: count };
    start(async () => {
      const result = await searchB2bAction(input);
      if ("error" in result) setMessage(result.error);
      else { setMessage(result.status === "succeeded" ? "Resultados registrados. Revise-os abaixo." : result.status === "running" ? "A busca está em andamento. Verifique o histórico." : "A busca não foi concluída. Inicie outra solicitação."); if (result.status !== "running") setRequestId(crypto.randomUUID()); router.refresh(); }
    });
  }
  return <section className="space-y-4 rounded-xl border border-border bg-card/40 p-5"><h2 className="text-lg font-semibold">Encontrar empresas</h2>
    <div><Label htmlFor="b2b-type">Origem</Label><select id="b2b-type" className="mt-1 block h-10 rounded-md border border-input bg-background px-3 text-sm" value={type} onChange={(event) => { setType(event.target.value as typeof type); setRequestId(crypto.randomUUID()); }}><option value="brasilapi">Consulta por CNPJ (BrasilAPI)</option><option value="commercial">Busca B2B configurada</option><option value="import">Importar CSV ou JSON</option></select></div>
    {type === "brasilapi" && <div><Label htmlFor="b2b-cnpj">CNPJs (até 5, separados por linha ou vírgula)</Label><Textarea id="b2b-cnpj" value={cnpjs} onChange={(event) => { setCnpjs(event.target.value); setRequestId(crypto.randomUUID()); }} /></div>}
    {type === "commercial" && <div className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor="b2b-niche">Segmento ou CNAE</Label><Input id="b2b-niche" value={niche} onChange={(e) => { setNiche(e.target.value); setRequestId(crypto.randomUUID()); }} /><p className="mt-1 text-xs text-muted-foreground">Casa dos Dados: informe o CNAE com 7 dígitos.</p></div><div><Label htmlFor="b2b-location">Cidade ou região</Label><Input id="b2b-location" value={location} onChange={(e) => { setLocation(e.target.value); setRequestId(crypto.randomUUID()); }} /></div><div><Label htmlFor="b2b-count">Quantidade (1 a 100)</Label><Input id="b2b-count" type="number" min={1} max={100} value={count} onChange={(e) => { setCount(Number(e.target.value)); setRequestId(crypto.randomUUID()); }} /></div></div>}
    {type === "import" && <div><Label htmlFor="b2b-file">Arquivo CSV ou JSON</Label><Input id="b2b-file" type="file" accept=".csv,.json" onChange={(e) => { const file = e.target.files?.[0]; if (file) void read(file); }} /><p className="mt-1 text-xs text-muted-foreground">CSV: colunas cnpj e name; opcionais category, address, city, phone, whatsapp, email, website, instagram. JSON: lista de objetos com os mesmos campos.</p></div>}
    <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="b2b-origin">Origem dos dados</Label><Input id="b2b-origin" value={origin} onChange={(e) => { setOrigin(e.target.value); setRequestId(crypto.randomUUID()); }} placeholder="Ex.: base própria ou nome do fornecedor" /></div><div><Label htmlFor="b2b-basis">Base legal ou autorização</Label><Input id="b2b-basis" value={legalBasis} onChange={(e) => { setLegalBasis(e.target.value); setRequestId(crypto.randomUUID()); }} /></div></div>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={(e) => { setAuthorized(e.target.checked); setRequestId(crypto.randomUUID()); }} className="mt-1" /> Declaro que tenho autorização e base legal para usar e armazenar esses dados.</label>
    <div className="flex flex-wrap items-center gap-3"><Button onClick={submit} disabled={pending || !authorized}>{pending ? "Consultando…" : type === "import" ? "Importar lista" : "Consultar empresas"}</Button><p role="status" className="text-sm text-muted-foreground">{message}</p></div>
  </section>;
}
