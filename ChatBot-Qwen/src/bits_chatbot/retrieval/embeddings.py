from __future__ import annotations
class Embedder:
    def __init__(self, model_name):
        self.model_name=model_name; self.model=None
        try:
            from sentence_transformers import SentenceTransformer
            self.model=SentenceTransformer(model_name, device="cpu")
        except Exception: pass
    def encode(self, texts):
        if self.model is None: return None
        return self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
