import "server-only";
import { META_GRAPH_VERSION } from "./meta";
import { RejectedPublication, SafeTransientError, UnconfirmedPublication } from "@/lib/services/social-publish-queue";

type Media = { url: string; type: "image" | "video" };
type Input = { accountId: string; token: string; caption: string; media: Media[]; format: string };
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const requireMetaId = (id: string) => { if (!/^\d+$/.test(id)) throw new RejectedPublication("invalid account"); };

async function request(url: string, token: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) throw new RejectedPublication("provider rejected");
    throw new Error("provider unavailable");
  }
  const data = await response.json() as Record<string, unknown>;
  if (data.error) throw new RejectedPublication("provider rejected");
  return data;
}
function idOf(data: Record<string, unknown>, key = "id"): string {
  if (typeof data[key] !== "string" || !data[key]) throw new Error("missing provider id");
  return data[key] as string;
}
// Somente etapas sem efeito público passam por este wrapper; POST final nunca é repetido automaticamente.
async function prepare<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) { if (error instanceof RejectedPublication) throw error; throw new SafeTransientError(); }
}

async function uploadHostedVideo(videoId: string, token: string, url: string) {
  requireMetaId(videoId);
  const response = await fetch(`https://rupload.facebook.com/video-upload/${META_GRAPH_VERSION}/${videoId}`, { method: "POST", headers: { authorization: `OAuth ${token}`, file_url: url }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) { if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) throw new RejectedPublication("provider rejected"); throw new Error("provider unavailable"); }
  const body = await response.json() as { success?: boolean };
  if (body.success !== true) throw new Error("upload not confirmed");
}

export async function publishFacebook(input: Input): Promise<string> {
  requireMetaId(input.accountId);
  const root = `${GRAPH}/${input.accountId}`;
  if (!["feed", "carousel", "reels", "stories"].includes(input.format)) throw new RejectedPublication("unsupported format");
  if (input.format === "stories" && input.media.length === 1 && !input.caption.trim()) {
    const item = input.media[0];
    if (item.type === "image") {
      const photoId = idOf(await prepare(() => request(`${root}/photos`, input.token, { url: item.url, published: false })));
      const result = await request(`${root}/photo_stories`, input.token, { photo_id: photoId });
      return idOf(result, typeof result.post_id === "string" ? "post_id" : "id");
    }
    const created = await prepare(() => request(`${root}/video_stories`, input.token, { upload_phase: "start" }));
    const videoId = idOf(created, "video_id");
    await prepare(() => uploadHostedVideo(videoId, input.token, item.url));
    const result = await request(`${root}/video_stories`, input.token, { upload_phase: "finish", video_id: videoId });
    if (result.success !== true) throw new Error("publish not confirmed");
    throw new UnconfirmedPublication(videoId);
  }
  if (input.format === "stories") throw new RejectedPublication("story caption unsupported");
  if (input.format === "reels" && input.media.length === 1 && input.media[0].type === "video") {
    const created = await prepare(() => request(`${root}/video_reels`, input.token, { upload_phase: "start" }));
    const videoId = idOf(created, "video_id");
    await prepare(() => uploadHostedVideo(videoId, input.token, input.media[0].url));
    const result = await request(`${root}/video_reels`, input.token, { upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: input.caption });
    if (result.success !== true) throw new Error("publish not confirmed");
    // Meta ainda processa o vídeo após aceitar a publicação.
    throw new UnconfirmedPublication(videoId);
  }
  if (!input.media.length && input.format === "feed") return idOf(await request(`${root}/feed`, input.token, { message: input.caption }));
  if (input.media.length === 1 && input.media[0].type === "image" && input.format === "feed") {
    const result = await request(`${root}/photos`, input.token, { url: input.media[0].url, caption: input.caption });
    return idOf(result, typeof result.post_id === "string" ? "post_id" : "id");
  }
  if (input.media.length >= 2 && input.media.every((item) => item.type === "image") && ["feed", "carousel"].includes(input.format)) {
    const attached = [];
    for (const item of input.media) attached.push({ media_fbid: idOf(await prepare(() => request(`${root}/photos`, input.token, { url: item.url, published: false }))) });
    return idOf(await request(`${root}/feed`, input.token, { message: input.caption, attached_media: attached }));
  }
  if (input.media.length === 1 && input.media[0].type === "video" && input.format === "feed") {
    // A API aceita o upload antes de terminar o processamento; não presume que o vídeo já está visível.
    const id = idOf(await request(`${root}/videos`, input.token, { file_url: input.media[0].url, description: input.caption }));
    throw new UnconfirmedPublication(id);
  }
  throw new RejectedPublication("unsupported media and format");
}

async function waitForInstagram(id: string, token: string) {
  requireMetaId(id);
  for (let i = 0; i < 5; i++) {
    const state = await prepare(() => request(`${GRAPH}/${id}?fields=status_code`, token));
    if (state.status_code === "FINISHED") return;
    if (state.status_code === "ERROR" || state.status_code === "EXPIRED") throw new RejectedPublication("container failed");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new SafeTransientError();
}
export async function publishInstagram(input: Input): Promise<string> {
  requireMetaId(input.accountId);
  if (!input.media.length) throw new RejectedPublication("media required");
  if (input.format === "stories" && input.caption.trim()) throw new RejectedPublication("story caption unsupported");
  const root = `${GRAPH}/${input.accountId}`;
  let container: string;
  if (input.format === "carousel" && input.media.length >= 2) {
    const children: string[] = [];
    for (const item of input.media) {
      const child = idOf(await prepare(() => request(`${root}/media`, input.token, { is_carousel_item: true, ...(item.type === "video" ? { media_type: "VIDEO", video_url: item.url } : { image_url: item.url }) })));
      await waitForInstagram(child, input.token); children.push(child);
    }
    container = idOf(await prepare(() => request(`${root}/media`, input.token, { media_type: "CAROUSEL", children: children.join(","), caption: input.caption })));
  } else if (input.media.length === 1 && ["feed", "reels", "stories"].includes(input.format)) {
    const item = input.media[0];
    if (input.format === "reels" && item.type !== "video") throw new RejectedPublication("reels requires video");
    if (input.format === "feed" && item.type !== "image") throw new RejectedPublication("feed requires image");
    container = idOf(await prepare(() => request(`${root}/media`, input.token, { ...(input.format === "reels" ? { media_type: "REELS" } : input.format === "stories" ? { media_type: "STORIES" } : {}), ...(item.type === "video" ? { video_url: item.url } : { image_url: item.url }), ...(input.format === "stories" ? {} : { caption: input.caption }) })));
  } else throw new RejectedPublication("unsupported media and format");
  await waitForInstagram(container, input.token);
  return idOf(await request(`${root}/media_publish`, input.token, { creation_id: container }));
}

export async function publishGoogle(input: Input): Promise<string> {
  if (!/^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+$/.test(input.accountId) || !["feed", "gmb_update"].includes(input.format) || input.media.length > 1 || input.media.some((item) => item.type !== "image")) throw new RejectedPublication("unsupported google post");
  const result = await request(`https://mybusiness.googleapis.com/v4/${input.accountId}/localPosts`, input.token, { languageCode: "pt-BR", topicType: "STANDARD", summary: input.caption, ...(input.media.length ? { media: [{ mediaFormat: "PHOTO", sourceUrl: input.media[0].url }] } : {}) });
  const id = idOf(result, "name");
  if (result.state === "REJECTED") throw new RejectedPublication("provider rejected");
  if (result.state !== "LIVE") throw new UnconfirmedPublication(id);
  return id;
}

// Consulta sem efeitos externos; estados não reconhecidos permanecem pendentes.
export async function checkPublishedStatus(channel: "facebook" | "google_business", externalId: string, token: string): Promise<"pending" | "published" | "failed"> {
  if (channel === "facebook") {
    requireMetaId(externalId);
    const body = await request(`${GRAPH}/${externalId}?fields=status`, token);
    const status = body.status as { video_status?: string; publishing_phase?: { status?: string } } | undefined;
    if (status?.video_status === "error") return "failed";
    if (status?.video_status === "ready" && status.publishing_phase?.status === "complete") return "published";
    return "pending";
  }
  if (!/^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+\/localPosts\/[A-Za-z0-9_-]+$/.test(externalId)) throw new RejectedPublication("invalid external id");
  const body = await request(`https://mybusiness.googleapis.com/v4/${externalId}`, token);
  if (body.state === "LIVE") return "published";
  if (body.state === "REJECTED") return "failed";
  return "pending";
}
