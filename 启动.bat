@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   🍓 小米减肥日记
echo   正在启动...
echo.
node server\index.mjs
if errorlevel 1 (
  echo.
  echo   [x] 启动失败。看看上面报了什么错。
  echo       常见原因：没装 Node.js，或者 4321 端口被占用了。
  echo.
)
pause
