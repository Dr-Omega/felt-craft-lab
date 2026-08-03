@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo 请先双击运行一次 启动第1步.bat，创建虚拟环境。
  pause
  exit /b 1
)

echo.
echo === 只检查文案，不调用 MiniMax，不花钱 ===
echo.
.venv\Scripts\python.exe tools\fixed_tts\batch_fixed_tts.py --dry-run
echo.
pause
