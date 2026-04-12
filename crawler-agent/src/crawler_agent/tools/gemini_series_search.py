"""用 Gemini 将「系列/三部曲」等资源库名解析为适合豆瓣搜索的短标题（可选，依赖 GEMINI_API_KEY）。"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request


def series_bundle_heuristic(title: str) -> bool:
    """是否需要优先走 Gemini 做豆瓣检索词（合集/系列风格名称）。"""
    s = (title or "").strip()
    if not s:
        return False
    markers = (
        "系列",
        "三部曲",
        "全系列",
        "合集",
        "部曲",
        "各部",
        "套装",
        "礼盒",
        "收藏版",
        "电影版",
        "剧场版",
    )
    return any(m in s for m in markers)


def gemini_resolve_series_search_title(library_title: str) -> str | None:
    """
    返回 ``douban_search_title``：在豆瓣站内最易命中的核心片名（通常去掉「系列」「三部曲」等）。
    无 API Key 或调用失败时返回 ``None``。
    """
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key:
        return None
    base = (os.environ.get("GEMINI_PROXY_BASE") or "https://generativelanguage.googleapis.com").rstrip("/")
    model = (os.environ.get("GEMINI_MODEL") or "gemini-2.0-flash").strip()
    url = (
        f"{base}/v1beta/models/{urllib.parse.quote(model, safe='')}"
        f":generateContent?key={urllib.parse.quote(key)}"
    )
    prompt = "\n".join(
        [
            "你是影视资料助手。用户资源库中的条目名称可能是「系列/多部合集」风格，需要变成在豆瓣上最容易搜到正传或代表作品的短名称。",
            "只输出 JSON，不要 markdown，不要解释。",
            '格式：{"douban_search_title":"..."}',
            "规则：",
            "1) douban_search_title 只填一个字符串，用于豆瓣站内搜索。",
            "2) 去掉「系列」「三部曲」「全系列」「合集」等集合词，保留核心 IP 名。",
            "3) 例：「终结者系列」→「终结者」；「黑客帝国三部曲」→「黑客帝国」；「碟中谍系列」→「碟中谍」。",
            "4) 若输入本身已是常规单片名、无集合后缀，可轻微去噪后原样返回。",
            "5) 不要带季数、不要带英文副标题，除非核心名就是英文且豆瓣常用。",
            f"输入名称：{library_title.strip()}",
        ]
    )
    body = json.dumps(
        {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"},
        },
        ensure_ascii=False,
    ).encode("utf-8")
    timeout = max(8, int(os.environ.get("GEMINI_TIMEOUT_MS", "25000")) // 1000)
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = json.loads(resp.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, json.JSONDecodeError):
        return None
    text = None
    try:
        parts = raw.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        if parts and isinstance(parts[0].get("text"), str):
            text = parts[0]["text"]
    except (IndexError, KeyError, TypeError):
        return None
    if not text:
        return None
    try:
        obj = json.loads(text.strip())
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict):
        return None
    out = obj.get("douban_search_title")
    if not isinstance(out, str):
        return None
    out = out.strip()
    if not out or len(out) > 80:
        return None
    return out


def planned_douban_search_titles(library_title: str) -> list[str]:
    """返回依次尝试的豆瓣搜索词列表（去重、非空）。"""
    raw = (library_title or "").strip()
    if not raw:
        return []
    gem = gemini_resolve_series_search_title(raw)
    if series_bundle_heuristic(raw) and gem and gem != raw:
        return [gem, raw]
    out: list[str] = []
    for x in (raw, gem if gem else ""):
        x = (x or "").strip()
        if x and x not in out:
            out.append(x)
    return out or [raw]


def strip_tv_season_display_zh(zh: str, *, is_tv: bool) -> str:
    """剧集：去掉豆瓣条目标题里常见的「第X季」展示后缀，卡片仍显示剧名本体。"""
    if not is_tv or not (zh or "").strip():
        return (zh or "").strip()
    s = zh.strip()
    patterns = [
        r"\s*[(（]\s*第[一二三四五六七八九十百千万零〇两0-9]+\s*季\s*[)）]\s*$",
        # 「剧名 第一季 / 剧名第一季」等（豆瓣剧集条目常见）
        r"\s*第[一二三四五六七八九十百千万零〇两0-9]+\s*季\s*$",
        r"\s*第\s*[0-9]+\s*季\s*$",
        r"\s+Season\s*\d+\s*$",
        r"\s+S\d+\s*$",
    ]
    prev = None
    while prev != s:
        prev = s
        for p in patterns:
            s = re.sub(p, "", s, flags=re.IGNORECASE).strip()
    return s or zh.strip()
