from __future__ import annotations
import hashlib, json, logging, re
from dataclasses import asdict, dataclass
from pathlib import Path

log = logging.getLogger(__name__)

@dataclass
class Page:
    source: str
    page_index: int
    page_number: int
    printed_page_number: str | None
    academic_year: str
    text: str
    extraction_method: str
    needs_ocr: bool = False

def academic_year_for(name: str) -> str:
    if "BITSAT-2026" in name: return "2026-27"
    if "HD_Brochure_2025_26" in name: return "2025-26"
    if "Admission_Modality" in name: return "2022 (historical)"
    return "unknown"

def fingerprint(path: Path) -> str:
    h = hashlib.sha256(); h.update(str(path.stat().st_size).encode()); h.update(str(path.stat().st_mtime_ns).encode())
    return h.hexdigest()

def _printed_number(text: str) -> str | None:
    lines = [x.strip() for x in text.splitlines() if x.strip()]
    for line in lines:
        m = re.search(r"\b(\d{1,3})\s*\|\s*P\s*a\s*g\s*e\b", line, re.I)
        if m: return m.group(1)
        m = re.search(r"\b(?:page\s*)?(\d{1,3})\s*of\s*\d{1,3}\b", line, re.I)
        if m: return m.group(1)
    for line in reversed(lines[-4:]):
        m = re.fullmatch(r"(?:page\s*)?(\d{1,3})", line, re.I)
        if m: return m.group(1)
    return None

def load_pdf(path: Path, cache_dir: Path | None = None, ocr: bool = False) -> list[Page]:
    path = Path(path)
    cache_dir = cache_dir or path.parent.parent / "processed"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / f"{path.stem}.extract-v2.{fingerprint(path)[:16]}.json"
    if cached.exists():
        return [Page(**x) for x in json.loads(cached.read_text(encoding="utf-8"))]
    extractor = "pymupdf"
    try:
        import fitz
    except ImportError:
        fitz = None
        try:
            from pypdf import PdfReader
            extractor = "pypdf"
        except ImportError as exc:
            raise RuntimeError("Install PyMuPDF (preferred) or pypdf in the project environment before indexing.") from exc
    pages: list[Page] = []
    doc = fitz.open(path) if fitz is not None else None
    reader = PdfReader(str(path)) if fitz is None else None
    try:
        source_pages = enumerate(doc) if doc is not None else enumerate(reader.pages)
        for i, pdf_page in source_pages:
            text = (pdf_page.get_text("text") if fitz is not None else pdf_page.extract_text()) or ""
            needs = len(re.sub(r"\s+", "", text)) < 30
            method = extractor
            if needs and ocr and fitz is not None:
                try:
                    import pytesseract
                    from PIL import Image
                    pix = pdf_page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                    text = pytesseract.image_to_string(Image.frombytes("RGB", [pix.width, pix.height], pix.samples))
                    method = "pymupdf+ocr"; needs = len(text.strip()) < 30
                except Exception as exc: log.warning("OCR failed for %s page %d: %s", path.name, i + 1, exc)
            pages.append(Page(path.name, i, i + 1, _printed_number(text), academic_year_for(path.name), text, method, needs))
    finally:
        if doc is not None: doc.close()
    cached.write_text(json.dumps([asdict(x) for x in pages], ensure_ascii=False), encoding="utf-8")
    return pages

def discover_and_extract(pdf_dir: Path, cache_dir: Path | None = None, ocr: bool = False) -> list[Page]:
    paths = sorted(pdf_dir.glob("*.pdf"))
    return [p for path in paths for p in load_pdf(path, cache_dir, ocr)]
