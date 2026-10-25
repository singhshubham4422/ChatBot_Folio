from __future__ import annotations
import os

class LocalModel:
    def __init__(self, path, context_size=2048, threads=2, max_tokens=384):
        self.path=str(path); self.max_tokens=max_tokens; self.model=None
        if not os.path.exists(self.path): raise FileNotFoundError(f"Local GGUF model not found: {self.path}")
        try:
            from llama_cpp import Llama
            self.model=Llama(model_path=self.path,n_ctx=context_size,n_threads=threads,n_gpu_layers=0,verbose=False)
        except ImportError as exc: raise RuntimeError("Install llama-cpp-python to use local GGUF inference.") from exc
    def generate(self, prompt, temperature=0.1):
        if hasattr(self.model, "create_chat_completion"):
            result=self.model.create_chat_completion(
                messages=[{"role":"user", "content":prompt}],
                max_tokens=self.max_tokens,
                temperature=temperature,
            )
            return result["choices"][0]["message"]["content"].strip()
        result=self.model(prompt,max_tokens=self.max_tokens,temperature=temperature,stop=["\n\nQuestion:"])
        return result["choices"][0]["text"].strip()
