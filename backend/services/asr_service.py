"""ASR 服务占位（下一步再接 qwen3-asr-flash）。"""


class AsrService:
    def __init__(self) -> None:
        self.provider = "qwen_cloud_http"

    def transcribe(self, audio_path: str) -> dict:
        raise NotImplementedError("Next step: wire qwen3-asr-flash HTTP here")
