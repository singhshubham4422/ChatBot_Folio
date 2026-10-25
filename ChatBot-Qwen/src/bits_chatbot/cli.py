from __future__ import annotations
import logging
import sys
from pathlib import Path
try:
    from rich.console import Console
except ImportError:
    class Console:
        def print(self, *args, **kwargs):
            text = " ".join(str(x) for x in args) + "\n"
            encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
            sys.stdout.write(text.encode(encoding, errors="replace").decode(encoding))
try:
    from prompt_toolkit import prompt
    PROMPT_TOOLKIT_AVAILABLE = True
except ImportError:
    prompt = input
    PROMPT_TOOLKIT_AVAILABLE = False
from .config import Config
from .ingestion.index_builder import build_index
from .retrieval.hybrid_search import HybridSearch
from .retrieval.vector_store import VectorStore
from .retrieval.embeddings import Embedder
from .chatbot.pipeline import Pipeline
from .llm.local_model import LocalModel

def main():
    c=Config.from_env(); con=Console(); logging.basicConfig(level=c.log_level)
    if not (c.index_dir/"metadata.json").exists(): con.print("No index found. Run: python scripts/build_index.py"); return
    embedder=Embedder(c.embedding_model) if (c.index_dir/"index.faiss").exists() else None
    store=VectorStore.load(c.index_dir, embedder=embedder); model=None
    try: model=LocalModel(c.resolve(c.llm_model_path),c.llm_context_size,c.llm_threads,c.llm_max_tokens)
    except Exception as e: con.print(f"[yellow]Model unavailable (text retrieval still available): {e}[/yellow]")
    pipe=Pipeline(HybridSearch(store),model,c.history_turns); tts_enabled=False; voice=None; tts=None
    con.print(f"BITS Admissions Chatbot v0.1.0 | CPU-only | {len({x['source'] for x in store.chunks})} PDFs | {len(store.chunks)} chunks | semantic={'yes' if store.faiss_index is not None and embedder is not None else 'no'} | /help for commands")
    interactive_prompt = PROMPT_TOOLKIT_AVAILABLE and sys.stdin.isatty() and sys.stdout.isatty()
    while True:
        try: q=prompt("You: ").strip()
        except Exception as exc:
            # prompt_toolkit needs a native Windows console; pipes and some IDE terminals do not provide one.
            if interactive_prompt: raise
            try: q=input("You: ").strip()
            except (EOFError,KeyboardInterrupt): con.print(); break
        except (EOFError,KeyboardInterrupt): con.print(); break
        if not q: continue
        if q=="/exit": break
        if q=="/help": con.print("/voice /tts on /tts off /speak /sources /history /clear /reindex /status /exit"); continue
        if q in ("/tts on", "/speak"):
            if q == "/speak" and tts_enabled:
                tts_enabled=False; con.print("TTS off"); continue
            try:
                from .voice.speech_output import SpeechOutput
                tts = tts or SpeechOutput()
                if not tts.available:
                    con.print(f"TTS unavailable: {tts.error or 'no local speech engine'}")
                else:
                    tts_enabled=True; con.print("TTS on (offline)")
            except Exception as exc: con.print(f"TTS unavailable: {exc}")
            continue
        if q == "/tts off": tts_enabled=False; con.print("TTS off"); continue
        if q=="/voice":
            try:
                from .voice.speech_input import SpeechInput
                candidate_voice=voice or SpeechInput(c.asr_model, c.resolve(c.asr_model_path), c.asr_max_seconds)
                transcription=candidate_voice.transcribe(); voice=candidate_voice; con.print(f"Transcribed: {transcription}")
                decision=input("Send transcription? [Y]es / [N]o / [E]dit: ").strip().lower()
                if decision in ("", "y", "yes"): q=transcription
                elif decision in ("e", "edit"): q=input("Edit question: ").strip()
                else: con.print("Voice question cancelled."); continue
            except Exception as e: con.print(f"[yellow]{e}[/yellow]"); continue
        if q=="/sources":
            for x in pipe.last: con.print(f"{x['source']} p.{x['page_number']}: {x['text'][:500]}...")
            continue
        if q=="/history":
            for a,b in pipe.conversation.recent(): con.print(f"You: {a}\nBot: {b}")
            continue
        if q=="/clear": pipe.conversation.clear(); con.print("Conversation cleared."); continue
        if q=="/status": con.print(f"PDFs: {len({x['source'] for x in store.chunks})}; chunks: {len(store.chunks)}; model: {'loaded' if model else 'not loaded'}; voice: {'ready' if voice else 'not initialized'}; TTS: {'on' if tts_enabled else 'off'}"); continue
        if q=="/reindex":
            pages,chunks=build_index(c.pdf_dir,c.index_dir,c.chunk_size,c.chunk_overlap); store=VectorStore.load(c.index_dir); pipe.searcher=HybridSearch(store); con.print(f"Reindexed {len(pages)} pages / {len(chunks)} chunks."); continue
        answer=pipe.ask(q); con.print(answer)
        if tts_enabled and tts:
            try:
                if not tts.speak(answer): con.print(f"TTS unavailable: {tts.error or 'speech failed'}")
            except Exception as e: con.print(f"[yellow]TTS unavailable: {e}[/yellow]")
