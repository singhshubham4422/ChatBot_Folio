from __future__ import annotations

from pathlib import Path


class SpeechInput:
    """Optional bounded, offline microphone transcription.

    The model must be present locally. This class deliberately does not allow
    faster-whisper to download a model implicitly from the Hub.
    """

    def __init__(self, model_name="small.en", model_path=None, max_seconds=8, sample_rate=16000, allow_model_download=False):
        self.model_name = model_name
        self.model_path = Path(model_path) if model_path else None
        self.max_seconds = max(1, int(max_seconds))
        self.sample_rate = sample_rate
        self.allow_model_download = allow_model_download
        self.model = None

    def _load_model(self):
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError("Voice input unavailable: install faster-whisper and sounddevice in .venv.") from exc
        if self.model is not None:
            return self.model
        model_source = str(self.model_path) if self.model_path and self.model_path.exists() else None
        if model_source is None and not self.allow_model_download:
            location = self.model_path or Path("models") / self.model_name
            raise RuntimeError(f"Speech model is not installed locally at {location}. Download it explicitly before using /voice.")
        self.model = WhisperModel(model_source or self.model_name, device="cpu", compute_type="int8", cpu_threads=8)
        return self.model

    def transcribe(self):
        try:
            import numpy as np
            import sounddevice as sd
        except ImportError as exc:
            raise RuntimeError("Voice input unavailable: install faster-whisper and sounddevice in .venv.") from exc
        model = self._load_model()
        try:
            devices = sd.query_devices(kind="input")
            if devices is None:
                raise RuntimeError("No microphone input device is available.")
            print(f"Recording for up to {self.max_seconds} seconds. Press Ctrl+C to cancel.")
            audio = sd.rec(int(self.max_seconds * self.sample_rate), samplerate=self.sample_rate, channels=1, dtype="float32")
            sd.wait()
        except KeyboardInterrupt as exc:
            sd.stop()
            raise RuntimeError("Voice recording cancelled.") from exc
        except Exception as exc:
            raise RuntimeError(f"Microphone recording failed: {exc}") from exc
        samples = np.asarray(audio).reshape(-1)
        if samples.size == 0 or float(np.max(np.abs(samples))) < 0.005:
            raise RuntimeError("No speech detected in the recording.")
        try:
            segments, _ = model.transcribe(samples, beam_size=1, vad_filter=True)
            text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
        except Exception as exc:
            raise RuntimeError(f"Speech recognition failed: {exc}") from exc
        if not text:
            raise RuntimeError("Speech recognition returned no words.")
        return text
