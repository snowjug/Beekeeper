param(
  [string]$CacheDir = ''
)

. ([System.IO.Path]::Combine($PSScriptRoot, '_common.ps1'))
. ([System.IO.Path]::Combine($PSScriptRoot, '_windows.ps1'))

# Lists the windows a user can close as [{"pid":..,"name":..,"title":..}] (see _windows.ps1).
try {
  Import-WindowsHelper -CacheDir $CacheDir
  Write-Result ([Beekeeper.Windows]::List())
} catch {
  Exit-Failure 'failed' $_.Exception.Message
}
