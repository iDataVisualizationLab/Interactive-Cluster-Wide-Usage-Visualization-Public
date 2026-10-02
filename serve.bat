@echo off
rem Serve this folder and open the page. serve.py also tells the browser not to
rem cache anything, so an edited script is never served as the old one.
cd /d "%~dp0"
python serve.py %1
