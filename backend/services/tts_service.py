"""TTS 服务占位（后面再接 MiniMax）。"""


class TtsService:
    def synthesize(self, text: str) -> dict:
        raise NotImplementedError("Later step: wire MiniMax Voice here")
