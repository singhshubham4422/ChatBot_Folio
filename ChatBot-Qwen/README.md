# BITS Admissions Chatbot — Offline Qwen Edition

Live web version: https://chat-bot-folio.vercel.app/

This folder contains the standalone offline version of the BITS admissions chatbot. It answers questions from the three supplied BITS admission PDFs and can run locally without a cloud AI service.

## Two chatbot implementations in this project

The project has two separate implementations built from the same PDF knowledge base:

### 1. Web SmartBot

The web version runs in a browser. It uses a React interface, a verified FAQ dataset, PDF search, page citations, and browser voice input. It usually returns a predefined verified answer first. If a question is not in the FAQ dataset, it searches the indexed PDF text and returns an extractive answer with source pages.

Web techniques include:

- Exact and alternative-question matching
- Normalized keywords and admission-year context
- BM25 plus embedding search for PDF passages
- Programme/source routing and ambiguity clarification
- Structured tables and page-level citations
- Browser speech recognition for voice questions

### 2. Offline ChatBot-qwen

This folder is a Python terminal chatbot. It extracts PDF pages locally, splits them into overlapping chunks, searches them with BM25 and optional semantic vectors, and asks a local Qwen model to write the answer. The answer includes citations to the retrieved PDF pages.

Offline techniques include:

- PyMuPDF PDF extraction with `pypdf` fallback
- Cached page extraction and optional OCR
- Overlapping document chunks
- BM25 keyword retrieval
- Optional Sentence Transformers embeddings and FAISS
- Lexical cosine-similarity fallback when semantic packages are unavailable
- Reciprocal Rank Fusion for hybrid retrieval
- Evidence-only prompts for Qwen
- Local Whisper voice input
- Optional Windows offline text-to-speech

The web and offline implementations are intentionally separate. The web app is browser-oriented; this folder is designed for a local CPU-based deployment.

## Source documents

The chatbot searches these files in `Data/pdfs`:

- `BITSAT-2026_brochure.pdf`
- `HD_Brochure_2025_26.pdf`
- `Admission_Modality_FD.pdf`

Answers are limited to evidence found in these documents. Dates, fees, and admission rules should be checked against the latest official BITS website before making decisions.

## Clone and install

```powershell
git clone <YOUR_REPOSITORY_URL>
cd ChatBot-qwen

python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install llama-cpp-python huggingface_hub
```

If PowerShell blocks activation, use the environment directly:

```powershell
.\\.venv\\Scripts\\python.exe -m pip install -r requirements.txt
```

## Download and configure the local Qwen model

The model is deliberately not stored in Git because it is very large. Download the Qwen GGUF model from the official repository:

https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF

Download `qwen2.5-3b-instruct-q4_k_m.gguf` and place it here:

```text
models\\qwen2.5-3b-instruct-q4_k_m.gguf
```

Then configure the local model for the current PowerShell session:

```powershell
$env:LLM_MODEL_PATH="$PWD\\models\\qwen2.5-3b-instruct-q4_k_m.gguf"
$env:LLM_THREADS="8"
$env:LLM_CONTEXT_SIZE="2048"
$env:LLM_MAX_TOKENS="384"
```

The application can still start without the model and show retrieved evidence, but generated answers require the GGUF file and `llama-cpp-python`.

## Build the local PDF index

The generated index is ignored by Git and can be rebuilt after cloning:

```powershell
python scripts\\build_index.py
```

This creates generated files under `Data/index` and `Data/processed`. If Sentence Transformers or FAISS are not installed, the system uses lexical retrieval instead.

## Run the chatbot

```powershell
python run.py
```

Type a question and press Enter. Exit with `/exit`.

Available commands:

```text
/help       Show commands
/sources    Show evidence used for the previous answer
/history    Show recent conversation turns
/clear      Clear conversation history
/status     Show index, model, voice, and TTS status
/reindex    Rebuild the PDF index
/voice      Record a microphone question
/tts on     Enable offline speech output
/tts off    Disable speech output
/speak      Toggle speech output
/exit       Exit
```

## Optional offline voice input

Install the local microphone and Whisper packages:

```powershell
python -m pip install "sounddevice>=0.5,<1" "faster-whisper>=1.2,<2"
```

Download the small English Whisper model locally:

```powershell
python -c "from faster_whisper import WhisperModel; WhisperModel('small.en', device='cpu', compute_type='int8', download_root='models/whisper-small.en')"
```

Configure and run:

```powershell
$env:ASR_MODEL="small.en"
$env:ASR_MODEL_PATH="$PWD\\models\\whisper-small.en"
$env:ASR_MAX_SECONDS="8"
python run.py
```

Then use `/voice`. The transcription is shown before it is sent to the chatbot.

## Optional offline text-to-speech

```powershell
python -m pip install "pyttsx3>=2.99,<3"
python run.py
```

Inside the chatbot, use `/tts on`. Windows SAPI speaks the answer locally. Citations are removed from the spoken text but remain visible in the terminal.

## Configuration

Copy `.env.example` to `.env` if you want a reference configuration. The main settings are:

```text
PDF_DIRECTORY=Data/pdfs
INDEX_DIRECTORY=Data/index
RETRIEVAL_TOP_K=5
CHUNK_SIZE=550
CHUNK_OVERLAP=80
LLM_CONTEXT_SIZE=2048
LLM_MAX_TOKENS=384
```

Environment variables are read when the application starts.

## Tests

```powershell
python -m pytest -q
python -m compileall -q src scripts run.py
```

The tests cover PDF metadata, chunking, BM25 search, hybrid ranking, citations, index persistence, bounded conversation history, model errors, voice input, and TTS failure handling.

## Files intentionally excluded from Git

The repository excludes local environments, caches, generated indexes, extracted page data, downloaded models, and audio files. These files can be recreated using the instructions above.
