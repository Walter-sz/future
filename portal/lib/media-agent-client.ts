const DEFAULT_MEDIA_AGENT_URL = "http://127.0.0.1:3847";

export function getMediaAgentBaseUrl() {
  const raw = process.env.MEDIA_AGENT_URL || DEFAULT_MEDIA_AGENT_URL;
  return raw.replace(/\/$/, "");
}

export async function mediaAgentFetch(pathname: string, init?: RequestInit) {
  const url = `${getMediaAgentBaseUrl()}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
}
