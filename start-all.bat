@echo off
cd /d "D:\Open Code Project\MCQ Website\backend"
start "MCQ Backend" cmd /k "npm run dev"
cd /d "D:\Open Code Project\MCQ Website\frontend"
start "MCQ Frontend" cmd /k "npm run dev"
echo Started backend (4000) and frontend (5173).