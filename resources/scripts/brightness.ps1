param(
  [Parameter(Mandatory = $true)][ValidateSet('get', 'set')][string]$Action,
  [ValidateRange(0, 100)][int]$Percent = 0
)

. ([System.IO.Path]::Combine($PSScriptRoot, '_common.ps1'))

# Software brightness only exists for panels driven through WMI (laptop displays). Desktop monitors
# expose no WmiMonitorBrightness instance, so the class is empty (or missing) there.
function Get-WmiInstances {
  param([string]$ClassName)
  $instances = [System.Collections.Generic.List[object]]::new()
  $searcher = [System.Management.ManagementObjectSearcher]::new('root\wmi', 'SELECT * FROM ' + $ClassName)
  try {
    foreach ($instance in $searcher.Get()) { $instances.Add($instance) }
  } catch [System.Management.ManagementException] {
    # The class does not exist on this machine: no brightness-capable display.
  } finally {
    $searcher.Dispose()
  }
  return , $instances
}

function Get-Brightness {
  $instances = Get-WmiInstances 'WmiMonitorBrightness'
  if ($instances.Count -eq 0) { return $null }
  return [int]$instances[0]['CurrentBrightness']
}

try {
  if ($Action -eq 'set') {
    $methods = Get-WmiInstances 'WmiMonitorBrightnessMethods'
    if ($methods.Count -eq 0) {
      Exit-Failure 'unsupported' 'This display does not support software brightness control.'
    }
    foreach ($method in $methods) {
      [void]$method.InvokeMethod('WmiSetBrightness', [object[]]@([uint32]1, [byte]$Percent))
    }
  }

  $level = Get-Brightness
  if ($null -eq $level) {
    if ($Action -eq 'get') {
      Write-Result '{"supported":false,"percent":null}'
      exit 0
    }
    Exit-Failure 'unsupported' 'This display does not support software brightness control.'
  }
  if ($Action -eq 'set' -and $level -ne $Percent) {
    # Some panels apply the change a moment later or snap to the nearest level they support.
    [System.Threading.Thread]::Sleep(80)
    $level = Get-Brightness
  }
  Write-Result ('{"supported":true,"percent":' + $level + '}')
} catch {
  Exit-Failure 'failed' $_.Exception.Message
}
