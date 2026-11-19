// Arte do slide em 1080×1350 (retrato do Instagram). Só estilos inline compatíveis com Satori (next/og):
// o mesmo componente gera a prévia no navegador e o PNG exportado para o calendário.
export type SlideArtProps = {
  slide: { role: "hook" | "content" | "cta"; heading: string; body: string };
  theme: { primaryColor?: string; secondaryColor?: string; backgroundColor?: string; fontFamily?: string };
  index: number;
  total: number;
  backgroundUrl: string | null;
};
export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;
const ROLE_LABEL = { hook: "", content: "", cta: "Próximo passo" };

export function SlideArt({ slide, theme, index, total, backgroundUrl }: SlideArtProps) {
  const primary = theme.primaryColor ?? "#00D4FF";
  const secondary = theme.secondaryColor ?? "#2563EB";
  const background = theme.backgroundColor ?? "#050811";
  return (
    <div style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, display: "flex", position: "relative", backgroundColor: background, color: "#F8FAFC", fontFamily: theme.fontFamily ?? "Inter, sans-serif", overflow: "hidden" }}>
      {backgroundUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- Satori só aceita <img>; URL assinada temporária.
        <img src={backgroundUrl} alt="" width={SLIDE_WIDTH} height={SLIDE_HEIGHT} style={{ position: "absolute", top: 0, left: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, objectFit: "cover" }} />
      )}
      <div style={{ position: "absolute", top: 0, left: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, display: "flex", backgroundImage: `linear-gradient(180deg, ${background}33 0%, ${background}EE 70%)` }} />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: slide.role === "hook" ? "center" : "flex-end", width: SLIDE_WIDTH, height: SLIDE_HEIGHT, padding: 96 }}>
        <div style={{ display: "flex", width: 120, height: 12, borderRadius: 6, backgroundImage: `linear-gradient(90deg, ${primary}, ${secondary})`, marginBottom: 48 }} />
        {ROLE_LABEL[slide.role] && <div style={{ display: "flex", fontSize: 32, fontWeight: 600, color: primary, textTransform: "uppercase", letterSpacing: 4, marginBottom: 24 }}>{ROLE_LABEL[slide.role]}</div>}
        <div style={{ display: "flex", fontSize: slide.role === "hook" ? 88 : 68, fontWeight: 800, lineHeight: 1.1, whiteSpace: "pre-wrap" }}>{slide.heading || " "}</div>
        {slide.body && <div style={{ display: "flex", fontSize: 40, lineHeight: 1.4, marginTop: 36, color: "#CBD5E1", whiteSpace: "pre-wrap" }}>{slide.body}</div>}
        {total > 1 && <div style={{ display: "flex", position: "absolute", top: 72, right: 96, fontSize: 30, color: "#94A3B8" }}>{`${index + 1}/${total}`}</div>}
      </div>
    </div>
  );
}
