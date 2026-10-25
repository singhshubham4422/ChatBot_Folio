from __future__ import annotations
import re

def format_citation(chunk):
    printed=f", printed page {chunk['printed_page_number']}" if chunk.get('printed_page_number') else ""
    return f"[Source: {chunk['source']}, PDF page {chunk['page_number']}{printed}]"

def append_citations(answer, chunks):
    seen=set(); cites=[]
    for c in chunks:
        x=format_citation(c)
        if x not in seen: cites.append(x); seen.add(x)
    return answer.rstrip()+"\n\n"+" ".join(cites) if cites else answer

def validate_citations(answer, chunks):
    valid={format_citation(c) for c in chunks}
    return re.sub(r"\[Source:[^\]]+\]", lambda m:m.group(0) if m.group(0) in valid else "", answer).strip()
