from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from bits_chatbot.retrieval.vector_store import VectorStore
from bits_chatbot.retrieval.hybrid_search import HybridSearch

queries = [
    "BITSAT-2026 eligibility",
    "PCM aggregate and individual subject marks",
    "BITS HD admission through GATE GPAT versus BITS HD test",
    "M.E. Computer Science eligibility",
    "Which campuses offer the programmes listed in the Higher Degree brochure?",
    "What is the deadline for the next admission cycle?",
    "What is the cutoff if no cutoff is stated in the supplied documents?",
]

store = VectorStore.load(Path("Data/index"))
search = HybridSearch(store)
print("chunks:", len(store.chunks))
print("sources:", sorted({x["source"] for x in store.chunks}))
for query in queries:
    print("\n###", query)
    results = search.search(query, 3)
    print("hits:", len(results))
    for score, chunk in results:
        print(f"{chunk['source']} | PDF page {chunk['page_number']} | {chunk['academic_year']} | {chunk['text'][:280]}")
