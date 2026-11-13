@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo 已生成 .env，请用记事本打开填写 OPENAI_API_KEY 后重新运行本脚本。
  notepad .env
  pause
  exit /b
)
start "" http://localhost:3000
node server.js
pause
