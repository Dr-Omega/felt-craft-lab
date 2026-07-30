"""问答服务占位（后面再接 DeepSeek）。"""


class QaService:
    def ask(self, text: str, material_id: str | None = None) -> dict:
        raise NotImplementedError("Later step: wire DeepSeek here")
