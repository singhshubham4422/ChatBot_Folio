from __future__ import annotations
import re, hashlib
from dataclasses import asdict
from .pdf_loader import Page

def _words(text: str) -> list[str]: return re.findall(r"\S+", text)

def chunk_pages(pages: list[Page], size: int = 550, overlap: int = 80) -> list[dict]:
    out = []
    for page in pages:
        words = _words(page.text)
        if not words: continue
        step = max(1, size - overlap)
        for start in range(0, len(words), step):
            text = " ".join(words[start:start + size]).strip()
            if not text: continue
            section = next((x.strip() for x in re.split(r"\s{2,}|\n", page.text) if len(x.strip()) < 100 and re.search(r"[A-Za-z]", x)), "General")
            base = f"{page.source}:{page.page_number}:{start}:{text[:100]}"
            out.append({"chunk_id": hashlib.sha1(base.encode()).hexdigest()[:16], "text": text, "source": page.source,
                        "page_index": page.page_index, "page_number": page.page_number, "printed_page_number": page.printed_page_number,
                        "academic_year": page.academic_year, "section": section})
            if start + size >= len(words): break
    return out
