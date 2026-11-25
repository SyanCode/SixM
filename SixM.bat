@echo off
chcp 65001 >nul
title SixM
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est requis : https://nodejs.org ^(version LTS^)
  pause
  exit /b 1
)
if not exist node_modules\quickjs-emscripten call npm install --omit=dev
node bin\sixm.js
if errorlevel 1 pause
