param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [int]$SettleSeconds = 20,
  [int]$SampleSeconds = 15
)

# Measures cold start to tray, idle memory and idle CPU of a built Beekeeper (all windows hidden).
$userData = Join-Path $env:TEMP ('bk-perf-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $userData | Out-Null
Set-Content -Path (Join-Path $userData 'settings.json') -Value '{"onboarding":{"completed":true}}'
$env:BEEKEEPER_USER_DATA = $userData

function Get-Family([int]$rootId) {
  $all = Get-CimInstance Win32_Process
  $ids = New-Object System.Collections.Generic.HashSet[int]
  [void]$ids.Add($rootId)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) {
        [void]$ids.Add([int]$p.ProcessId)
        $changed = $true
      }
    }
  }
  return $ids
}

function Get-CpuSeconds($ids) {
  $total = 0.0
  foreach ($id in $ids) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p) { $total += $p.TotalProcessorTime.TotalSeconds }
  }
  return $total
}

$proc = $null
try {
  $started = Get-Date
  $proc = Start-Process -FilePath $Exe -PassThru
  $log = Join-Path $userData 'logs\main.log'
  $trayAt = $null
  for ($i = 0; $i -lt 400 -and -not $trayAt; $i++) {
    Start-Sleep -Milliseconds 25
    if (Test-Path $log) {
      $line = Select-String -Path $log -Pattern 'Tray ready' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($line) { $trayAt = Get-Date }
    }
  }
  $coldStartMs = if ($trayAt) { [math]::Round(($trayAt - $started).TotalMilliseconds) } else { -1 }

  Start-Sleep -Seconds $SettleSeconds

  $family = Get-Family $proc.Id
  $procs = @($family | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
  $workingSet = ($procs | Measure-Object -Property WorkingSet64 -Sum).Sum
  $private = ($procs | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
  # "Working Set - Private" is what Task Manager shows in its Memory column.
  $instances = (Get-Counter '\Process(*)\ID Process').CounterSamples |
    Where-Object { $family.Contains([int]$_.CookedValue) } |
    ForEach-Object { $_.InstanceName }
  $privateWs = 0.0
  foreach ($instance in $instances) {
    $privateWs += (Get-Counter "\Process($instance)\Working Set - Private").CounterSamples[0].CookedValue
  }
  $before = Get-CpuSeconds $family
  $t0 = Get-Date
  Start-Sleep -Seconds $SampleSeconds
  $after = Get-CpuSeconds $family
  $elapsed = ((Get-Date) - $t0).TotalSeconds
  $cpuPercent = 100 * (($after - $before) / $elapsed) / [Environment]::ProcessorCount

  [pscustomobject]@{
    ColdStartToTrayMs  = $coldStartMs
    Processes          = $procs.Count
    PrivateWorkingSetMB = [math]::Round($privateWs / 1MB, 1)
    WorkingSetMB       = [math]::Round($workingSet / 1MB, 1)
    PrivateBytesMB     = [math]::Round($private / 1MB, 1)
    IdleCpuPercent     = [math]::Round($cpuPercent, 3)
  } | Format-List | Out-String
} finally {
  if ($proc) {
    foreach ($id in (Get-Family $proc.Id)) { try { [System.Diagnostics.Process]::GetProcessById($id).Kill() } catch { } }
  }
  Start-Sleep -Seconds 1
  Remove-Item $userData -Recurse -Force -ErrorAction SilentlyContinue
}
