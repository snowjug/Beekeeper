. ([System.IO.Path]::Combine($PSScriptRoot, '_common.ps1'))

# Lists the Start menu apps as [{"name":..,"appId":..}]. The caller keeps the packaged (UWP) apps;
# classic apps are indexed from their Start menu shortcuts instead. Enumerating the Start menu is
# slow (about 1.5 s), which is why the caller loads this list in the background.
try {
  $json = [System.Text.StringBuilder]::new('[')
  foreach ($app in (Get-StartApps)) {
    if ($json.Length -gt 1) { [void]$json.Append(',') }
    [void]$json.Append('{"name":' + (ConvertTo-JsonString ([string]$app.Name)) + ',"appId":' + (ConvertTo-JsonString ([string]$app.AppID)) + '}')
  }
  [void]$json.Append(']')
  Write-Result $json.ToString()
} catch {
  Exit-Failure 'failed' $_.Exception.Message
}
