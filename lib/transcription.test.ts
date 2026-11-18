import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";
import { transcribeAudio } from "./transcription";

const fetchMock = vi.fn();
const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: "  Qual é o meu plano?  " }), { status: 200 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const sentForm = () => fetchMock.mock.calls[0][1].body as FormData;

describe("transcribeAudio", () => {
  it("usa OpenAI whisper-1 em português por padrão", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai");
    vi.stubEnv("GROQ_API_KEY", "");
    expect(await transcribeAudio(audio, "voice.ogg")).toBe("Qual é o meu plano?");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ authorization: "Bearer sk-openai" });
    expect(sentForm().get("model")).toBe("whisper-1");
    expect(sentForm().get("language")).toBe("pt");
    expect(sentForm().get("file")).toBeInstanceOf(Blob);
  });

  it("usa Groq quando GROQ_API_KEY está configurada", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai");
    vi.stubEnv("GROQ_API_KEY", "gsk-groq");
    await transcribeAudio(audio, "voice.ogg");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ authorization: "Bearer gsk-groq" });
  });

  it("avisa de forma amigável quando nenhum provedor foi configurado", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    await expect(transcribeAudio(audio, "voice.ogg")).rejects.toBeInstanceOf(ServiceError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falha quando a API recusa o áudio", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai");
    fetchMock.mockResolvedValue(new Response("bad", { status: 400 }));
    await expect(transcribeAudio(audio, "voice.ogg")).rejects.toThrow("400");
  });
});
