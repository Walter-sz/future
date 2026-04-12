import { mediaAgentFetch } from "@/lib/media-agent-client";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const upstream = await mediaAgentFetch(`/runs/${encodeURIComponent(id)}`);
    const data = await upstream.json();
    return Response.json(data, { status: upstream.status });
  } catch (err) {
    return Response.json(
      { ok: false, error: `media agent unavailable: ${(err as Error).message}` },
      { status: 503 }
    );
  }
}
