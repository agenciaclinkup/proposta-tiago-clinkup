import "server-only";
import { ServiceError } from "@/lib/services/errors";

// Decisão do produto: OpenAI Whisper (whisper-1) por padrão; Groq quando GROQ_API_KEY estiver configurada.
// Mesmo formato de API (compatível com OpenAI), então basta trocar URL, chave e modelo.
function provider() {
  if (process.env.GROQ_API_KEY) {
    return {
      url: "https://api.groq.com/openai/v1/audio/transcriptions",
      key: process.env.GROQ_API_KEY,
      model: "whisper-large-v3-turbo",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return { url: "https://api.openai.com/v1/audio/transcriptions", key: process.env.OPENAI_API_KEY, model: "whisper-1" };
  }
  return null;
}

export async function transcribeAudio(audio: Blob, filename: string): Promise<string> {
  const config = provider();
  if (!config) {
    throw new ServiceError("A transcrição de áudio ainda não está disponível. Por enquanto, envie sua mensagem por texto.");
  }

  const form = new FormData();
  form.set("file", audio, filename);
  form.set("model", config.model);
  form.set("language", "pt");
  form.set("response_format", "json");

  const response = await fetch(config.url, {
    method: "POST",
    headers: { authorization: `Bearer ${config.key}` },
    body: form,
  });
  if (!response.ok) throw new Error(`transcription failed with status ${response.status}`);

  const data = (await response.json()) as { text?: string };
  return (data.text ?? "").trim();
}
