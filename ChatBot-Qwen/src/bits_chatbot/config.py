from __future__ import annotations
import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).lower() in {"1", "true", "yes", "on"}

@dataclass(frozen=True)
class Config:
    llm_model_path: Path = Path(os.getenv("LLM_MODEL_PATH", "models/qwen2.5-3b-instruct-q4_k_m.gguf"))
    llm_context_size: int = int(os.getenv("LLM_CONTEXT_SIZE", "2048"))
    llm_threads: int = int(os.getenv("LLM_THREADS", str(max(1, (os.cpu_count() or 2) - 1))))
    llm_max_tokens: int = int(os.getenv("LLM_MAX_TOKENS", "384"))
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    pdf_directory: Path = Path(os.getenv("PDF_DIRECTORY", "Data/pdfs"))
    index_directory: Path = Path(os.getenv("INDEX_DIRECTORY", "Data/index"))
    chunk_size: int = int(os.getenv("CHUNK_SIZE", "550"))
    chunk_overlap: int = int(os.getenv("CHUNK_OVERLAP", "80"))
    retrieval_top_k: int = int(os.getenv("RETRIEVAL_TOP_K", "5"))
    enable_voice_input: bool = _bool("ENABLE_VOICE_INPUT", False)
    enable_tts: bool = _bool("ENABLE_TTS", False)
    asr_model: str = os.getenv("ASR_MODEL", "small.en")
    asr_model_path: Path = Path(os.getenv("ASR_MODEL_PATH", "models/whisper-small.en"))
    asr_max_seconds: int = int(os.getenv("ASR_MAX_SECONDS", "8"))
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    history_turns: int = int(os.getenv("HISTORY_TURNS", "6"))

    @property
    def root(self) -> Path:
        return ROOT

    def resolve(self, path: Path) -> Path:
        return path if path.is_absolute() else self.root / path

    @property
    def pdf_dir(self): return self.resolve(self.pdf_directory)
    @property
    def index_dir(self): return self.resolve(self.index_directory)

    @classmethod
    def from_env(cls) -> "Config": return cls()
