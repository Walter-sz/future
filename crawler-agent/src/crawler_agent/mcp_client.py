"""Async client for xmcp (X/Twitter API MCP Server) via FastMCP Client.

xmcp exposes a Streamable-HTTP MCP endpoint (default http://127.0.0.1:8000/mcp).
"""

from __future__ import annotations

import json as _json
import logging

from fastmcp import Client

log = logging.getLogger("crawler-agent.mcp")


async def call_tool(xmcp_url: str, tool_name: str, arguments: dict) -> list:
    async with Client(xmcp_url) as client:
        result = await client.call_tool(tool_name, arguments)
    return result.content if hasattr(result, "content") else result


async def search_recent_posts(
    xmcp_url: str,
    query: str,
    max_results: int = 50,
) -> list[dict]:
    """Search recent posts via xmcp's ``searchPostsRecent`` tool."""
    n = min(max_results, 100)
    args = {
        "query": f"{query} has:images",
        "max_results": str(n),
        "tweet.fields": "created_at,public_metrics,entities,attachments,author_id",
        "user.fields": "name,username,profile_image_url,verified",
        "media.fields": "url,preview_image_url,type,width,height",
        "expansions": "author_id,attachments.media_keys",
    }
    result = await call_tool(xmcp_url, "searchPostsRecent", args)

    for block in result:
        text = getattr(block, "text", None) or (
            block.get("text") if isinstance(block, dict) else None
        )
        if text:
            try:
                parsed = _json.loads(text)
                return _flatten_tweets(parsed)
            except (_json.JSONDecodeError, TypeError):
                log.warning("Failed to parse xmcp response: %s", str(text)[:200])
                return []
    return []


def _flatten_tweets(api_response: dict) -> list[dict]:
    """Flatten X API v2 response (with includes) into a simple list of tweet dicts."""
    tweets = api_response.get("data", [])
    if not isinstance(tweets, list):
        return []

    includes = api_response.get("includes", {})
    users_map: dict[str, dict] = {u.get("id", ""): u for u in includes.get("users", [])}
    media_map: dict[str, dict] = {m.get("media_key", ""): m for m in includes.get("media", [])}

    flat: list[dict] = []
    for tw in tweets:
        author_id = tw.get("author_id", "")
        author = users_map.get(author_id, {})

        media_keys = (tw.get("attachments") or {}).get("media_keys", [])
        images = []
        for mk in media_keys:
            md = media_map.get(mk, {})
            img = md.get("url") or md.get("preview_image_url") or ""
            if img:
                images.append(img)

        metrics = tw.get("public_metrics", {})
        flat.append(
            {
                "tweet_id": tw.get("id", ""),
                "text": tw.get("text", ""),
                "created_at": tw.get("created_at", ""),
                "author_id": author_id,
                "username": author.get("username", ""),
                "display_name": author.get("name", ""),
                "avatar": author.get("profile_image_url", ""),
                "verified": author.get("verified", False),
                "images": images,
                "likes": metrics.get("like_count", 0),
                "retweets": metrics.get("retweet_count", 0),
                "replies": metrics.get("reply_count", 0),
                "url": f"https://x.com/{author.get('username', 'i')}/status/{tw.get('id', '')}",
            }
        )
    return flat
