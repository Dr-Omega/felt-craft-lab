@echo off
cd /d "%~dp0"
echo [1/3] Creating venv if needed...
if not exist .venv (
  python -m venv .venv
)
call .venv\Scripts\activate.bat
echo [2/3] Installing deps...
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example
)
echo [3/3] Starting AI proxy on http://127.0.0.1:8788/
python app.py
pause
