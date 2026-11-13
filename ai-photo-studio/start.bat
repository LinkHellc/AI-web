@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ..\.env if not exist .env (
  echo 没找到生图配置：请先在上级目录（美甲站）配置好 .env，或把 .env.example 复制为 .env 填写。
  pause
  exit /b
)
start "" http://localhost:3001
node server.js
pause
