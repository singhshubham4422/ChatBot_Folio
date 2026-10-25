from __future__ import annotations
import json, math, re
from pathlib import Path

class VectorStore:
    def __init__(self, chunks, embeddings=None, model_name="lexical-fallback", embedder=None):
        self.chunks, self.model_name = chunks, model_name; self.embeddings = embeddings; self.embedder = embedder
        self.faiss_index = None
    @staticmethod
    def _vec(text):
        d = {}
        for t in re.findall(r"[a-z0-9]+", text.lower()): d[t] = d.get(t, 0) + 1
        norm = math.sqrt(sum(x*x for x in d.values())) or 1
        return {k: v/norm for k,v in d.items()}
    def search(self, query, k=5, filters=None):
        if self.faiss_index is not None and self.embedder is not None:
            try:
                import numpy as np
                q=np.asarray(self.embedder.encode([query]), dtype="float32")
                _, indices=self.faiss_index.search(q, min(k, len(self.chunks)))
                found=[]
                for rank, i in enumerate(indices[0]):
                    if i < 0: continue
                    c=self.chunks[int(i)]
                    if filters and not all(c.get(a)==b for a,b in filters.items()): continue
                    found.append((1.0/(rank+1), c))
                return found
            except Exception:
                pass
        q = self._vec(query); out=[]
        for c in self.chunks:
            if filters and not all(c.get(a)==b for a,b in filters.items()): continue
            v=self._vec(c["text"]); score=sum(q.get(x,0)*v.get(x,0) for x in q)
            if score: out.append((score,c))
        return sorted(out,key=lambda x:x[0],reverse=True)[:k]
    def save(self, directory: Path):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        (directory/"metadata.json").write_text(json.dumps({"model":self.model_name,"chunks":self.chunks}, ensure_ascii=False), encoding="utf-8")
        (directory/"vectors.json").write_text(json.dumps([self._vec(c["text"]) for c in self.chunks]), encoding="utf-8")
        if self.embeddings is not None:
            try:
                import faiss, numpy as np
                arr=np.asarray(self.embeddings, dtype="float32"); self.faiss_index=faiss.IndexFlatIP(arr.shape[1]); self.faiss_index.add(arr)
                faiss.write_index(self.faiss_index, str(directory/"index.faiss"))
            except Exception:
                pass
    @classmethod
    def load(cls, directory: Path, embedder=None):
        directory = Path(directory)
        data=json.loads((directory/"metadata.json").read_text(encoding="utf-8")); out=cls(data["chunks"], model_name=data["model"], embedder=embedder)
        try:
            import faiss
            if (directory/"index.faiss").exists(): out.faiss_index=faiss.read_index(str(directory/"index.faiss"))
        except Exception: pass
        return out
