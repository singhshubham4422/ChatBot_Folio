from __future__ import annotations
import json, logging
from pathlib import Path
from .pdf_loader import discover_and_extract
from .chunker import chunk_pages
from ..retrieval.vector_store import VectorStore
from ..retrieval.embeddings import Embedder

def build_index(pdf_dir: Path, index_dir: Path, chunk_size=550, overlap=80, ocr=False):
    pages=discover_and_extract(pdf_dir, index_dir.parent/"processed", ocr); chunks=chunk_pages(pages,chunk_size,overlap)
    embedder=Embedder("sentence-transformers/all-MiniLM-L6-v2"); vectors=embedder.encode([x["text"] for x in chunks])
    VectorStore(chunks, vectors, embedder.model_name if vectors is not None else "lexical-fallback").save(index_dir)
    (index_dir/"build_info.json").write_text(json.dumps({"pdfs":sorted({p.source for p in pages}),"pages":len(pages),"chunks":len(chunks),"ocr_pages":sum(p.needs_ocr for p in pages)},indent=2),encoding="utf-8")
    return pages,chunks
