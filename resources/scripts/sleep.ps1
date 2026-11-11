[CmdletBinding(SupportsShouldProcess = $true)]
param()

. ([System.IO.Path]::Combine($PSScriptRoot, '_common.ps1'))

# Puts the computer to sleep (not hibernate). SetSuspendState only returns after the PC resumed, so the
# caller must not apply a timeout to this script. -WhatIf only loads the assemblies and reports.
try {
  Add-Type -AssemblyName System.Windows.Forms
  if ($PSCmdlet.ShouldProcess('this computer', 'Sleep')) {
    $suspended = [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)
    if (-not $suspended) {
      Exit-Failure 'failed' 'Windows did not go to sleep.'
    }
  }
  Write-Result 'null'
} catch {
  Exit-Failure 'failed' $_.Exception.Message
}
