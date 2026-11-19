import { NextResponse, type NextRequest } from "next/server";
import { readMetaSignedRequest } from "@/lib/integrations/meta-compliance";
import { deleteMetaUserData } from "@/lib/services/integrations";

// "Deauthorize Callback URL" do app Meta: o usuário removeu o app → desconectamos as contas dele.
export async function POST(request: NextRequest) {
  const result = await readMetaSignedRequest(request);
  if (result instanceof NextResponse) return result;
  await deleteMetaUserData(result.userId);
  return NextResponse.json({ ok: true });
}
