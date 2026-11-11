[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][ValidateSet('dark', 'light', 'toggle')][string]$Mode,
  [string]$CacheDir = ''
)

. ([System.IO.Path]::Combine($PSScriptRoot, '_common.ps1'))

# Windows reads the app/system theme from two DWORDs (0 = dark, 1 = light). Running apps only notice a
# change after a WM_SETTINGCHANGE("ImmersiveColorSet") broadcast. C# 5 only (Windows PowerShell compiler).
$source = @'
using System;
using System.Runtime.InteropServices;

namespace Beekeeper
{
    public static class Theme
    {
        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr SendMessageTimeout(IntPtr windowHandle, uint message, UIntPtr wParam, string lParam, uint flags, uint timeoutMs, out UIntPtr result);

        public static void Broadcast()
        {
            UIntPtr result;
            SendMessageTimeout(new IntPtr(0xFFFF), 0x001A, UIntPtr.Zero, "ImmersiveColorSet", 0x0002, 250, out result);
        }
    }
}
'@

try {
  Import-CachedType -Name 'BeekeeperTheme' -Source $source -CacheDir $CacheDir
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Microsoft\Windows\CurrentVersion\Themes\Personalize')
  try {
    $isDark = ([int]$key.GetValue('AppsUseLightTheme', 1)) -eq 0
    if ($Mode -eq 'toggle') { $isDark = -not $isDark } else { $isDark = ($Mode -eq 'dark') }
    $lightValue = if ($isDark) { 0 } else { 1 }
    if ($PSCmdlet.ShouldProcess('the Windows theme', $(if ($isDark) { 'Switch to dark mode' } else { 'Switch to light mode' }))) {
      $key.SetValue('AppsUseLightTheme', $lightValue, [Microsoft.Win32.RegistryValueKind]::DWord)
      $key.SetValue('SystemUsesLightTheme', $lightValue, [Microsoft.Win32.RegistryValueKind]::DWord)
      [Beekeeper.Theme]::Broadcast()
    }
  } finally {
    $key.Dispose()
  }
  Write-Result ('{"mode":"' + $(if ($isDark) { 'dark' } else { 'light' }) + '"}')
} catch {
  Exit-Failure 'failed' $_.Exception.Message
}
