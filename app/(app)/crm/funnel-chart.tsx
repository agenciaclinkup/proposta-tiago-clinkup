"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Row = { name: string; count: number; reached: number; passRate: number | null };

const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

// Uma série (leads por etapa) em um tom só: sem legenda, o título nomeia a série; rótulo direto na ponta da barra.
// A cor primária da marca passou no contraste contra a superfície escura (validador da skill dataviz).
export function FunnelChart({ rows, color }: { rows: Row[]; color: string }) {
  return (
    <div className="h-72 w-full" role="img" aria-label="Gráfico de barras com a quantidade de leads em cada etapa do funil. Os mesmos números estão na tabela abaixo.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }} barCategoryGap={10}>
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis type="number" allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={140}
            tick={{ fill: "var(--foreground)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--accent)", opacity: 0.4 }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }}
            formatter={(value, _name, item) => {
              const row = item.payload as Row;
              const pass = row.passRate === null ? "" : ` · ${pct.format(row.passRate)} seguem para a próxima etapa`;
              return [`${Number(value).toLocaleString("pt-BR")} leads${pass}`, "Nesta etapa"];
            }}
          />
          <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} maxBarSize={28}>
            <LabelList dataKey="count" position="right" fill="var(--muted-foreground)" fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
