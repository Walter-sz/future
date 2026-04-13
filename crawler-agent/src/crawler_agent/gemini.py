"""Shared Gemini / LangChain helpers used by X and XHS graphs."""

from __future__ import annotations

import asyncio
import json
import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from crawler_agent.progress import SendMessage


def get_llm(
    google_api_key: str | None,
    model: str = "gemini-2.5-flash",
):
    """Return a ``ChatGoogleGenerativeAI`` instance, or *None* if no key."""
    key = (google_api_key or "").strip()
    if not key:
        return None
    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(model=model, google_api_key=key)


def llm_response_text(resp: Any) -> str:
    """Extract plain text from an ``AIMessage`` (Gemini 3.x may return a list of blocks)."""
    raw = getattr(resp, "content", None)
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, list):
        parts: list[str] = []
        for b in raw:
            if isinstance(b, str):
                parts.append(b)
            elif isinstance(b, dict):
                t = b.get("text")
                parts.append("" if t is None else str(t))
            else:
                parts.append(str(getattr(b, "text", b)))
        return "".join(parts).strip()
    if isinstance(raw, dict):
        t = raw.get("text")
        return str(t).strip() if t is not None else ""
    return str(raw).strip()


async def ainvoke_llm_with_progress(
    llm: Any,
    prompt: Any,
    send: SendMessage,
    timeout: float,
    *,
    progress_interval: float = 4.0,
):
    """Invoke *llm* and push periodic ``status`` updates via *send*.

    ``prompt`` can be a plain string or a ``HumanMessage`` (for multimodal).
    """
    from langchain_core.messages import HumanMessage

    invoke_payload = [prompt] if isinstance(prompt, HumanMessage) else prompt
    task = asyncio.create_task(llm.ainvoke(invoke_payload))
    step = max(3.0, min(progress_interval, 15.0))

    async def _progress_loop() -> None:
        elapsed = 0.0
        while True:
            await asyncio.sleep(step)
            if task.done():
                return
            elapsed += step
            if elapsed < 10:
                phase = "等待模型响应"
            elif elapsed < 25:
                phase = "模型推理中"
            else:
                phase = "内容较多，仍在处理"
            await send(
                "status",
                {"message": f"AI 分析进行中 — {phase}（已约 {int(elapsed)}s）…"},
            )

    poller = asyncio.create_task(_progress_loop())
    try:
        return await asyncio.wait_for(task, timeout=timeout)
    finally:
        poller.cancel()
        try:
            await poller
        except asyncio.CancelledError:
            pass


def parse_llm_json_array(text: str) -> list[dict]:
    """Strip markdown fences and parse the LLM response as a JSON array."""
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    result = json.loads(text)
    if not isinstance(result, list):
        raise ValueError("模型返回不是 JSON 数组")
    return result
