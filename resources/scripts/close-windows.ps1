param(
  [Parameter(Mandatory = $true)][string]$Targets,
  [ValidateRange(0, 30000)][int]$WaitMs = 3000,
  [string]$CacheDir = ''
)

. ([System.IO.Path]::Combine($PSScriptRoot, '_common.ps1'))
. ([System.IO.Path]::Combine($PSScriptRoot, '_windows.ps1'))

# Asks every window of the given processes to close (like the X button) and waits until they are gone.
# $Targets is "pid:name|pid:name"; a target is skipped when the pid now belongs to another process
# (the pid was reused since the caller listed the windows).
# Prints {"remaining":[pids]} with the processes that still show windows after the wait.
try {
  Import-WindowsHelper -CacheDir $CacheDir
  $verified = [System.Collections.Generic.List[uint32]]::new()
  foreach ($target in $Targets.Split('|')) {
    $parts = $target.Split(':', 2)
    if ($parts.Length -ne 2) { continue }
    $processId = [uint32]$parts[0]
    try {
      $process = [System.Diagnostics.Process]::GetProcessById([int]$processId)
    } catch {
      continue
    }
    $sameProcess = $process.ProcessName -eq $parts[1]
    $process.Dispose()
    if (-not $sameProcess) { continue }
    if ([Beekeeper.Windows]::Close($processId) -gt 0) { $verified.Add($processId) }
  }

  $deadline = [DateTime]::UtcNow.AddMilliseconds($WaitMs)
  $remaining = [System.Collections.Generic.List[string]]::new()
  while ($true) {
    $remaining.Clear()
    foreach ($processId in $verified) {
      if ([Beekeeper.Windows]::HasWindows($processId)) { $remaining.Add([string]$processId) }
    }
    if ($remaining.Count -eq 0 -or [DateTime]::UtcNow -ge $deadline) { break }
    [System.Threading.Thread]::Sleep(150)
  }
  Write-Result ('{"remaining":[' + [string]::Join(',', $remaining) + ']}')
} catch {
  Exit-Failure 'failed' $_.Exception.Message
}
