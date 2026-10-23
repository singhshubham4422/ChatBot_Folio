# Smart Bot - BITS PDF assistant

Live trial: https://chat-bot-folio.vercel.app/

Smart Bot combines the Folio reading workspace and branding with a prepared, client-side BITS admissions assistant. It searches only the three committed official brochures using hybrid embedding and BM25 retrieval, coverage checks, section expansion, structured tables, and extractive answers with page citations.

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
- `api/`: existing optional Folio online-provider routes; Smart Bot does not call them.
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

## Privacy and assumptions

Folio library, uploads, local model settings, voice controls, and optional online mode remain separate app features. Smart Bot searches only the three packaged BITS PDFs and never searches uploaded session PDFs. The legacy Smart Quick Bot index, model, training scripts, and `Data/` PDFs were removed from the replacement branch.
