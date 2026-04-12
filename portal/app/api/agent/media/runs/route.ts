import { mediaAgentFetch } from "@/lib/media-agent-client";

export async function GET() {
  try {
    const upstream = await mediaAgentFetch("/runs");
    const data = await upstream.json();
    return Response.json(data, { status: upstream.status });
  } catch (err) {
    return Response.json(
      { ok: false, error: `media agent unavailable: ${(err as Error).message}` },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const body = await request.text();
  try {
    const upstream = await mediaAgentFetch("/runs", {
      method: "POST",
      body: body || "{}",
    });
    const data = await upstream.json();
    return Response.json(data, { status: upstream.status });
  } catch (err) {
    return Response.json(
      { ok: false, error: `media agent unavailable: ${(err as Error).message}` },
      { status: 503 }
    );
  }
}
