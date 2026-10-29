@echo off
chcp 65001 >nul
cd /d "%~dp0"
set DEST=%USERPROFILE%\Desktop\chaldea2bb

echo [1/3] 打包界面脚本...
call npm run bundle --silent || goto :err

echo [2/3] 生成资源包...
pushd app
call npx neu build || (popd & goto :err)
popd

echo [3/3] 同步到桌面...
if not exist "%DEST%" mkdir "%DEST%"
copy /y "app\dist\chaldea2bb\resources.neu" "%DEST%\resources.neu" >nul
copy /y "app\bin\chaldea2bb-win_x64.exe" "%DEST%\chaldea2bb-win_x64.exe" >nul
copy /y "app\neutralino.config.json" "%DEST%\neutralino.config.json" >nul
rem 分发件要带许可与第三方声明（Neutralino 是 MIT，要求保留声明）
copy /y "LICENSE" "%DEST%\LICENSE" >nul
copy /y "NOTICE.md" "%DEST%\NOTICE.md" >nul

start "" "%DEST%\chaldea2bb-win_x64.exe"
exit /b 0

:err
echo 构建失败，请检查 node/npm 是否可用。
pause
exit /b 1