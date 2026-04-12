"""Download poster images: 优先使用页面导航期间拦截到的图床响应（与右键「另存为」同源）。"""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlparse

_CT_EXT: list[tuple[str, str]] = [
    ("image/webp", ".webp"),
    ("image/jpeg", ".jpg"),
    ("image/jpg", ".jpg"),
    ("image/png", ".png"),
    ("image/avif", ".avif"),
]


def _is_binary_image_body(b: bytes) -> bool:
    if not b or len(b) < 500:
        return False
    s = b.lstrip()[:64]
    if s.startswith(b"<") or s.startswith(b"<!") or s.startswith(b"{"):
        return False
    return (
        b.startswith(b"\xff\xd8\xff")
        or b.startswith(b"\x89PNG\r\n\x1a\n")
        or (b.startswith(b"RIFF") and len(b) > 12 and b[8:12] == b"WEBP")
        or b.startswith(b"\x00\x00\x00")  # 部分 avif
    )


def _photo_public_id(url: str) -> str:
    """用于匹配 DOM 里 src 与 network 里实际请求（如 .../public/p457760035.webp）。"""
    try:
        path = urlparse(url).path
    except Exception:
        return ""
    if "/public/" in path:
        return path.split("/public/", 1)[-1]
    return path.rsplit("/", 1)[-1] if "/" in path else path


def _ext_from_magic_or_url(body: bytes, image_url: str) -> str:
    if body.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if body.startswith(b"\x89PNG"):
        return ".png"
    if body.startswith(b"RIFF") and len(body) > 12 and body[8:12] == b"WEBP":
        return ".webp"
    low = image_url.lower()
    if ".webp" in low:
        return ".webp"
    if ".png" in low:
        return ".png"
    return ".jpg"


def _absolute_cover_url(cover_url: str | None) -> str | None:
    if not cover_url or not isinstance(cover_url, str):
        return None
    u = cover_url.strip()
    if u.startswith("//"):
        u = "https:" + u
    if not u.startswith("http"):
        return None
    return u


def pick_intercepted_poster_bytes(
    hits: list[tuple[str, bytes]],
    cover_url: str | None,
) -> bytes | None:
    """仅当拦截 URL 与 DOM 封面为同一 ``public/<id>`` 资源时才采用，避免误选推荐位等其它海报。"""
    dom = _absolute_cover_url(cover_url)
    if not dom:
        return None
    valid = [(u, b) for u, b in hits if _is_binary_image_body(b)]
    if not valid:
        return None
    fid_dom = _photo_public_id(dom)
    if not fid_dom:
        return None
    strict = [(u, b) for u, b in valid if _photo_public_id(u) == fid_dom]
    if not strict:
        return None
    dom_path = urlparse(dom).path.rstrip("/")
    for u, b in strict:
        if urlparse(u).path.rstrip("/") == dom_path:
            return b
    strict.sort(key=lambda x: len(x[1]), reverse=True)
    return strict[0][1]


def create_douban_poster_response_collector() -> tuple[list[tuple[str, bytes]], object]:
    """返回 (收集列表, 可作为 page.on('response', handler) 的异步回调)。"""
    hits: list[tuple[str, bytes]] = []

    async def on_response(response) -> None:
        if response.status != 200:
            return
        try:
            ct = (response.headers.get("content-type") or "").lower()
            if "image" not in ct:
                return
            u = response.url
            if "doubanio.com" not in u or "/view/photo/" not in u:
                return
            body = await response.body()
            if len(body) < 800:
                return
            hits.append((u, body))
        except Exception:
            return

    return hits, on_response


def _poster_url_variants(url: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for u in [url, url.replace("s_ratio_poster", "l_ratio_poster"), url.replace("m_ratio_poster", "l_ratio_poster")]:
        u = u.strip()
        if u.startswith("http") and u not in seen:
            seen.add(u)
            out.append(u)
    return out


async def _request_cover_bytes(page, image_url: str, referer: str) -> tuple[bytes | None, str | None, str | None]:
    ref = referer if referer.startswith("http") else "https://movie.douban.com/"
    try:
        ua = await page.evaluate("() => navigator.userAgent")
    except Exception:
        ua = (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
    headers = {
        "Referer": ref,
        "User-Agent": ua,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
    }
    last_err: str | None = None
    for u in _poster_url_variants(image_url):
        try:
            resp = await page.context.request.get(u, headers=headers, timeout=60_000)
        except Exception as e:
            last_err = f"request_failed:{e!s}"[:200]
            continue
        if resp.status != 200:
            last_err = f"http_status_{resp.status}"
            continue
        body = await resp.body()
        if not _is_binary_image_body(body):
            last_err = "non_image_body"
            continue
        ct = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        return body, ct, None
    return None, None, last_err or "all_variants_failed"


async def download_douban_cover(
    page,
    *,
    subject_id: str,
    image_url: str,
    referer: str,
    dest_dir: Path,
) -> tuple[str | None, str | None, str | None]:
    if not subject_id or not re.fullmatch(r"\d+", subject_id):
        return None, None, "invalid_subject_id"
    if not image_url or not image_url.startswith(("http://", "https://")):
        return None, None, "invalid_image_url"

    dest_dir = dest_dir.resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)

    body, ct_hint, err = await _request_cover_bytes(page, image_url, referer)
    if not body:
        return None, None, err

    ext = _ext_from_magic_or_url(body, image_url)
    ct = (ct_hint or "").lower()
    for prefix, e in _CT_EXT:
        if prefix in ct:
            ext = e
            break

    fname = f"{subject_id}{ext}"
    out_path = dest_dir / fname
    out_path.write_bytes(body)

    http_path = f"/static/covers/{fname}"
    rel_fs = str(out_path.resolve())
    return http_path, rel_fs, None


def _write_cover_bytes(subject_id: str, body: bytes, image_url: str, dest_dir: Path) -> tuple[str, str]:
    dest_dir = dest_dir.resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)
    ext = _ext_from_magic_or_url(body, image_url)
    fname = f"{subject_id}{ext}"
    out_path = dest_dir / fname
    out_path.write_bytes(body)
    return f"/static/covers/{fname}", str(out_path.resolve())


async def _wait_mainpic_ready(page, timeout_ms: int = 25_000) -> None:
    await page.wait_for_function(
        """() => {
          const im = document.querySelector('#mainpic a img') || document.querySelector('#mainpic img');
          if (!im) return false;
          return im.complete && im.naturalWidth >= 120 && im.naturalHeight >= 160;
        }""",
        timeout=timeout_ms,
    )


async def _screenshot_mainpic_jpeg(page, out_path: Path) -> bool:
    loc = page.locator("#mainpic a img, #mainpic img").first
    await loc.scroll_into_view_if_needed()
    try:
        await _wait_mainpic_ready(page, 22_000)
    except Exception:
        pass
    await loc.screenshot(path=str(out_path), type="jpeg", quality=92)
    return out_path.is_file() and out_path.stat().st_size >= 3500


async def save_subject_cover_best_effort(
    page,
    *,
    subject_id: str,
    image_url: str,
    referer: str,
    dest_dir: Path,
    intercepted_images: list[tuple[str, bytes]] | None = None,
) -> tuple[dict[str, str | None], str | None]:
    """
    1) 条目页加载期间拦截到的图床响应（与右键保存一致）
    2) Playwright request 直连（多 URL + 浏览器头）
    3) 截取 #mainpic 海报（真像素加载后）
    """
    dest_dir = dest_dir.resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)
    fname_fallback = f"{subject_id}.jpg"
    out_path = dest_dir / fname_fallback

    if intercepted_images:
        rawb = pick_intercepted_poster_bytes(intercepted_images, image_url)
        if rawb and _is_binary_image_body(rawb):
            http_p, rel_p = _write_cover_bytes(subject_id, rawb, image_url, dest_dir)
            return {
                "coverHttpPath": http_p,
                "coverLocalPath": rel_p,
                "coverSaveMode": "navigation_response",
                "coverDownloadError": None,
                "coverCdnNote": None,
            }, None

    http_p, rel_p, err = await download_douban_cover(
        page,
        subject_id=subject_id,
        image_url=image_url,
        referer=referer,
        dest_dir=dest_dir,
    )
    if http_p and rel_p:
        return {
            "coverHttpPath": http_p,
            "coverLocalPath": rel_p,
            "coverSaveMode": "download",
            "coverDownloadError": None,
        }, None

    notes = [err] if err else []
    ok = await _screenshot_mainpic_jpeg(page, out_path)
    if not ok:
        combined = ";".join([*(x for x in notes if x), "screenshot_failed"])[:400]
        return {
            "coverHttpPath": None,
            "coverLocalPath": None,
            "coverSaveMode": None,
            "coverDownloadError": combined,
        }, combined

    http_path = f"/static/covers/{fname_fallback}"
    rel_fs = str(out_path.resolve())
    cdn_note = None
    if notes:
        cdn_note = ("豆瓣 CDN 直连未成功（" + ";".join(notes)[:180] + "），已截取条目页海报为 JPEG。")[:420]
    return {
        "coverHttpPath": http_path,
        "coverLocalPath": rel_fs,
        "coverSaveMode": "screenshot",
        "coverDownloadError": None,
        "coverCdnNote": cdn_note,
    }, None
