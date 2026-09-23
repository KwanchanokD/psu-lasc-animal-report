@echo off
chcp 65001 >nul
title PSU:LASC - Create desktop shortcut
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app-launcher.ps1" -Shortcut
