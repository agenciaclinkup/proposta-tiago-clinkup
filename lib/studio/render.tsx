import "server-only";
import { ImageResponse } from "next/og";
import { SLIDE_HEIGHT, SLIDE_WIDTH, SlideArt, type SlideArtProps } from "@/components/studio/slide-art";

export type RenderSlideInput = SlideArtProps;

export async function renderStudioSlide(input: RenderSlideInput): Promise<Uint8Array> {
  const response = new ImageResponse(<SlideArt {...input} />, { width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
  return new Uint8Array(await response.arrayBuffer());
}
