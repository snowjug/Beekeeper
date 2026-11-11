# Shared helpers for the Beekeeper PowerShell scripts (dot-sourced by every script).
#
# Keep every script ASCII-only: Windows PowerShell 5.1 reads BOM-less files with the ANSI code page.
# Hot-path scripts avoid cmdlets on purpose: the first cmdlet call costs ~90 ms, ConvertTo-Json ~150 ms
# and Get-CimInstance ~150 ms, while plain .NET calls are free. Prefer [System.*] APIs here.
#
# Protocol: a script prints exactly one JSON document on stdout.
#   success: {"ok":true,"data":<payload>}
#   failure: {"ok":false,"code":"unsupported|failed|not-found|invalid-argument","message":"..."}
# and exits with code 0 once it managed to run, so the caller can tell a reported failure from a
# PowerShell crash (non-zero exit code, no JSON).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Write-Raw {
  param([string]$Text)
  $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Text)
  $stream = [Console]::OpenStandardOutput()
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
}

function ConvertTo-JsonString {
  param([string]$Text)
  $escaped = $Text.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
  # Remaining control characters are rare; the evaluator delegate is only built when one is present.
  if ([System.Text.RegularExpressions.Regex]::IsMatch($escaped, '[\x00-\x1f]')) {
    $escaped = [System.Text.RegularExpressions.Regex]::Replace($escaped, '[\x00-\x1f]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
  }
  return '"' + $escaped + '"'
}

function ConvertTo-JsonBool {
  param([bool]$Value)
  if ($Value) { return 'true' }
  return 'false'
}

# `$DataJson` is a ready-made JSON fragment built by the caller.
function Write-Result {
  param([string]$DataJson = 'null')
  Write-Raw ('{"ok":true,"data":' + $DataJson + '}')
}

function Exit-Failure {
  param([string]$Code, [string]$Message)
  Write-Raw ('{"ok":false,"code":' + (ConvertTo-JsonString $Code) + ',"message":' + (ConvertTo-JsonString $Message) + '}')
  exit 0
}

# Compiles `$Source` once, caches the assembly under `$CacheDir` (named after a hash of the source, so a
# changed source never reuses a stale DLL) and loads the cached assembly on later runs: loading a
# compiled DLL takes a few milliseconds while Add-Type starts the C# compiler on every run.
function Import-CachedType {
  param([string]$Name, [string]$Source, [string]$CacheDir = '')
  if ($CacheDir -ne '') {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $digest = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Source))
    } finally {
      $sha.Dispose()
    }
    $hash = [System.BitConverter]::ToString($digest, 0, 8).Replace('-', '').ToLowerInvariant()
    $dll = [System.IO.Path]::Combine($CacheDir, $Name + '-' + $hash + '.dll')
    if ([System.IO.File]::Exists($dll)) {
      try {
        [void][System.Reflection.Assembly]::LoadFrom($dll)
        return
      } catch {
        try { [System.IO.File]::Delete($dll) } catch { }
      }
    }
    $temp = [System.IO.Path]::Combine($CacheDir, $Name + '-' + $hash + '.' + $PID + '.tmp.dll')
    try {
      [void][System.IO.Directory]::CreateDirectory($CacheDir)
      Add-Type -TypeDefinition $Source -OutputAssembly $temp -OutputType Library
      try { [System.IO.File]::Move($temp, $dll) } catch { }
      if ([System.IO.File]::Exists($dll)) {
        # Another process may have finished compiling first, which leaves our copy behind.
        try { [System.IO.File]::Delete($temp) } catch { }
        [void][System.Reflection.Assembly]::LoadFrom($dll)
      } else {
        [void][System.Reflection.Assembly]::LoadFrom($temp)
      }
      return
    } catch {
      try { [System.IO.File]::Delete($temp) } catch { }
    }
  }
  Add-Type -TypeDefinition $Source
}
