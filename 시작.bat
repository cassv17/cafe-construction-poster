@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 카페 공사중 자동 발행

if not exist node_modules (
  echo   처음 실행입니다. 필요한 것을 설치합니다 (1~2분)...
  call npm install
)

echo.
echo   카페 공사중 자동 발행
echo   ------------------------------------
echo   서버를 켭니다. 이 창을 닫으면 종료됩니다.
echo   브라우저가 저절로 열리지 않으면 http://localhost:4174 로 접속하세요.
echo.

start "" cmd /c "timeout /t 3 >nul & start http://localhost:4174"

node server.js

echo.
echo   서버가 종료되었습니다.
pause
