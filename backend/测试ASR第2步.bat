@echo off
cd /d "%~dp0"
call .venv\Scripts\activate.bat
echo === 先测 Mock（不花额度）===
python test_asr.py mock
echo.
echo === 再测真实 Qwen（会调用云端）===
python test_asr.py real
pause
