"""本地快速测 ASR：先 mock，再可选真实云端。"""
import json
import sys
from pathlib import Path

import requests

BASE = "http://127.0.0.1:8788"
SAMPLE_URL = "https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.mp3"


def main():
    mode = (sys.argv[1] if len(sys.argv) > 1 else "mock").strip()
    if mode == "mock":
        body = {"audioUrl": SAMPLE_URL, "provider": "mock"}
    else:
        body = {"audioUrl": SAMPLE_URL, "provider": "qwen_cloud_http", "language": "zh"}

    print("POST", BASE + "/api/asr/transcribe")
    print("body:", body)
    try:
        r = requests.post(BASE + "/api/asr/transcribe", json=body, timeout=90)
    except requests.RequestException as e:
        print("连接失败：请先双击 启动第1步.bat 让后端跑起来")
        print(e)
        input("按回车关闭...")
        return

    print("HTTP", r.status_code)
    try:
        print(json.dumps(r.json(), ensure_ascii=False, indent=2))
    except Exception:
        print(r.text)
    input("按回车关闭...")


if __name__ == "__main__":
    main()
