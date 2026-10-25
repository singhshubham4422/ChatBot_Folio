from __future__ import annotations
import math, re
from collections import Counter

def tokens(text): return re.findall(r"[a-z0-9]+", text.lower())

class BM25Search:
    def __init__(self, chunks):
        self.chunks = chunks; self.docs = [tokens(x["text"]) for x in chunks]; self.avg = sum(map(len, self.docs)) / max(1, len(self.docs))
        self.df = Counter(t for d in self.docs for t in set(d))
    def search(self, query, k=5, filters=None):
        q = tokens(query); n = len(self.docs); scored = []
        for i, doc in enumerate(self.docs):
            if filters and not all(self.chunks[i].get(a) == b for a, b in filters.items()): continue
            tf = Counter(doc); score = 0.0
            for term in q:
                if term in tf:
                    idf = math.log(1 + (n - self.df[term] + .5) / (self.df[term] + .5))
                    score += idf * tf[term] * 2.5 / (tf[term] + 1.5 * (.25 + .75 * len(doc) / max(1, self.avg)))
            if score: scored.append((score, self.chunks[i]))
        return sorted(scored, key=lambda x: x[0], reverse=True)[:k]
