# Folio: local first PDF assistant

Folio stores PDFs, extracted pages, retrieval chunks, conversations, and preferences in this browser's IndexedDB. PDF parsing, OCR, retrieval, and citations run locally. An optional WebLLM model runs through WebGPU. With consent, selected excerpts and necessary recent conversation context can be sent through the Folio server to one of two configured online AI providers. The whole PDF is not intentionally uploaded by this feature.

## Run locally

Requires Node.js 20 or newer and npm.

```sh
npm install
npm run dev
npm test
npm run build
```

The development server includes the same `/api/online` and `/api/online/status` routes used by Vercel. It loads the root `.env` on the server only. The existing `.env` file is ignored by Git. Do not add a `VITE_` prefix to API secrets.

Expected local server environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `Groq_Api` | At least one online provider | Groq API key |
| `Gemini_Api` | At least one online provider | Google Gemini API key |
| `GROQ_MODEL` | Optional | Groq model ID; defaults to `openai/gpt-oss-120b` |
| `GEMINI_MODEL` | Optional | Gemini model ID; defaults to `gemini-3.8-flash` |

The default provider order is deterministic: Groq first, then Gemini. Set `ONLINE_PRIMARY_PROVIDER=gemini` to reverse the order. Folio tries the other configured provider once after a network failure, timeout, rate limit, quota exhaustion, or server error. Authentication and model configuration errors do not trigger a retry. Each provider attempt has a 12-second timeout. Short in-memory cooldowns reduce repeated calls after timeouts, rate limits, and provider outages. The status endpoint only reports generic configuration availability; a key's presence does not prove that it works.

## Deploy to Vercel

Import the repository into Vercel. The functions are `api/online.ts` and `api/online-status.ts`. Configure `Groq_Api` and/or `Gemini_Api` as server-side project environment variables. Optional model variables are `GROQ_MODEL` and `GEMINI_MODEL`; `ONLINE_PRIMARY_PROVIDER` can be set to `gemini` to reverse the default order. Redeploy after changing environment variables. Vercel does not automatically receive a local `.env` file; configure these values in the Vercel project settings. Do not use browser-visible `VITE_` variables for secrets.

## Online privacy and consent

Folio checks saved consent before every online request and also requires consent at the server route. Revoking consent prevents subsequent requests. The settings disclosure says:

> Allow online AI providers. When enabled, Folio may send your question, relevant PDF excerpts, and necessary recent conversation context to a configured online AI provider. Your full PDF is not intentionally uploaded by this feature. Requests are processed by an external provider through the Folio server.

If both providers are configured, a request can be processed by either provider because Folio may fail over. Explicit Local model mode never contacts an online endpoint. Automatic mode may use the selected local model after online failure, and requires consent before attempting an online provider.

## WebLLM model compatibility

The app checks each selected ID against the installed `@mlc-ai/web-llm` `prebuiltAppConfig`; it never substitutes another model. Verified against installed WebLLM 0.2.86:

| Model ID | Declared WebGPU memory | Required feature |
| --- | ---: | --- |
| `SmolLM2-360M-Instruct-q4f16_1-MLC` | 376.06 MB | `shader-f16` |
| `SmolLM2-360M-Instruct-q4f32_1-MLC` | 579.61 MB | None declared |
| `Llama-3.2-1B-Instruct-q4f16_1-MLC` | 879.04 MB | None declared |

When “Load the selected model automatically in the background” is enabled, loading begins after the library opens. Otherwise the model loads only when requested manually. Download and initialization progress, WebGPU compatibility issues, shader-f16 support, and initialization errors are shown in Settings. Device support and available GPU memory vary.

## Processing and retrieval

PDF.js parses pages and retains original page numbers and text. English Tesseract.js OCR is lazy-loaded for scanned or text-poor pages when enabled. Processing is sequential and checkpointed per page in IndexedDB. Retry skips completed good/OCR pages. Search uses BM25, stop-word removal, original page numbers, and extraction-quality tags; it does not download an embedding model. The PDF viewer opens the original page from each citation.

Current ingestion limits are 100 MB and 2,000 pages. Very large files can exceed browser memory or storage limits. Browser storage is best effort and can be evicted. Use **Clear all local data** in Settings to delete sessions, PDFs, pages, chunks, and saved preferences.

## Evaluation

`src/lib/evaluation.fixture.ts` contains a fixed six-page synthetic document and 30 manually labeled questions. Run `npm run evaluate` for retrieval supporting-page hit@4 or `npm test` for routing, model-loading, consent, provider, and IndexedDB tests. These tests do not measure language-model factual accuracy, real-PDF OCR quality, latency, or device memory.

## Limitations

- Online provider availability depends on deployment configuration, model access, and current provider status.
- Browser storage can be evicted and large PDFs can exceed device limits.
- Review cited source passages, especially for scanned pages, tables, and conflicting text.
