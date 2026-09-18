@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   ============================================
echo    实验室网站内容编辑器
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没有找到 Node.js。
  echo.
  echo   这个编辑器需要 Node.js 才能运行，请先安装：
  echo     https://nodejs.org/   ^(下载 LTS 版本，一路下一步即可^)
  echo.
  echo   安装完成后重新双击本文件。
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo   Node.js 版本：%NODEVER%

if exist ".bin\hugo.exe" (
  echo   Hugo：.bin\hugo.exe
) else (
  where hugo >nul 2>nul
  if errorlevel 1 (
    echo   [提示] 没有找到 hugo，编辑器可以正常改内容，但右侧预览和「校验构建」不可用。
    echo          如需预览，请把 hugo.exe 放到 .bin\ 目录，或安装到系统 PATH。
  ) else (
    echo   Hugo：系统 PATH
  )
)

rem ---- 如果已经有编辑器在运行，就直接打开它，不要再开一个 ----
set RUNPORT=
for /f "delims=" %%p in ('node "tools\editor\find-running.mjs" 2^>nul') do set RUNPORT=%%p
if not "%RUNPORT%"=="" (
  echo.
  echo   检测到编辑器已经在运行（端口 %RUNPORT%），直接为你打开浏览器。
  echo   如果想重启，请先关闭之前那个命令行窗口，再运行本文件。
  echo.
  start "" http://127.0.0.1:%RUNPORT%/admin/
  timeout /t 3 >nul
  exit /b 0
)

echo.
echo   正在启动，请稍候（首次启动预览约 10 秒）...
echo   浏览器会自动打开；如果没有，请手动访问命令行窗口中显示的地址。
echo.

node "tools\editor\server.mjs" --open %*

echo.
echo   编辑器已退出。
pause
