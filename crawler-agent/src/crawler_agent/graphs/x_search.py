"""X (Twitter) search: xmcp → optional Gemini ranking → results.

Unlike Douban/XHS this graph does NOT use a browser — data comes from the
X API via the xmcp MCP server.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from crawler_agent.config import Settings
from crawler_agent.gemini import (
    ainvoke_llm_with_progress,
    get_llm,
    llm_response_text,
    parse_llm_json_array,
)
from crawler_agent.mcp_client import search_recent_posts
from crawler_agent.progress import SendMessage, noop_progress

log = logging.getLogger("crawler-agent.x")


def _build_ranking_prompt(query: str, tweets_json: str, max_posts: int) -> str:
    return f"""You are ranking X (Twitter) search results for the query: "{query}"

Here are candidate tweets in JSON (each has text, username, images, likes, retweets, etc.):
{tweets_json}

Select exactly {max_posts} tweets. Ranking criteria (in priority order):

1. RELEVANCE: The tweet must genuinely relate to "{query}". Off-topic tweets that happen to
   contain a keyword are worse than on-topic ones with fewer likes.

2. REAL PHOTOS preferred: If the "images" array is non-empty, those tweets likely contain real
   photos uploaded by the author (not just an avatar). STRONGLY PREFER tweets that have images
   — especially photos showing real people, places, activities, or results relevant to the query.
   Tweets with empty "images" arrays have NO attached photo.

3. GENUINE HUMAN CONTENT: Prefer tweets from real people sharing personal experience, progress,
   tips, or stories. Avoid crypto/finance spam, bot-generated promotional threads, adult content
   farms, and accounts that look like automated repost bots.

4. ENGAGEMENT as tiebreaker: When relevance and content quality are similar, prefer higher
   likes/retweets. But a genuine personal post with 5 likes beats a spammy viral post.

5. AVOID: crypto shills, NFT promotions, porn spam, pure ads, empty retweets, bot-like accounts
   with random alphanumeric usernames (e.g. @xx349521024...), Grok/AI-generated promotional posts.

Each object MUST have these fields (copy values from the input data):
  tweet_id     – tweet ID (string)
  text         – tweet text (string)
  username     – author @handle (string)
  display_name – author display name (string)
  avatar       – profile image URL (string, empty if unknown)
  preview      – 1-2 sentence Chinese summary of why this tweet is relevant and interesting (string)
  url          – full tweet URL https://x.com/username/status/tweet_id (string)
  cover_image  – first URL from the tweet's "images" array (string, empty if images array is empty)
  likes        – like count (number)
  retweets     – retweet count (number)

CRITICAL: For cover_image, use the tweet's attached image (from "images" field), NOT the avatar.
If "images" is empty, set cover_image to empty string "".

Return ONLY the JSON array, no markdown fences, no extra text."""


def _posts_from_raw(tweets: list[dict], limit: int) -> list[dict]:
    """Fallback: convert raw tweets to display format without Gemini."""
    out = []
    for tw in tweets[:limit]:
        out.append(
            {
                "tweet_id": tw.get("tweet_id", ""),
                "text": tw.get("text", ""),
                "username": tw.get("username", ""),
                "display_name": tw.get("display_name", ""),
                "avatar": tw.get("avatar", ""),
                "preview": (tw.get("text") or "")[:120],
                "url": tw.get("url", ""),
                "cover_image": (tw.get("images") or [""])[0],
                "likes": tw.get("likes", 0),
                "retweets": tw.get("retweets", 0),
            }
        )
    return out


async def run_x_search_posts(
    settings: Settings,
    *,
    query: str,
    max_results: int | None = None,
    on_progress: SendMessage | None = None,
) -> tuple[dict[str, Any] | None, list[str], dict[str, str] | None]:
    """Search X via xmcp and optionally rank with Gemini.

    Returns the standard ``(data, source_urls, error_dict | None)`` triple.
    """
    send = on_progress or noop_progress()
    max_results = max_results or settings.x_search_max_results
    max_posts = settings.x_max_posts

    await send("status", {"message": f'正在搜索 X: "{query}"'})

    # 1. Fetch candidates
    try:
        await send(
            "status",
            {"message": f"正在通过 xmcp 调用 X API 搜索（最多 {max_results} 条）…"},
        )
        tweets = await search_recent_posts(settings.xmcp_url, query, max_results)
        await send("status", {"message": f"X API 返回 {len(tweets)} 条候选推文"})
    except Exception as e:
        log.exception("xmcp search failed: %s", e)
        return None, [], {"code": "XMCP_ERROR", "message": f"X 搜索失败: {e}"}

    if not tweets:
        return {"platform": "x", "cards": []}, [], None

    # 2. Gemini ranking (optional)
    llm = get_llm(settings.google_api_key, settings.gemini_model)
    posts: list[dict] = []

    if llm is None:
        await send("status", {"message": "未配置 GOOGLE_API_KEY，跳过 AI 筛选"})
        posts = _posts_from_raw(tweets, max_posts)
    else:
        tweets_json = json.dumps(tweets[:max_results], ensure_ascii=False)
        prompt = _build_ranking_prompt(query, tweets_json, max_posts)
        await send(
            "status",
            {"message": f"AI 正在从 {len(tweets)} 条推文中筛选 {max_posts} 条高质量结果…"},
        )
        try:
            resp = await ainvoke_llm_with_progress(
                llm,
                prompt,
                send,
                settings.gemini_request_timeout_s,
                progress_interval=settings.gemini_progress_interval_s,
            )
            text = llm_response_text(resp)
            posts = parse_llm_json_array(text)
        except asyncio.TimeoutError:
            await send("status", {"message": "AI 筛选超时，使用原始搜索结果"})
            posts = _posts_from_raw(tweets, max_posts)
        except Exception as e:
            hint = ""
            if "location is not supported" in str(e).lower():
                hint = "（当前地区不支持 Gemini API，请开启 VPN 后重试）"
            await send("status", {"message": f"AI 筛选失败{hint}，使用原始结果: {e}"})
            posts = _posts_from_raw(tweets, max_posts)

    # 3. Normalise output
    raw_map = {tw["tweet_id"]: tw for tw in tweets if tw.get("tweet_id")}

    for i, p in enumerate(posts[:max_posts]):
        p["id"] = f"x_{i}"
        p["platform"] = "x"
        tid = p.get("tweet_id", "")
        raw = raw_map.get(tid, {})
        p.setdefault("title", f"@{p.get('username', '')} · {p.get('display_name', '')}")
        p.setdefault("nickname", f"@{p.get('username', '')}")
        if not p.get("cover_image") and raw.get("images"):
            p["cover_image"] = raw["images"][0]
        p.setdefault("images", raw.get("images", []))
        if not p.get("avatar"):
            p["avatar"] = raw.get("avatar", "")
        if not p.get("url"):
            uname = p.get("username") or raw.get("username", "i")
            p["url"] = f"https://x.com/{uname}/status/{tid}"

    cards = posts[:max_posts]
    await send("status", {"message": f"✓ 找到 {len(cards)} 个 X 结果"})
    return {"platform": "x", "cards": cards}, [], None
