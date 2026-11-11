[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Path
)

. ([System.IO.Path]::Combine($PSScriptRoot, '_common.ps1'))

# Puts one file on the clipboard as a file drop (CF_HDROP), so it can be pasted into Explorer, a mail
# or a chat window like a file copied in Explorer. The path is a script parameter, never part of a command.
try {
  if (-not [System.IO.Path]::IsPathRooted($Path) -or -not [System.IO.File]::Exists($Path)) {
    Exit-Failure 'not-found' 'The screenshot file does not exist.'
  }
  Add-Type -AssemblyName System.Windows.Forms
  $files = New-Object System.Collections.Specialized.StringCollection
  [void]$files.Add($Path)
  [System.Windows.Forms.Clipboard]::SetFileDropList($files)
  Write-Result
} catch {
  Exit-Failure 'failed' $_.Exception.Message
}
