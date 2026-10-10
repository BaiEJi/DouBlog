# 杀掉所有 bench 相关 python 进程（launch.py / mock_upstream.py）
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'bench\\\\(launch|mock_upstream)\.py' -or $_.CommandLine -match 'bench/(launch|mock_upstream)\.py' } |
  ForEach-Object { Write-Host "kill $($_.ProcessId): $($_.CommandLine)"; Stop-Process -Id $_.ProcessId -Force }
