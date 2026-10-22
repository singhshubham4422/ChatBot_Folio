# Retrieval evaluation report

Date: 2026-10-22  
Command: `npm run evaluate`

## Fixed-set result

- Corpus: one six-page synthetic document with direct facts, a numerical table, contradictory figures, an OCR-tagged page and absent facts.
- Questions: 30 total; 26 answerable retrieval questions, 3 absent-answer questions and 1 deterministic page-count question.
- Supporting-page hit@4: **26/26 (100%)**. A hit means at least one manually labeled supporting page appeared in the top four BM25 chunks.
- No-overlap abstention checks: **3/3** returned no passages.
- The separate deterministic test answers page count from stored metadata without model routing.

## Interpretation

This checks BM25 ranking and basic no-overlap abstention on a small, controlled fixture. It does not measure whether an LLM answers correctly, whether every citation is sufficient, OCR quality on real scans, performance on large PDFs, or hardware latency and memory. The fixture is synthetic because the repository contained no representative PDFs. Do not interpret this score as expected performance on arbitrary documents.
