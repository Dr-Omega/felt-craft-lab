@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 第9步-固定语音批量生成

if not exist ".venv\Scripts\python.exe" (
  echo 请先双击运行一次 启动第1步.bat，创建虚拟环境。
  echo.
  pause
  exit /b 1
)

echo.
echo === 第 9 步：固定文案 TTS 批量生成 ===
echo 默认读取：tools\fixed_tts\scripts.example.csv
echo 输出目录：..\assets\generated\audio\
echo 正式 URL：felt-resource://audio/<id>.mp3
echo 日志文件：tools\fixed_tts\last_run.log
echo.
echo 接下来会调用 MiniMax（会用一点额度）。
echo 按任意键开始生成...
pause >nul

.venv\Scripts\python.exe tools\fixed_tts\batch_fixed_tts.py > "tools\fixed_tts\last_run.log" 2>&1
set ERR=%ERRORLEVEL%

echo.
echo ---------- 运行结果如下 ----------
type "tools\fixed_tts\last_run.log"
echo --------------------------------
echo.
if %ERR%==0 (
  echo 完成。请打开：
  echo   assets\generated\audio\
  echo Electron 正式播放 felt-resource://audio/...
  echo 浏览器辅助：http://127.0.0.1:8788/demo/fixed-audio
) else (
  echo 失败了。请把上面文字截图发给组长助手。
  echo 也可打开日志：tools\fixed_tts\last_run.log
)
echo.
echo 窗口不会自动关闭。看完后按任意键退出。
pause >nul
exit /b %ERR%
