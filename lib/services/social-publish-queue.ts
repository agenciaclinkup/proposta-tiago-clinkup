import "server-only";

export type SocialClaim = { id: string; organizationId: string; leaseToken: string };
export type PublishResult = "published" | "failed" | "uncertain";
export class RejectedPublication extends Error {}
export class UnconfirmedPublication extends Error {
  constructor(readonly externalId: string) { super("publication not confirmed"); }
}

// A gravação de posse acontece antes de chamar qualquer provedor. Falhas sem resposta inequívoca
// ficam inconclusivas: não se repete automaticamente uma ação que pode ter sido aceita.
export async function processClaim(claim: SocialClaim, targets: string[], operations: {
  start: (target: string, claim: SocialClaim) => Promise<void>;
  publish: (target: string, claim: SocialClaim) => Promise<string>;
  finish: (target: string, result: PublishResult, externalId: string | null, message: string | null) => Promise<void>;
}) {
  for (const target of targets) {
    await operations.start(target, claim);
    let result: PublishResult = "published";
    let externalId: string | null = null;
    let message: string | null = null;
    try {
      externalId = await operations.publish(target, claim);
      if (!externalId) throw new Error("missing external id");
    } catch (error) {
      if (error instanceof RejectedPublication) {
        result = "failed";
        const reasons: Record<string, string> = {
          "unsupported format": "Este formato ainda não é compatível com o canal selecionado.",
          "unsupported media and format": "A mídia e o formato não são compatíveis com o canal selecionado.",
          "unsupported google post": "Para o Google, escolha Feed ou Atualização Google e no máximo uma imagem.",
          "media required": "Adicione mídia para publicar neste canal.",
          "reels requires video": "Reels exige um vídeo.",
          "feed requires image": "O feed do Instagram exige uma imagem.",
          "story caption unsupported": "A publicação de Stories não aceita legenda nesta integração. Remova a legenda e as hashtags.",
          "integration disconnected": "A conta não está conectada. Reconecte em Integrações.",
          "invalid media": "A mídia não pertence à empresa. Envie o arquivo novamente.",
        };
        message = reasons[error.message] ?? "O canal recusou a publicação. Confira os dados e a conexão antes de tentar novamente.";
      } else {
        result = "uncertain";
        if (error instanceof UnconfirmedPublication) externalId = error.externalId;
        message = "Não foi possível confirmar a publicação. Confira o canal antes de tentar novamente.";
      }
    }
    await operations.finish(target, result, externalId, message);
  }
}
