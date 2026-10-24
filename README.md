# Smart Bot - BITS PDF assistant

Live trial: https://chat-bot-folio.vercel.app/

Smart Bot combines the Folio reading workspace and branding with a conversational BITS admissions assistant. It searches only the three committed official brochures using hybrid embedding and BM25 retrieval, coverage checks, section expansion, structured tables, and grounded generated answers with page citations. Retrieval remains the evidence layer; generation never receives anything else.

## Features

- Personalized Smart Quick Bot greeting using the Folio display name.
- Document-based demo questions for first-time users.
- `FULL`, `PARTIAL`, `ASPECT_ONLY`, and `NONE` coverage behavior.
- Detailed answers for fees, dates, eligibility, test centers, programmes, procedures, and marking topics.
- Short answers for yes/no and single-fact questions.
- Section-aware retrieval with qualifiers, page ranges, neighboring chunks, and original-passage disclosure.
- Real HTML tables with horizontal scrolling on mobile when PDF table data is extractable.
- Browser voice input with English India and Hindi recognition, transcript normalization, and optional auto-send.
- Background loading of the PDF index and embedding worker when the Folio app mounts.
- Smart Quick Bot is local-only: retrieval, generation and validation run in the browser. It never calls Groq, Gemini, or `/api/conversation`.
- Rules-first intent routing handles greetings, thanks, goodbyes, bot questions, small talk, unsafe prompt-injection requests, and document questions before retrieval.
- The last six user/assistant turns are stored locally per Folio conversation. Follow-ups are rewritten into standalone queries before retrieval.
- Grounded local answers cite numbered evidence, verify every number against retrieved text, and fall back to cleaned extractive evidence when the local model is unavailable or fails validation.
- Generated text is rendered through DOM nodes only. Retrieved tables remain real HTML tables, with generated summaries above them.

## Run locally

Requires Node.js 20 or newer and npm.

```sh
npm install
npm run dev
npm test
npm run build:index
npm run build
```

`npm run dev` uses `vite.folio.config.ts`, which also provides the existing Folio development/preview middleware and model proxy. `npm run build` does not regenerate the prepared index. Run `npm run build:index` after changing the PDFs.

## Project structure

- `src/App.tsx`: Folio shell, library, sessions, settings, and Smart Bot entry point.
- `src/QuickBot.tsx`: Smart Bot screen, greeting, demo questions, answer blocks, citations, and voice controls.
- `src/styles.css`: Folio visual system, responsive layout, tables, voice states, and mobile behavior.
- `src/engine/`: hybrid search, query analysis, coverage rules, section expansion, answer filters, tables, and embedding worker.
- `src/useVoiceInput.ts`: Web Speech API hook, preferences, transcript cleanup, and error mapping.
- `scripts/build-index.ts`: extracts PDFs and generates the committed search index.
- `scripts/test-detailed-queries.ts`: read-only detailed-answer query report.
- `public/pdfs/`: the three source brochures served for citations.
- `public/index.json`: committed chunks, tables, qualifiers, vocabulary, and embeddings.
- `api/`: server-only provider integration, availability status, and the grounded conversation SSE route. API keys never enter the browser.
- `vercel.json`: Vercel function limits and security headers.

## Source PDFs and index updates

Expected files:

- `Admission_Modality_FD.pdf`
- `BITSAT-2026_brochure.pdf`
- `HD_Brochure_2025_26.pdf`

Replace files in `public/pdfs/` using those exact names, then run:

```sh
npm run build:index
npm test
npm run build
```

Commit replacement PDFs and `public/index.json` together. The current PDFs are below GitHub's 50 MB review threshold and 100 MB hard limit; use Git LFS for any future source above 50 MB. PDF citations use `import.meta.env.BASE_URL` and open the cited page with `#page=N`.

## Detailed answers

The index stores section titles, chunk neighbors, chunk type, table rows, page ranges, and nearby qualifiers. Detailed mode expands the best routed section up to about 900 words. Tables render as HTML tables, lists render as bullets, and each answer can reveal the cleaned original passage. Every number shown in a structured table must also occur in its source passage.

If a PDF table is image-based or cannot be reconstructed reliably, the answer remains extractive text and does not invent values. Add retrieval synonyms and routing rules in `src/engine/config.ts`.

## Voice input

Voice input uses the browser Web Speech API. It supports English India (`en-IN`) and Hindi (`hi-IN`), remembers the language, and stores the auto-send preference in local storage. Spoken forms such as "bit sat", "M.E.", "M.Pharm", and "twenty twenty six" are normalized before retrieval.

Chrome, Edge, and Android Chrome are best supported. Firefox does not expose the required API and Safari support is partial. Browser speech recognition may send audio to the browser vendor's service; voice is not offline. Typed questions stay in the browser. Fully offline Whisper transcription is a future TODO and is not included.

## Environment and Vercel

The PDF engine requires no API key or new environment variable. Existing optional Folio online mode recognizes these server-side variable names:

- `Groq_Api`
- `Gemini_Api`
- `GROQ_MODEL`
- `GEMINI_MODEL`
- `ONLINE_PRIMARY_PROVIDER`

Never use `VITE_` variables for secrets. Configure optional online-mode variables in Vercel Project Settings; `.env` is local-only and ignored. Vercel serves the static index and PDFs from `public/` and builds with `npm run build`.

## Debugging, tests, and rollback

Internal coverage, score, mode, and passage details appear only with `?debug=1`. Normal answers show the answer, citations, structured content, and follow-up chips.

Run the detailed query report with:

```sh
node --import tsx scripts/test-detailed-queries.ts
```

Run the 20-question Smart Bot retrieval evaluation offline:

```sh
node --import tsx scripts/evaluate-quick-bot.ts
```

This reports source-document hit@3 and source-page hit@3 separately. It loads the optional local `.env` only to report credential presence and model IDs; presence does not validate credentials or provider access. The evaluation remains offline unless explicitly run with `--live`:

```sh
node --import tsx scripts/evaluate-quick-bot.ts --live
```

The `--live` command prints the planned providers, models, request count, and usage warning before making any provider requests. `scripts/test-conversation.ts` follows the same rule and requires `--live` for provider calls.

The protected rollback tag is `backup-smartbot-before-replace`. After a merged change, rollback can use `git revert` or redeploy that tag in Vercel.

## Smart Quick Bot local architecture

The Smart Quick Bot path is: intent router -> follow-up rewrite -> hybrid embedding/BM25 retrieval -> section and table expansion -> local WebLLM generation -> citation and number validation -> safe UI. It uses only the three packaged BITS PDFs. It never calls Groq, Gemini, `/api/conversation`, or another hosted LLM. Greetings and unsupported questions do not initialize the local generator.

The selected model is automatic: `SmolLM2-135M-Instruct-q0f32-MLC` (approximately 170 MB cached download and 280 MB runtime estimate) is used on Android, low-memory, or uncertain devices; capable desktop/laptop browsers with WebGPU, at least 8 GB reported device memory, and at least 8 hardware threads use `SmolLM2-360M-Instruct-q4f32_1-MLC` (approximately 230 MB cached download and 580 MB runtime estimate). The 1B model is not selected automatically. Estimates are approximate; browser GPU allocation varies.

WebLLM is loaded only after the user presses **Prepare local model**. Model files are cached by the browser and are not bundled into Vercel. The first visit still needs network access to download the site, embedding assets, and selected model. After those assets are cached, retrieval and generation run locally. WebGPU is required for generation; if it is unavailable, the bot returns grounded extractive evidence instead. A failed local generation disables further attempts for the session until the user deliberately retries preparation. Use the unload control in the main app's local-model settings when available to release runtime memory without deleting cached files.

The retrieval regression target remains source hit@3 `19/20` and source-page hit@3 `19/20`. Run `node --import tsx scripts/evaluate-quick-bot.ts` for the offline retrieval report. Local model answer quality requires a real WebGPU-capable browser run; mocked tests do not establish factual model quality.

## Privacy and assumptions

Folio library, uploads, local model settings, voice controls, and the separate legacy main-chat features remain distinct. Smart Quick Bot searches only the three packaged BITS PDFs and never searches uploaded session PDFs. Typed questions and local generation stay in the browser after required assets are cached; browser speech recognition may process audio through its vendor service.
