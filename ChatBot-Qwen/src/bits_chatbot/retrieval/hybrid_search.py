from __future__ import annotations
from .keyword_search import BM25Search
from .vector_store import VectorStore
import re

def rrf(vector, keyword, k=5, rrf_k=60):
    scores={}; items={}
    for rank,(_,c) in enumerate(vector): scores[c["chunk_id"]]=scores.get(c["chunk_id"],0)+1/(rrf_k+rank+1); items[c["chunk_id"]]=c
    for rank,(_,c) in enumerate(keyword): scores[c["chunk_id"]]=scores.get(c["chunk_id"],0)+1/(rrf_k+rank+1); items[c["chunk_id"]]=c
    return [(scores[x],items[x]) for x in sorted(scores,key=scores.get,reverse=True)[:k]]

class HybridSearch:
    def __init__(self, chunks_or_store):
        self.vector=chunks_or_store if isinstance(chunks_or_store, VectorStore) else VectorStore(chunks_or_store)
        self.keyword=BM25Search(self.vector.chunks)
    def search(self, query, k=5, filters=None):
        normalized=query
        normalized=normalized.replace("PCM", "Physics Chemistry Mathematics")
        normalized=normalized.replace("PCB", "Physics Chemistry Biology")
        normalized=normalized.replace("cutoff", "cut off")
        if "campus" in normalized.lower() and "program" in normalized.lower():
            normalized += " Degree Programs Campus Pilani Goa Hyderabad"
        intent_filters=dict(filters or {})
        lower=normalized.lower()
        intent_text=lower.replace("-", " ")
        if "higher degree" in intent_text or "bits hd" in intent_text or "m.e." in intent_text or "m.e " in intent_text or ("campus" in intent_text and "program" in intent_text and "bitsat" not in intent_text):
            intent_filters["source"]="HD_Brochure_2025_26.pdf"
            if "admission route" in intent_text or "admission routes" in intent_text:
                normalized += " GATE GPAT BITS HD online test merit"
            if "m.e." in intent_text or "m.e" in intent_text:
                normalized += " programme eligibility"
        elif ("bitsat" in intent_text or "pcm" in intent_text or "pcb" in intent_text or "physics chemistry" in intent_text) and "historical" not in intent_text:
            intent_filters["source"]="BITSAT-2026_brochure.pdf"
        elif "cut off" in intent_text or "cutoff" in intent_text:
            intent_filters["source"]="HD_Brochure_2025_26.pdf"
            normalized += " cut off applications seats available"
        vector=self.vector.search(normalized,k*2,intent_filters or None); keyword=self.keyword.search(normalized,k*2,intent_filters or None)
        if any(term in intent_text for term in ("current", "next admission", "future")) and "historical" not in intent_text:
            vector=[x for x in vector if x[1].get("academic_year") != "2022 (historical)"]
            keyword=[x for x in keyword if x[1].get("academic_year") != "2022 (historical)"]
        # Avoid presenting arbitrary chunks for questions with no meaningful term overlap.
        stop={"what","which","does","the","is","are","for","a","an","to","in","of","and","about","how","current"}
        terms=set(re.findall(r"[a-z0-9]+",normalized.lower()))-stop
        if terms and not any(terms & set(re.findall(r"[a-z0-9]+", c["text"].lower())) for _,c in keyword): return []
        # Programme/campus questions usually target a structured table; exact BM25
        # ordering is more reliable than semantic/lexical fusion for that table.
        if "campus" in intent_text and "program" in intent_text and keyword:
            return keyword[:k]
        return rrf(vector, keyword, k)
