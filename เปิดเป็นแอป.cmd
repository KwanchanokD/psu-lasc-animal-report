@echo off
chcp 65001 >nul
title PSU:LASC Animal Procedure Reporting System
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app-launcher.ps1"
