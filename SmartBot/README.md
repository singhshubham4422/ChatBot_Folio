# SmartBot Knowledge Base & Retrieval System

SmartBot is the local-first, deterministic admissions assistant for Birla Institute of Technology & Science (BITS Pilani). It delivers instant, verified answers derived directly from official BITS admission brochures without generative hallucination, privacy leaks, or external API reliance.

---

## 1. Directory Structure

All SmartBot assets, datasets, scripts, test suites, and source materials are organized in this dedicated root directory:

```
SmartBot/
├── README.md                      # Documentation & architecture guide
├── data/                          # Canonical single source of truth
│   ├── faq_dataset.jsonl          # 1,000 verified admission FAQs
│   ├── chatbot_intents.jsonl      # Conversational intents & navigation
│   └── chatbot_config.json        # Routing configuration & response policy
├── scripts/                       # Maintenance & validation scripts
│   ├── build_faq.py               # Canonical FAQ generation pipeline
│   ├── sync_data.ts               # Synchronization script to public/data/
│   └── validate_faq.ts            # Dataset integrity & citation validator
├── tests/                         # Retrieval evaluation & benchmarks
│   ├── retrieval_queries.json     # 100-query evaluation dataset
│   ├── retrieval_eval.test.ts     # Vitest automated retrieval evaluation
│   ├── retrieval_report.json      # Structured evaluation results
│   └── retrieval_report.md        # Human-readable evaluation report
└── source_materials/              # Canonical source documents & transcripts
    ├── Admission_Modality_FD (1).pdf
    ├── BITSAT-2026_brochure (1).pdf
    ├── HD_Brochure_2025_26 (1).pdf
    └── text/                      # Extracted raw text dumps
        ├── Admission_Modality_FD (1).txt
        ├── BITSAT-2026_brochure (1).txt
        └── HD_Brochure_2025_26 (1).txt
```

---

## 2. Single Source of Truth & Build Synchronization

- **Canonical Storage:** The canonical datasets reside exclusively in `SmartBot/data/`.
- **Automatic Synchronization:** To allow Vite and client browsers to load data via HTTP, `SmartBot/scripts/sync_data.ts` mirrors the canonical files to `public/data/`.
- **Integrated Tooling:**
  - `npm run build`: Synchronizes `SmartBot/data/` before TypeScript type-checking and bundling.
  - `npm run dev`: Automatically executes `sync_data.ts` on server launch, and Vite's dev plugin verifies integrity.
  - `npm run sync:data`: Manual sync trigger.

---

## 3. Dataset Specifications

### `faq_dataset.jsonl` (1,000 Records)
Every factual admission question is pre-indexed with strict schema constraints:
- `id`: Globally unique identifier (e.g. `BITSAT-2026-001-1`, `BITS-HD-2025-26-025-1`, `Cross-document-001-1`).
- `question`: Natural language question string (strictly unique across the entire dataset).
- `canonical_question` & `alternative_questions`: Paraphrases and query aliases.
- `answer`: Predefined, ground-truth answer extracted from the official text.
- `admission_year`: Specific academic cycle (`2026-27` for BITSAT, `2025-26` for Higher Degree, `2022-23` for First Degree, or `Multiple cycles`).
- `category`: Knowledge taxonomy (`eligibility`, `fees`, `dates`, `programmes`, `scholarships`, etc.).
- `source_files`, `source_pages`, `source_references`, `display_source`: Explicit page-level citations to official brochures.
- `intent_type`: Strictly `'factual_faq'`.

### `chatbot_intents.jsonl`
Defines 10 conversational actions:
1. `greeting` (`CONV-001`)
2. `farewell` (`CONV-002`)
3. `thanks` (`CONV-003`)
4. `help` (`CONV-004`)
5. `category_navigation` (`CONV-005`)
6. `category_selection` (`CONV-006`)
7. `follow_up_request` (`CONV-007`)
8. `source_request` (`CONV-008`)
9. `unknown_question` (`CONV-009`)
10. `currentness_warning` (`CONV-010`)

---

## 4. Deterministic Retrieval Engine

Retrieval in SmartBot is strictly deterministic and extractive:

1. **Exact & Alias Matching:** Incoming queries are normalized (NFKD unicode, whitespace collapse, punctuation stripping). Exact canonical matches receive score `1.0`, while alias forms receive `0.995`.
2. **Normalized Tokens & Synonyms:** Maps domain variants (`bit-sat` → `bitsat`, `M.E.` → `me`, `tuition/cost` → `fee`, `deadlines/timeline` → `date`, `stipend/waiver` → `scholarship`).
3. **TF-IDF & Term Weighting:** Computes term frequencies across the document pool using logarithmic inverse document frequency (IDF).
4. **False-Positive Prevention:** Rejects accidental lexical overlap when multi-word queries match only a single common token (e.g., preventing *"Who won the cricket match?"* from matching *"personal details match Aadhaar"*).
5. **Broad Ambiguity Detection:** Queries that lack programme indicators (e.g., *"What are the eligibility requirements?"*) automatically trigger structured clarification chips (`BITSAT-2026`, `Higher-Degree admissions 2025-26`, `First-Degree admissions 2022-23`) instead of returning an arbitrary guess.
6. **Context Persistence & Resolution:** When a user selects a programme chip or clarifies context, pending inquiries are immediately resolved with cited answers for that programme.
7. **Document Search Fallback:** If no FAQ satisfies confidence thresholds, SmartBot falls back to exact text chunk vector retrieval with citations, never generating ungrounded facts.

---

## 5. Measured Evaluation & Benchmarks

The benchmark suite in `SmartBot/tests/` evaluates 100 realistic queries across three distinct operational modes:

| Test Set | Sample Size | Objective | Measured Result | False-Match Rate |
| :--- | :---: | :--- | :---: | :---: |
| **Held-Out Paraphrases** | 80 | Top-1 retrieval accuracy across all brochure families | **100.0% (80/80)** | 0.0% |
| **Broad Ambiguous Queries** | 10 | Proper clarification without silent route selection | **100.0% (10/10)** | **0.0%** |
| **Out-of-Domain Inquiries** | 10 | Rejection of irrelevant questions without false match | **100.0% (10/10)** | **0.0%** |
| **Total Test Suite** | **100** | Full compliance with verification criteria | **100.0% (100/100)** | **0.0%** |

### Running Tests & Validation

```bash
# Validate dataset integrity, schema, and PDF citations
npm run validate:faq

# Run the 100-query retrieval benchmark suite
npm run test:retrieval

# Run full project test suite
npm test
```
