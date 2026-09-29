@echo off
cd /d "%~dp0"
echo Joining video files...
copy /b web.part00+web.part01+web.part02+web.part03+web.part04 "Mellox_AI_Launch_Film_1080p60_web.mp4" >nul
copy /b master.part00+master.part01+master.part02+master.part03+master.part04+master.part05+master.part06+master.part07+master.part08+master.part09+master.part10+master.part11+master.part12 "Mellox_AI_Launch_Film_1080p60_MASTER.mp4" >nul
if exist "Mellox_AI_Launch_Film_1080p60_web.mp4" del web.part*
if exist "Mellox_AI_Launch_Film_1080p60_MASTER.mp4" del master.part*
echo Done. Your videos are in this folder.
pause
