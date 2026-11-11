import { normalizeAppName } from './appAliases';
import type { InstalledApp } from './types';

interface BuiltinApp {
  name: string;
  /** An executable name resolved by Windows, or a URI scheme such as "ms-settings:". */
  target: string;
}

/**
 * Programs that ship with every Windows 10/11 install, launched by these fixed names only. Apps that
 * may be missing (Windows Terminal, Photos, ...) are found in the Start menu instead.
 */
const BUILTIN_APPS: readonly BuiltinApp[] = [
  { name: 'Notepad', target: 'notepad.exe' },
  { name: 'Calculator', target: 'calc.exe' },
  { name: 'File Explorer', target: 'explorer.exe' },
  { name: 'Task Manager', target: 'taskmgr.exe' },
  { name: 'Settings', target: 'ms-settings:' },
  { name: 'Paint', target: 'mspaint.exe' },
  { name: 'Snipping Tool', target: 'snippingtool.exe' },
  { name: 'Command Prompt', target: 'cmd.exe' },
  { name: 'Windows PowerShell', target: 'powershell.exe' },
  { name: 'Control Panel', target: 'control.exe' },
  { name: 'Device Manager', target: 'devmgmt.msc' },
  { name: 'Registry Editor', target: 'regedit.exe' },
  { name: 'System Information', target: 'msinfo32.exe' },
  { name: 'Resource Monitor', target: 'resmon.exe' },
  { name: 'Remote Desktop Connection', target: 'mstsc.exe' },
  { name: 'Disk Cleanup', target: 'cleanmgr.exe' },
  { name: 'On-Screen Keyboard', target: 'osk.exe' },
  { name: 'Magnifier', target: 'magnify.exe' },
  { name: 'Character Map', target: 'charmap.exe' },
  { name: 'Event Viewer', target: 'eventvwr.msc' },
];

/** URI-style targets (ms-settings:) are handed to the shell, executables to `cmd /c start`. */
export function isUriTarget(target: string): boolean {
  return /^[a-z][a-z0-9.+-]*:$/i.test(target);
}

export function builtinApps(): InstalledApp[] {
  return BUILTIN_APPS.map((app) => ({
    name: app.name,
    key: normalizeAppName(app.name),
    kind: 'builtin',
    target: app.target,
  }));
}
