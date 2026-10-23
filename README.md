# Smart Bot — BITS PDF assistant

Smart Bot keeps the Folio interface and branding while its prepared-document mode uses a client-side BITS PDF engine. It searches the three official brochures with hybrid embedding + BM25 retrieval, classifies coverage as `FULL`, `PARTIAL`, `ASPECT_ONLY`, or `NONE`, and returns extractive answers with file/page citations. List/table questions can expand into section-aware tables, qualifiers, source links, and original passages; yes/no questions stay short. It does not send Smart Bot questions to an online provider.

## Run locally

Requires Node.js 20+ and npm.

```sh
npm install
npm run dev
npm run build:index
npm run build
```

`npm run dev` uses `vite.folio.config.ts`, which preserves the existing Folio local API middleware and Hugging Face model proxy used by the broader app. `npm run build` does not regenerate the prepared index. Run `npm run build:index` only after replacing PDFs.

## Project structure

- `src/App.tsx`, `src/styles.css`, and `src/QuickBot.tsx`: existing Folio UI, branding, responsive layout, and Smart Bot screen.
- `src/engine/`: BITS hybrid retrieval, query analysis, coverage rules, answer builder, and embedding worker.
- `src/useVoiceInput.ts`: optional Web Speech API voice input, transcript normalization, language selection, and auto-send preference.
- `scripts/build-index.ts`: parses `public/pdfs/` and creates `public/index.json`.
- `public/pdfs/`: the three committed source brochures served for citations.
- `public/index.json`: committed searchable chunks, vocabulary, and embeddings.
- `vite.folio.config.ts`: the existing Vite config plus development/preview middleware and the Hugging Face asset proxy.

## Updating the PDFs

Replace the files in `public/pdfs/` using the exact expected filenames, then run:

```sh
npm run build:index
npm run build
```

Commit both the PDFs and `public/index.json`. The PDFs are currently below GitHub's 50 MB review threshold and 100 MB hard limit; use Git LFS if a future source exceeds 50 MB.

PDF links use `import.meta.env.BASE_URL` and open the cited page with `#page=N`.

## Detailed answers and voice input

The index stores section titles, chunk neighbors, chunk type, table rows, page ranges, and nearby qualifiers. Detailed mode expands the best section up to about 900 words and renders tables horizontally scrollable on small screens. Every figure shown in a table must also occur in the cleaned source passage. “View original passage” exposes the exact cleaned extractive text.

The prepared index and embedding worker begin loading in the background when the Folio site mounts, so Smart Quick Bot is usually ready before it is opened. This warm-up is non-blocking and the model is cached by the browser after the first load.

The microphone uses the browser Web Speech API when available. English India (`en-IN`) and Hindi (`hi-IN`) are supported, with auto-send enabled by default and saved in local storage. Retrieval is English-only; Hindi recognition is accepted, but results work best when the transcript contains English terms. Chrome/Edge and Android Chrome are the best-supported browsers; Firefox does not expose the required API and Safari support is partial. Browser speech recognition may send audio to the browser vendor’s service (Chrome commonly uses Google), so voice is not claimed to be offline. Typed questions remain client-side.

Add retrieval synonyms in `src/engine/config.ts` under `SYNONYM_MAP`. Add spoken-form replacements under `VOICE_NORMALIZATION`. Fully offline Whisper transcription is intentionally left as a future TODO; it is not built into this release.

## Environment and Vercel

The new PDF engine requires no API key or new environment variable. The existing Folio online mode still recognizes these server-side variable names if that separate feature is enabled:

- `Groq_Api`
- `Gemini_Api`
- `GROQ_MODEL`
- `GEMINI_MODEL`
- `ONLINE_PRIMARY_PROVIDER`

Never use `VITE_` variables for secrets. Configure any existing online-mode variables in Vercel Project Settings; `.env` is local-only and ignored. Import the repository into Vercel and use the branch preview deployment for testing. No production deployment is part of this change.

## Debugging and rollback

Internal coverage, score, and passage counts appear only with `?debug=1`. Normal answers show only the answer, citations, and follow-up chips.

The protected rollback tag is `backup-smartbot-before-replace`. To restore the pre-change state locally, create a recovery branch from that tag. After an approved merge, rollback can use `git revert` on the merge or redeploy the backup tag in Vercel.

## Assumptions

The existing Folio library, uploads, local model settings, voice controls, and online mode are separate app features and remain intact. “Old smart bot logic/data” means the previous prepared Quick Bot index, model, training scripts, and `Data/` PDFs; they were removed from the branch after the rollback tag was created. The untracked legacy `Data/` PDFs were moved to a temporary system backup before removal.
