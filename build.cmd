@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [1/2] 打包界面脚本...
call npm run bundle --silent || goto :err

echo [2/2] 生成资源包...
pushd app
call npx neu build || (popd & goto :err)
popd

rem 配置是打进 resources.neu 的（外面这份即使改了也不生效），所以产物里不留它，避免误导
del /q "app\dist\chaldea2bb\neutralino.config.json" >nul 2>nul
del /q "app\dist\chaldea2bb\neutralinojs.log" >nul 2>nul
rem Neutralino 是 MIT，分发件要带许可与第三方声明
copy /y "LICENSE" "app\dist\chaldea2bb\LICENSE" >nul
copy /y "NOTICE.md" "app\dist\chaldea2bb\NOTICE.md" >nul

echo.
echo 产物：app\dist\chaldea2bb\
echo 整个文件夹可以直接拷走，或压成 zip 发布。
exit /b 0

:err
echo 构建失败，请检查 node/npm 是否可用。
exit /b 1
