@echo off
cd /d "%~dp0"
set "PYTHON_EXE=C:\Python314\python.exe"
if not exist "%PYTHON_EXE%" (
  echo Python not found: %PYTHON_EXE%
  pause
  exit /b 1
)
echo [1/3] Using %PYTHON_EXE%
echo [2/3] Installing deps...
"%PYTHON_EXE%" -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example
)
echo [3/3] Starting AI proxy on http://127.0.0.1:8788/
"%PYTHON_EXE%" app.py
pause
