# ตัวเปิด "ระบบรายงานการปฏิบัติต่อสัตว์ทดลองของนักวิจัย PSU:LASC" ให้ทำงานเหมือนแอปบนเดสก์ท็อป
#
#   .\app-launcher.ps1             เปิดแอป (หน้าต่างแยก ไม่มีแถบเบราว์เซอร์)
#   .\app-launcher.ps1 -Shortcut   สร้างทางลัดไว้บนเดสก์ท็อป
#
# ปลายทางที่เปิด: ถ้ามีไฟล์ app-url.txt และระบุ URL ไว้ จะใช้ URL นั้น (แนะนำ เพราะเข้าสู่ระบบ/ซิงก์คลาวด์ได้)
#                มิฉะนั้นจะเปิดไฟล์ index.html ในโฟลเดอร์นี้ (ใช้งานออฟไลน์ เก็บข้อมูลในเครื่อง)

param([switch]$Shortcut)

$ErrorActionPreference = 'Stop'
$dir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

# ---------- หาปลายทาง ----------
$target = $null
$urlFile = Join-Path $dir 'app-url.txt'
if (Test-Path $urlFile) {
  $line = Get-Content $urlFile | Where-Object { $_.Trim() -ne '' -and -not $_.Trim().StartsWith('#') } | Select-Object -First 1
  if ($line) { $target = $line.Trim() }
}
$isLocal = $false
if (-not $target) {
  $indexPath = Join-Path $dir 'index.html'
  if (-not (Test-Path $indexPath)) {
    Write-Host 'ไม่พบไฟล์ index.html ในโฟลเดอร์นี้' -ForegroundColor Red
    Read-Host 'กด Enter เพื่อปิด' | Out-Null
    exit 1
  }
  $target = ([Uri]$indexPath).AbsoluteUri
  $isLocal = $true
}

# ---------- หาเบราว์เซอร์ที่เปิดโหมดแอปได้ ----------
$candidates = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

# ---------- สร้างทางลัดบนเดสก์ท็อป ----------
if ($Shortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'ระบบรายงานการปฏิบัติต่อสัตว์ทดลอง PSU-LASC.lnk'
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  if ($browser) {
    $sc.TargetPath = $browser
    $sc.Arguments  = '--app="' + $target + '" --window-size=1280,860'
  } else {
    $sc.TargetPath = $target
  }
  $sc.WorkingDirectory = $dir
  $ico = Join-Path $dir 'icon.ico'
  if (Test-Path $ico) { $sc.IconLocation = $ico }
  $sc.Description = 'ระบบรายงานการปฏิบัติต่อสัตว์ทดลองของนักวิจัย — ศูนย์สัตว์ทดลอง ม.อ.'
  $sc.Save()
  Write-Host ''
  Write-Host ' สร้างทางลัดบนเดสก์ท็อปเรียบร้อยแล้ว' -ForegroundColor Green
  Write-Host (' ' + $lnk)
  if ($isLocal) {
    Write-Host ''
    Write-Host ' หมายเหตุ: ทางลัดนี้เปิดไฟล์ในเครื่อง จึงเข้าสู่ระบบ/ซิงก์คลาวด์ไม่ได้' -ForegroundColor Yellow
    Write-Host ' ถ้าต้องการซิงก์กับศูนย์สัตว์ทดลอง ให้ใส่ URL ของระบบในไฟล์ app-url.txt แล้วสร้างทางลัดใหม่' -ForegroundColor Yellow
  }
  Write-Host ''
  Read-Host 'กด Enter เพื่อปิด' | Out-Null
  exit 0
}

# ---------- เปิดแอป ----------
if ($browser) {
  Start-Process -FilePath $browser -ArgumentList @(('--app=' + $target), '--window-size=1280,860')
} else {
  # ไม่พบ Chrome/Edge — เปิดด้วยโปรแกรมที่ตั้งค่าไว้ของระบบแทน
  Start-Process $target
}
