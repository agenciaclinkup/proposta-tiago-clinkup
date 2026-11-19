import { randomInt } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { readMetaSignedRequest } from "@/lib/integrations/meta-compliance";
import { deleteMetaUserData } from "@/lib/services/integrations";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// "Data Deletion Request URL" do app Meta. A exclusão é imediata; a resposta segue o formato exigido pela Meta.
export async function POST(request: NextRequest) {
  const result = await readMetaSignedRequest(request);
  if (result instanceof NextResponse) return result;

  await deleteMetaUserData(result.userId);
  const code = Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin).replace(/\/$/, "");
  return NextResponse.json({ url: `${siteUrl}/meta/exclusao-de-dados?codigo=${code}`, confirmation_code: code });
}
