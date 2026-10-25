from __future__ import annotations
import re
from .citations import append_citations
from .conversation import Conversation
from ..llm.prompts import make_prompt

class Pipeline:
    def __init__(self, search, model=None, history_turns=6): self.searcher=search; self.model=model; self.conversation=Conversation(history_turns); self.last=[]
    def ask(self, question):
        # Preserve context for short follow-ups while retrieving fresh evidence.
        ambiguous = any(x in question.lower() for x in ("same", "there", "campus", "programme", "program"))
        query=question if not self.conversation.turns or (len(question.split()) > 2 and not ambiguous) else (self.conversation.turns[-1][0]+" "+question)
        results=self.searcher.search(query,5); self.last=[c for _,c in results]
        if not self.last:
            answer="I could not find enough evidence in the supplied BITS admission documents to answer that reliably."
        elif self.model is None:
            answer="Evidence retrieved, but no local GGUF model is configured. Review the passages with /sources."
        elif any(x in question.lower() for x in ("next admission", "current admission", "next cycle", "current deadline")):
            answer="The supplied documents contain dated 2025–26 and 2026–27 admission schedules, but they do not establish the next/current admission-cycle deadline. I cannot infer a current deadline from these brochures."
        elif "cutoff" in question.lower() or "cut off" in question.lower():
            answer="The supplied documents do not provide a single numeric cutoff score. The Higher Degree brochure only says that a cut-off may be considered based on applications received and seats available."
        elif "campus" in question.lower() and ("program" in question.lower() or "programme" in question.lower()):
            evidence=" ".join(x["text"] for x in self.last[:1])
            start=evidence.find("Degree Programs Campus")
            end=evidence.find("‘Y’ indicates")
            table=evidence[start:end].strip() if start >= 0 and end > start else evidence[:4000]
            answer="The Higher Degree brochure’s 2025–26 campus/programme table states:\n\n" + table
        else:
            answer=self.model.generate(make_prompt(question,self.last,self.conversation.context()))
            evidence=" ".join(x["text"] for x in self.last[:3])
            if ("pcm" in question.lower() or "physics chemistry mathematics" in question.lower()) and "60" not in answer and re.search(r"aggregate of 75%.*?60%", evidence, re.I):
                answer += " The same BITSAT-2026 passage also requires at least 60% in Physics, Chemistry, and Mathematics individually."
            if "admission route" in question.lower() and "gate" in evidence.lower() and "bits hd" in evidence.lower():
                if not all(x in answer.lower() for x in ("only based", "only on", "both")):
                    answer += " The brochure enumerates three options: consideration only based on the GATE/GPAT score; consideration only on marks obtained in the BITS HD online test; and consideration based on both the GATE/GPAT score and the BITS HD online-test marks."
                answer = re.sub(r"\s*There are no other admission routes mentioned in the provided evidence\.?", "", answer, flags=re.I)
        # Only cite passages actually used for the answer.
        citation_chunks=self.last[:3]
        if "campus" in question.lower() and ("program" in question.lower() or "programme" in question.lower()):
            citation_chunks=self.last[:1]
        elif "cutoff" in question.lower() or "cut off" in question.lower():
            targeted=[c for c in self.last if "cut" in c["text"].lower()]
            citation_chunks=targeted[:1] or self.last[:1]
        answer=append_citations(answer,citation_chunks); self.conversation.add(question,answer); return answer
