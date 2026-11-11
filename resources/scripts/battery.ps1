. ([System.IO.Path]::Combine($PSScriptRoot, '_common.ps1'))

# Reports raw battery values; the caller interprets them. Win32_Battery has one instance per battery
# (none on a desktop PC). Its BatteryStatus cannot tell "charging" from "plugged in", so the ACPI class
# root\wmi:BatteryStatus (Charging / PowerOnline) is queried as well when the machine provides it.
function Get-FirstInstance {
  param([string]$Scope, [string]$Query)
  $searcher = [System.Management.ManagementObjectSearcher]::new($Scope, $Query)
  try {
    foreach ($instance in $searcher.Get()) { return $instance }
  } catch [System.Management.ManagementException] {
    return $null
  } finally {
    $searcher.Dispose()
  }
  return $null
}

function ConvertTo-JsonNumber {
  param($Value)
  if ($null -eq $Value) { return 'null' }
  return [string][long]$Value
}

function ConvertTo-JsonNullableBool {
  param($Value)
  if ($null -eq $Value) { return 'null' }
  return ConvertTo-JsonBool ([bool]$Value)
}

try {
  $battery = Get-FirstInstance 'root\cimv2' 'SELECT BatteryStatus, EstimatedChargeRemaining, EstimatedRunTime FROM Win32_Battery'
  if ($null -eq $battery) {
    Write-Result '{"hasBattery":false}'
    exit 0
  }
  $acpi = Get-FirstInstance 'root\wmi' 'SELECT Charging, PowerOnline FROM BatteryStatus'
  $charging = if ($null -eq $acpi) { $null } else { $acpi['Charging'] }
  $powerOnline = if ($null -eq $acpi) { $null } else { $acpi['PowerOnline'] }

  Write-Result ('{"hasBattery":true' +
    ',"percent":' + (ConvertTo-JsonNumber $battery['EstimatedChargeRemaining']) +
    ',"status":' + (ConvertTo-JsonNumber $battery['BatteryStatus']) +
    ',"runTimeMinutes":' + (ConvertTo-JsonNumber $battery['EstimatedRunTime']) +
    ',"charging":' + (ConvertTo-JsonNullableBool $charging) +
    ',"powerOnline":' + (ConvertTo-JsonNullableBool $powerOnline) + '}')
} catch {
  Exit-Failure 'failed' $_.Exception.Message
}
