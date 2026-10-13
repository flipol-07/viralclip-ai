@echo off
REM ViralClip AI - Worker autoarranque
REM Copia un acceso directo de este archivo a la carpeta de Inicio de Windows
REM (Win+R -> shell:startup) para que el worker arranque al encender el PC.
title ViralClip Worker
wsl -- bash -lc "cd '/home/plore/proyectos/APPS UTILES/Videos virales automaticos' && npm run worker"
pause
