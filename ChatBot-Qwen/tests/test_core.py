import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from bits_chatbot.ingestion.chunker import chunk_pages
from bits_chatbot.ingestion.pdf_loader import Page, academic_year_for
from bits_chatbot.retrieval.keyword_search import BM25Search
from bits_chatbot.retrieval.hybrid_search import rrf
from bits_chatbot.chatbot.citations import format_citation, validate_citations
from bits_chatbot.chatbot.conversation import Conversation
from bits_chatbot.retrieval.vector_store import VectorStore
from bits_chatbot.chatbot.pipeline import Pipeline
from bits_chatbot.llm.local_model import LocalModel
from bits_chatbot.llm.prompts import make_prompt

def page(text="Eligibility: PCM students need 75 percent.", source="BITSAT-2026_brochure.pdf"):
    return Page(source, 2, 3, "3", academic_year_for(source), text, "test")

def test_academic_years():
    assert academic_year_for("BITSAT-2026_brochure.pdf") == "2026-27"
    assert academic_year_for("HD_Brochure_2025_26.pdf") == "2025-26"
    assert "historical" in academic_year_for("Admission_Modality_FD.pdf")

def test_chunk_metadata_and_citation():
    c = chunk_pages([page()], 10, 2)[0]
    assert c["page_number"] == 3 and c["printed_page_number"] == "3"
    assert "BITSAT-2026_brochure.pdf" in format_citation(c)

def test_bm25_exact_values():
    chunks = chunk_pages([page(), page("BITS HD GATE eligibility and application deadline.", "HD_Brochure_2025_26.pdf")], 50, 2)
    assert "HD_Brochure_2025_26.pdf" in BM25Search(chunks).search("GATE eligibility", 1)[0][1]["source"]

def test_rrf_deduplicates():
    c = chunk_pages([page()], 50, 2)[0]
    assert len(rrf([(1,c)], [(1,c)], 5)) == 1

def test_invalid_citation_removed():
    c = chunk_pages([page()], 50, 2)[0]
    assert "fake.pdf" not in validate_citations("Answer [Source: fake.pdf, PDF page 99]", [c])

def test_bounded_conversation():
    x=Conversation(2)
    for i in range(4): x.add(str(i), "a")
    assert [q for q,_ in x.recent()] == ["2","3"]

def test_index_persistence():
    import shutil
    tmp_path=Path("data")/"_test_index_persistence"
    try:
        chunks=chunk_pages([page()],50,2); VectorStore(chunks).save(tmp_path)
        loaded=VectorStore.load(tmp_path)
        assert loaded.chunks[0]["source"]==chunks[0]["source"]
    finally:
        shutil.rmtree(tmp_path, ignore_errors=True)

def test_unsupported_query_is_empty():
    from bits_chatbot.retrieval.hybrid_search import HybridSearch
    chunks=chunk_pages([page()],50,2)
    assert HybridSearch(chunks).search("What is the lunar tuition cutoff?",5)==[]

def test_pipeline_uses_metadata_citations_and_mock_model():
    class Search:
        def search(self, query, k): return [(1.0, chunk_pages([page()],50,2)[0])]
    class Model:
        def generate(self, prompt): return "PCM eligibility is stated in the brochure."
    answer=Pipeline(Search(), Model()).ask("What is PCM eligibility?")
    assert "BITSAT-2026_brochure.pdf" in answer and "PDF page 3" in answer

def test_historical_citation_preserves_year():
    historical=page("Historical admission modality information.", "Admission_Modality_FD.pdf")
    assert historical.academic_year == "2022 (historical)"

def test_missing_model_is_actionable():
    import pytest
    with pytest.raises(FileNotFoundError, match="GGUF model not found"):
        LocalModel(Path("data")/"definitely-missing-model.gguf")

def test_tts_missing_dependency_fails_open(monkeypatch):
    from bits_chatbot.voice.speech_output import SpeechOutput
    monkeypatch.setitem(sys.modules, "pyttsx3", None)
    out=SpeechOutput()
    assert out.available is False and out.speak("answer") is False

def test_model_uses_chat_completion_api():
    from bits_chatbot.llm.local_model import LocalModel
    class FakeModel:
        def create_chat_completion(self, **kwargs):
            assert kwargs["messages"][0]["role"] == "user"
            return {"choices":[{"message":{"content":"grounded"}}]}
    model=object.__new__(LocalModel); model.model=FakeModel(); model.max_tokens=20
    assert model.generate("evidence") == "grounded"

def test_prompt_compacts_large_evidence():
    chunks=chunk_pages([page("word " * 1000)],50,2)
    prompt=make_prompt("question", chunks * 5, "history " * 1000)
    assert len(prompt) < 12000 and prompt.count("PDF page") <= 3

def test_speech_input_mocked(monkeypatch):
    import types
    import numpy as np
    class Segment:
        text="what are the eligibility requirements"
    class FakeWhisper:
        def __init__(self, *args, **kwargs): self.calls=0
        def transcribe(self, samples, **kwargs): self.calls += 1; return [Segment()], None
    fake_model=FakeWhisper()
    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=lambda *a, **k: fake_model))
    fake_sd=types.SimpleNamespace(query_devices=lambda **k: {"name":"mock mic"}, rec=lambda *a, **k: np.ones((160,1),dtype="float32"), wait=lambda: None, stop=lambda: None)
    monkeypatch.setitem(sys.modules, "sounddevice", fake_sd)
    from bits_chatbot.voice.speech_input import SpeechInput
    speech=SpeechInput(model_path=Path("models/mock-whisper"), allow_model_download=True, max_seconds=1)
    assert speech.transcribe().startswith("what are")
    assert speech.transcribe().startswith("what are") and fake_model.calls == 2

def test_speech_input_empty_audio(monkeypatch):
    import types
    import numpy as np
    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=lambda *a, **k: object()))
    monkeypatch.setitem(sys.modules, "sounddevice", types.SimpleNamespace(query_devices=lambda **k: {}, rec=lambda *a, **k: np.zeros((20,1),dtype="float32"), wait=lambda: None))
    from bits_chatbot.voice.speech_input import SpeechInput
    import pytest
    with pytest.raises(RuntimeError, match="No speech detected"):
        SpeechInput(model_path=Path("models/mock-whisper"), allow_model_download=True).transcribe()

def test_speech_input_missing_model_does_not_download(monkeypatch):
    import types
    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=lambda *a, **k: object()))
    monkeypatch.setitem(sys.modules, "sounddevice", types.SimpleNamespace(query_devices=lambda **k: {}))
    from bits_chatbot.voice.speech_input import SpeechInput
    import pytest
    with pytest.raises(RuntimeError, match="not installed locally"):
        SpeechInput(model_path=Path("models/no-such-whisper")).transcribe()

def test_tts_strips_citations_and_supports_mock_engine(monkeypatch):
    import types
    class Engine:
        def __init__(self): self.said=[]
        def say(self, text): self.said.append(text)
        def runAndWait(self): pass
    engine=Engine()
    monkeypatch.setitem(sys.modules, "pyttsx3", types.SimpleNamespace(init=lambda: engine))
    from bits_chatbot.voice.speech_output import SpeechOutput
    out=SpeechOutput(); assert out.speak("Answer [Source: file.pdf, PDF page 1]", asynchronous=False)
    assert engine.said == ["Answer"]

def test_tts_engine_failure_fails_open(monkeypatch):
    import types
    monkeypatch.setitem(sys.modules, "pyttsx3", types.SimpleNamespace(init=lambda: (_ for _ in ()).throw(RuntimeError("no SAPI"))))
    from bits_chatbot.voice.speech_output import SpeechOutput
    out=SpeechOutput(); assert not out.available and out.speak("answer") is False
