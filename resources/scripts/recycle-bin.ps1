[CmdletBinding(SupportsShouldProcess = $true)]
param()

. ([System.IO.Path]::Combine($PSScriptRoot, '_common.ps1'))

# Empties the recycle bin of every drive without confirmation. -WhatIf only reports the item count:
# Clear-RecycleBin -Force ignores -WhatIf on its own, so the call is guarded explicitly.
try {
  $shell = [Activator]::CreateInstance([Type]::GetTypeFromProgID('Shell.Application'))
  $items = [int]$shell.NameSpace(0xA).Items().Count
  # Clear-RecycleBin fails on an already empty bin, so only call it when there is something to delete.
  if ($items -gt 0 -and $PSCmdlet.ShouldProcess('the recycle bin', 'Empty')) { Clear-RecycleBin -Force }
  Write-Result ('{"items":' + $items + '}')
} catch {
  Exit-Failure 'failed' $_.Exception.Message
}
