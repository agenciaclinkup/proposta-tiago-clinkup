// CSV com aspas RFC 4180 e JSON em array; a validação de campos ocorre no servidor.
export function parseProspectFile(text: string, format: "csv" | "json"): unknown {
  if (text.length > 262144) throw new Error("O arquivo deve ter no máximo 256 KB.");
  if (format === "json") { const result: unknown = JSON.parse(text); if (!Array.isArray(result)) throw new Error("O JSON deve conter uma lista."); return result; }
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false; let closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') { quoted = false; closed = true; } else cell += char; continue; }
    if (char === '"' && !cell && !closed) { quoted = true; continue; }
    if (char === ',' || char === '\n' || char === '\r') { row.push(cell); cell = ""; closed = false; if (char !== ',') { rows.push(row); row = []; if (char === '\r' && text[i + 1] === '\n') i++; } continue; }
    if (closed || char === '"') throw new Error("Arquivo CSV inválido.");
    cell += char;
  }
  if (quoted) throw new Error("Arquivo CSV inválido.");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift()?.map((value) => value.replace(/^\uFEFF/, "").trim()) ?? [];
  const allowed = ["cnpj", "name", "category", "address", "city", "phone", "whatsapp", "email", "website", "instagram"];
  if (!headers.includes("cnpj") || !headers.includes("name") || new Set(headers).size !== headers.length || headers.some((header) => !allowed.includes(header))) throw new Error("CSV deve ter colunas cnpj e name; confira os nomes das colunas.");
  return rows.filter((entry) => entry.some(Boolean)).map((entry) => { if (entry.length !== headers.length) throw new Error("Confira as colunas do CSV."); return Object.fromEntries(headers.map((header, index) => [header, entry[index]])); });
}
