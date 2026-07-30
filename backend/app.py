"""
统一 AI 服务后端（安全代理）— 第 1 步

目标：
1. 前端永远不放真实 API Key
2. 所有云服务密钥只从本机 .env 读取
3. 先提供健康检查；ASR / QA / TTS 后面一步步接
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__)


def _mask(value: str | None) -> str:
    """只显示密钥是否已配置，绝不把密钥返回给前端。"""
    if not value:
        return "missing"
    if len(value) <= 8:
        return "set"
    return f"set({value[:2]}***{value[-2:]})"


@app.get("/api/health")
def health():
    return jsonify(
        {
            "ok": True,
            "service": "felt-craft-lab-ai-proxy",
            "version": "step1",
            "env": os.getenv("APP_ENV", "development"),
            "keys": {
                "qwen_asr": _mask(os.getenv("QWEN_ASR_API_KEY")),
                "deepseek": _mask(os.getenv("DEEPSEEK_API_KEY")),
                "minimax": _mask(os.getenv("MINIMAX_API_KEY")),
            },
            "providers_ready": {
                "asr": ["qwen_cloud_http"],
                "qa": ["deepseek"],
                "tts": ["minimax"],
            },
        }
    )


@app.get("/api/ready")
def ready():
    return jsonify({"ready": True, "step": 1})


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8788"))
    app.run(host="127.0.0.1", port=port, debug=True)
