from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from bits_chatbot.config import Config
from bits_chatbot.ingestion.index_builder import build_index

if __name__ == "__main__":
    c=Config.from_env(); c.index_dir.mkdir(parents=True,exist_ok=True)
    paths=sorted(c.pdf_dir.glob("*.pdf")); print("PDFs discovered:", ", ".join(p.name for p in paths) or "none")
    missing={"Admission_Modality_FD.pdf","BITSAT-2026_brochure.pdf","HD_Brochure_2025_26.pdf"}-{p.name for p in paths}
    if missing: print("WARNING missing:", ", ".join(sorted(missing)))
    try:
        pages,chunks=build_index(c.pdf_dir,c.index_dir,c.chunk_size,c.chunk_overlap)
    except Exception as exc:
        print(f"ERROR: index build failed: {exc}")
        raise SystemExit(2)
    semantic=(c.index_dir/"index.faiss").exists()
    print(f"Pages extracted: {len(pages)}; pages requiring OCR: {sum(p.needs_ocr for p in pages)}; chunks created: {len(chunks)}")
    print(f"Embeddings/FAISS: {'available' if semantic else 'not available; lexical fallback persisted'}")
    print("Output:", c.index_dir/"metadata.json", c.index_dir/"vectors.json")
