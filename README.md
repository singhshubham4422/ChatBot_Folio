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
- Smart Bot questions run without an online provider; typed questions stay in the browser.
- Rules-first intent routing handles greetings, thanks, goodbyes, bot questions, small talk, unsafe prompt-injection requests, and document questions before retrieval.
- The last six user/assistant turns are stored locally per Folio conversation. Follow-ups are rewritten into standalone queries before retrieval.
- Grounded answers stream through `api/conversation.ts`, cite numbered evidence, verify every number against retrieved text, and fall back to the structured extractive answer when providers fail, time out, rate-limit, or return untrusted output.
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

The protected rollback tag is `backup-smartbot-before-replace`. After a merged change, rollback can use `git revert` or redeploy that tag in Vercel.

## Conversational architecture

The request path is: intent router -> follow-up rewrite -> existing hybrid retrieval and section expansion -> grounded provider generation -> citation and number validation -> safe streamed UI. Greetings, thanks, goodbyes, bot questions, unrelated chat, unsafe prompt-injection requests, and `NONE` coverage do not call an LLM. Ambiguous topics use coverage disambiguation chips. Provider failure, missing keys, 429 responses, a timeout over 15 seconds, invalid citations, or unverified numbers use the extractive structured answer and a small excerpts note.

Generation defaults are configurable through `GROQ_MODEL`, `GEMINI_MODEL`, and `ONLINE_PRIMARY_PROVIDER`. The current free-plan choice is Groq `openai/gpt-oss-20b` first for fast concise answers, with Gemini `gemini-3.8-flash` as fallback. Groq's current free table lists 30 RPM, 1K requests/day, 8K TPM, and 200K tokens/day for the selected open models; Gemini free limits are model/project dependent and shown in AI Studio as RPM, TPM, and RPD.

To change persona or tone, edit the system prompt in `api/onlineProvider.ts`. To tune cheap routing, edit the regexes and entity carry-over rules in `src/engine/conversation.ts`. Keep provider model IDs in environment configuration when changing deployments; never put API keys in `VITE_` variables.

## Privacy and assumptions

Folio library, uploads, local model settings, voice controls, and optional online mode remain separate app features. Smart Bot searches only the three packaged BITS PDFs and never searches uploaded session PDFs. The legacy Smart Quick Bot index, model, training scripts, and `Data/` PDFs were removed from the replacement branch.
