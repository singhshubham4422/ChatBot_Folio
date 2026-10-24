# SmartBot Retrieval Evaluation Report

Generated: 2026-10-24T14:23:05.573Z

## Summary Metrics

| Evaluation Category | Test Queries | Success Count | Metric Value | False-Match Rate |
| :--- | :---: | :---: | :---: | :---: |
| **Held-Out Factual Paraphrases** | 80 | 80 | **100.0%** Top-1 Accuracy | 0.0% |
| **Broad Ambiguous Queries** | 10 | 10 | **100.0%** Clarification Rate | **0.0%** |
| **Out-of-Domain Unknown Queries** | 10 | 10 | **100.0%** Rejection Rate | **0.0%** |
| **Total Test Suite** | **100** | **100** | **100.0%** Overall Compliance | **0.0%** |

## Key Findings

1. **Deterministic Top-1 Accuracy:** 80/80 (100.0%) held-out paraphrased queries matched the exact canonical or alias FAQ record.
2. **Ambiguity Prevention:** 10/10 (100.0%) broad multi-programme questions correctly triggered clarification chips instead of returning an ungrounded or arbitrary guess.
3. **Out-of-Domain Guardrails:** 10/10 (100.0%) non-admissions questions were rejected with zero false-positive matches.
4. **Source Grounding:** All citations correspond directly to verified admissions brochures with page numbers.
