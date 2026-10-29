@echo off
chcp 65001 >nul
cd /d "%~dp0"
set DEST=%USERPROFILE%\Desktop\chaldea2bb

rem 开发用快捷方式：构建 -> 同步到桌面 -> 启动。
rem 之所以要同步到桌面：某些环境下直接在项目目录里运行打包好的 exe 会被 WebView2 拦下，
rem 换个目录就正常。普通用户不需要这个脚本，用 build.cmd 的产物或 Release 包即可。

call build.cmd
if errorlevel 1 goto :err

if not exist "%DEST%" mkdir "%DEST%"
rem 清掉产物里已经不带的文件（配置打进 resources.neu 了，外面那份不生效）
del /q "%DEST%\neutralino.config.json" >nul 2>nul
del /q "%DEST%\neutralinojs.log" >nul 2>nul
xcopy "app\dist\chaldea2bb\*" "%DEST%\" /Y /Q >nul

start "" "%DEST%\chaldea2bb-win_x64.exe"
exit /b 0

:err
pause
exit /b 1
