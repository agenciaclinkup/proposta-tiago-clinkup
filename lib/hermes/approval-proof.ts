// Apenas a mensagem recebida do canal pode fornecer uma confirmação; argumentos de Tools não são prova.
export function confirmationFromUserMessage(message: { role: string; parts: readonly { type: string; text?: string }[] }): string | null {
  if (message.role !== "user" || message.parts.length !== 1 || message.parts[0].type !== "text") return null;
  return /^CONFIRMAR ([0-9a-f]{32})$/i.exec(message.parts[0].text?.trim() ?? "")?.[1]?.toLowerCase() ?? null;
}
