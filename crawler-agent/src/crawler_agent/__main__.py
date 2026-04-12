"""python -m crawler_agent login <douban|xiaohongshu>"""

from __future__ import annotations

import asyncio
import sys

from crawler_agent.cli_login import amain

if __name__ == "__main__":
    asyncio.run(amain(sys.argv[1:]))
