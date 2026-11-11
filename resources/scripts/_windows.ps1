# Window enumeration / graceful closing helper shared by windows.ps1 and close-windows.ps1.
# Dot-source it after _common.ps1. The C# source must stay identical for both scripts because the
# compiled assembly is cached under a hash of it. C# 5 only (Windows PowerShell compiler).
$script:WindowsSource = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Beekeeper
{
    public static class Windows
    {
        private delegate bool EnumProc(IntPtr handle, IntPtr lParam);

        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
        [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr lParam);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
        [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr handle, uint command);
        [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr handle, int index);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int maxCount);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr handle, StringBuilder text, int maxCount);
        [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr handle, int attribute, out int value, int size);

        private const uint GwOwner = 4;
        private const int GwlExStyle = -20;
        private const int WsExToolWindow = 0x80;
        private const int DwmwaCloaked = 14;
        private const uint WmClose = 0x0010;

        private static string Text(IntPtr handle)
        {
            StringBuilder text = new StringBuilder(512);
            GetWindowText(handle, text, text.Capacity);
            return text.ToString();
        }

        private static string ClassName(IntPtr handle)
        {
            StringBuilder name = new StringBuilder(256);
            GetClassName(handle, name, name.Capacity);
            return name.ToString();
        }

        // The windows a user sees in Alt+Tab: visible, not owned, not a tool window, not cloaked
        // (suspended UWP windows and windows of other virtual desktops are cloaked), with a title.
        private static bool IsAppWindow(IntPtr handle)
        {
            if (!IsWindowVisible(handle) || GetWindow(handle, GwOwner) != IntPtr.Zero) { return false; }
            if ((GetWindowLong(handle, GwlExStyle) & WsExToolWindow) != 0) { return false; }
            int cloaked;
            if (DwmGetWindowAttribute(handle, DwmwaCloaked, out cloaked, 4) == 0 && cloaked != 0) { return false; }
            return Text(handle).Length > 0;
        }

        // UWP windows live in an ApplicationFrameWindow owned by ApplicationFrameHost.exe; the app
        // itself owns the CoreWindow child. Resolve that so "Calculator" maps to CalculatorApp.exe.
        private static uint ProcessIdOf(IntPtr handle)
        {
            uint owner;
            GetWindowThreadProcessId(handle, out owner);
            if (ClassName(handle) != "ApplicationFrameWindow") { return owner; }
            uint real = owner;
            EnumChildWindows(handle, delegate (IntPtr child, IntPtr lParam)
            {
                if (ClassName(child) == "Windows.UI.Core.CoreWindow")
                {
                    uint childOwner;
                    GetWindowThreadProcessId(child, out childOwner);
                    if (childOwner != owner) { real = childOwner; return false; }
                }
                return true;
            }, IntPtr.Zero);
            return real;
        }

        private static string Quote(string text)
        {
            StringBuilder json = new StringBuilder("\"");
            foreach (char c in text)
            {
                if (c == '"' || c == '\\') { json.Append('\\').Append(c); }
                else if (c < ' ') { json.AppendFormat("\\u{0:x4}", (int)c); }
                else { json.Append(c); }
            }
            return json.Append('"').ToString();
        }

        private static string NameOf(uint processId)
        {
            try { return Process.GetProcessById((int)processId).ProcessName; }
            catch (Exception) { return null; }
        }

        // JSON array of {"pid":..,"name":..,"title":..}, one entry per app window.
        public static string List()
        {
            StringBuilder json = new StringBuilder("[");
            bool first = true;
            EnumWindows(delegate (IntPtr handle, IntPtr lParam)
            {
                if (!IsAppWindow(handle)) { return true; }
                uint processId = ProcessIdOf(handle);
                string name = NameOf(processId);
                if (name == null) { return true; }
                if (!first) { json.Append(','); }
                first = false;
                json.Append("{\"pid\":").Append(processId)
                    .Append(",\"name\":").Append(Quote(name))
                    .Append(",\"title\":").Append(Quote(Text(handle))).Append('}');
                return true;
            }, IntPtr.Zero);
            return json.Append(']').ToString();
        }

        // Posts WM_CLOSE (what the X button does) to every app window of the process.
        public static int Close(uint processId)
        {
            int asked = 0;
            EnumWindows(delegate (IntPtr handle, IntPtr lParam)
            {
                if (IsAppWindow(handle) && ProcessIdOf(handle) == processId
                    && PostMessage(handle, WmClose, IntPtr.Zero, IntPtr.Zero)) { asked++; }
                return true;
            }, IntPtr.Zero);
            return asked;
        }

        public static bool HasWindows(uint processId)
        {
            bool found = false;
            EnumWindows(delegate (IntPtr handle, IntPtr lParam)
            {
                if (IsAppWindow(handle) && ProcessIdOf(handle) == processId) { found = true; return false; }
                return true;
            }, IntPtr.Zero);
            return found;
        }
    }
}
'@

function Import-WindowsHelper {
  param([string]$CacheDir = '')
  Import-CachedType -Name 'BeekeeperWindows' -Source $script:WindowsSource -CacheDir $CacheDir
}
