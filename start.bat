@echo off
setlocal

python --version >nul 2>&1
if errorlevel 1 (
    echo Python 3 is required. Install it from https://www.python.org/downloads/
    pause
    exit /b 1
)

echo =^> Installing dependencies...
python -m pip install -r requirements.txt -q

echo =^> Starting Career Positioning Studio on http://127.0.0.1:8000
echo     Close this window to stop.

:: Open browser after a short delay
start /b "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:8000"

:: Bind to loopback only
python -m uvicorn server:app --host 127.0.0.1 --port 8000
pause
