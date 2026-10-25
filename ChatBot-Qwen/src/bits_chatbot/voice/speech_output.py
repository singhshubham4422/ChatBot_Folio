from __future__ import annotations

import re
import threading


class SpeechOutput:
    """Optional offline Windows SAPI TTS adapter."""

    def __init__(self):
        self.engine = None
        self.error = None
        self._lock = threading.Lock()
        try:
            import pyttsx3
            self.engine = pyttsx3.init()
        except Exception as exc:
            self.error = str(exc)

    @property
    def available(self):
        return self.engine is not None

    @staticmethod
    def spoken_text(text):
        text = re.sub(r"\[Source:[^\]]+\]", "", text)
        return re.sub(r"\s+", " ", text).strip()

    def speak(self, text, asynchronous=True):
        if not self.engine:
            return False
        spoken = self.spoken_text(text)
        if not spoken:
            return False

        def run():
            try:
                with self._lock:
                    self.engine.say(spoken)
                    self.engine.runAndWait()
            except Exception as exc:
                self.error = str(exc)

        if asynchronous:
            threading.Thread(target=run, name="bits-tts", daemon=True).start()
        else:
            run()
        return True
