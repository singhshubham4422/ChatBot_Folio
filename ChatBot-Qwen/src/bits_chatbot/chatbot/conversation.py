from __future__ import annotations
class Conversation:
    def __init__(self, max_turns=6): self.max_turns=max_turns; self.turns=[]
    def add(self,q,a): self.turns.append((q,a)); self.turns=self.turns[-self.max_turns:]
    def clear(self): self.turns.clear()
    def context(self): return "\n".join(f"User: {q}\nAssistant: {a}" for q,a in self.turns)
    def recent(self): return list(self.turns)
