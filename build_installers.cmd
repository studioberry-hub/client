@echo off
setlocal
cd /d "%~dp0"
pip show pyinstaller >nul 2>&1 || pip install pyinstaller
pip show pillow >nul 2>&1 || pip install pillow

rem Вызов через модуль: pyinstaller.exe не всегда попадает в PATH
set PYI=python -m PyInstaller

rem Ресурсы кладутся внутрь exe: без них подхватываются системный шрифт и запасные иконки
set DATA=--add-data "installer\assets;assets" --add-data "assets\fonts\nekst;assets\fonts\nekst"
set OPTS=--onefile --noconsole --icon IconForBuild\icon.ico --hidden-import PIL._tkinter_finder %DATA%

%PYI% %OPTS% --name UClientInstaller installer\installer.py
if errorlevel 1 goto :fail
%PYI% %OPTS% --name updater installer\updater.py
if errorlevel 1 goto :fail
%PYI% %OPTS% --name unins000 installer\unins000.py
if errorlevel 1 goto :fail

echo.
echo Done: dist\UClientInstaller.exe, dist\updater.exe, dist\unins000.exe
echo Put updater.exe and unins000.exe into the client release zip.
exit /b 0

:fail
echo Build failed
exit /b 1
