import { mediaAgentFetch } from "@/lib/media-agent-client";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id) {
    return Response.json({ ok: false, error: "missing id" }, { status: 400 });
  }
  try {
    const upstream = await mediaAgentFetch(`/runs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: "{}",
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
