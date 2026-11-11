param(
  [Parameter(Mandatory = $true)][ValidateSet('get', 'set', 'adjust', 'mute', 'unmute')][string]$Action,
  [ValidateRange(0, 100)][int]$Percent = 0,
  [ValidateRange(-100, 100)][int]$Delta = 0,
  [string]$CacheDir = ''
)

. ([System.IO.Path]::Combine($PSScriptRoot, '_common.ps1'))

# Core Audio (IAudioEndpointVolume) on the default playback device. C# 5 only: Windows PowerShell
# compiles with the .NET Framework compiler. The vtable order of the interfaces must stay intact.
$source = @'
using System;
using System.Runtime.InteropServices;

namespace Beekeeper
{
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint channelCount);
        [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid eventContext);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid eventContext);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IAudioEndpointVolume endpointVolume);
    }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorComObject
    {
    }

    public static class Audio
    {
        private const int ERender = 0;
        private const int EMultimedia = 1;
        private const int ClsCtxAll = 23;

        private static void Check(int hr)
        {
            if (hr < 0)
            {
                Marshal.ThrowExceptionForHR(hr);
            }
        }

        private static IAudioEndpointVolume Endpoint()
        {
            IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device;
            Check(enumerator.GetDefaultAudioEndpoint(ERender, EMultimedia, out device));
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            IAudioEndpointVolume endpoint;
            Check(device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out endpoint));
            return endpoint;
        }

        public static float GetVolume()
        {
            float level;
            Check(Endpoint().GetMasterVolumeLevelScalar(out level));
            return level;
        }

        public static void SetVolume(float level)
        {
            Guid context = Guid.Empty;
            Check(Endpoint().SetMasterVolumeLevelScalar(level, ref context));
        }

        public static bool GetMute()
        {
            bool mute;
            Check(Endpoint().GetMute(out mute));
            return mute;
        }

        public static void SetMute(bool mute)
        {
            Guid context = Guid.Empty;
            Check(Endpoint().SetMute(mute, ref context));
        }
    }
}
'@

function ConvertTo-Percent {
  param([double]$Scalar)
  return [int][Math]::Round($Scalar * 100, [MidpointRounding]::AwayFromZero)
}

try {
  Import-CachedType -Name 'BeekeeperAudio' -Source $source -CacheDir $CacheDir
  $current = ConvertTo-Percent ([Beekeeper.Audio]::GetVolume())
  $wasMuted = [Beekeeper.Audio]::GetMute()
  $target = $null

  switch ($Action) {
    'set' { $target = $Percent }
    'adjust' { $target = [Math]::Max(0, [Math]::Min(100, $current + $Delta)) }
    'mute' { [Beekeeper.Audio]::SetMute($true) }
    'unmute' { [Beekeeper.Audio]::SetMute($false) }
  }

  if ($null -ne $target) {
    [Beekeeper.Audio]::SetVolume([single]($target / 100.0))
    # Like the hardware volume keys: raising the level above zero also unmutes.
    if ($wasMuted -and $target -gt 0 -and ($Action -eq 'set' -or $Delta -gt 0)) {
      [Beekeeper.Audio]::SetMute($false)
    }
  }

  $level = ConvertTo-Percent ([Beekeeper.Audio]::GetVolume())
  $muted = [Beekeeper.Audio]::GetMute()
  Write-Result ('{"percent":' + $level + ',"muted":' + (ConvertTo-JsonBool $muted) + '}')
} catch {
  # 0x80070490 (E_NOTFOUND): there is no default playback device.
  if ($_.Exception -is [System.Runtime.InteropServices.COMException] -and $_.Exception.HResult -eq 0x80070490) {
    Exit-Failure 'unsupported' 'No audio output device is available.'
  }
  Exit-Failure 'failed' $_.Exception.Message
}
