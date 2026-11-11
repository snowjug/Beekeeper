import { describe, expect, it } from 'vitest';
import {
  NO_FORCE_PROCESSES,
  PROTECTED_PROCESSES,
  isProtectedProcess,
  matchProcesses,
  parseWindowList,
} from '@main/system/processes';

const SELF = 4242;

function win(name: string, title: string, pid: number) {
  return { pid, name, title };
}

const WINDOWS = [
  win('notepad', 'Untitled - Notepad', 100),
  win('notepad', 'notes.txt - Notepad', 101),
  win('chrome', 'New Tab - Google Chrome', 200),
  win('msedge', 'Bing - Microsoft Edge', 210),
  win('Code', 'index.ts - Beekeeper - Visual Studio Code', 300),
  win('Spotify', 'Daft Punk - Get Lucky', 400),
  win('WINWORD', 'Report - Word', 500),
  win('ms-teams', 'Chat | Microsoft Teams', 600),
  win('Taskmgr', 'Task Manager', 700),
  win('CalculatorApp', 'Calculator', 800),
  win('SystemSettings', 'Settings', 810),
  win('explorer', 'Documents', 900),
  win('WindowsTerminal', 'PowerShell', 950),
  win('electron', 'Beekeeper', SELF),
  win('svchost', 'Windows Service Host', 4),
  win('ApplicationFrameHost', 'Photos', 1000),
  win('powershell', 'Windows PowerShell', 1100),
];

function pids(query: string): number[] {
  return matchProcesses(query, WINDOWS, SELF).matches.map((match) => match.pid);
}

describe('parseWindowList', () => {
  it('keeps well-formed entries and defaults a missing title', () => {
    expect(
      parseWindowList([
        { pid: 12, name: 'notepad', title: 'Untitled - Notepad' },
        { pid: 13, name: 'chrome' },
        { pid: 14, name: 'my app', title: 5 },
      ]),
    ).toEqual([
      { pid: 12, name: 'notepad', title: 'Untitled - Notepad' },
      { pid: 13, name: 'chrome', title: '' },
      { pid: 14, name: 'my app', title: '' },
    ]);
  });

  it('drops anything a script could misread', () => {
    expect(
      parseWindowList([
        { pid: 0, name: 'a' },
        { pid: -1, name: 'a' },
        { pid: 1.5, name: 'a' },
        { pid: '12', name: 'a' },
        { pid: 12, name: '' },
        { pid: 12, name: 'a|b' },
        { pid: 12, name: 'a:b' },
        { pid: 12 },
        null,
        'x',
        42,
      ]),
    ).toEqual([]);
    expect(parseWindowList(undefined)).toEqual([]);
    expect(parseWindowList({ pid: 1, name: 'a' })).toEqual([]);
  });
});

describe('protected processes', () => {
  it('covers the system, the shell hosts, security software and Beekeeper', () => {
    for (const name of [
      'csrss',
      'winlogon',
      'dwm',
      'svchost',
      'lsass',
      'wininit',
      'services',
      'beekeeper',
      'msmpeng',
    ]) {
      expect(PROTECTED_PROCESSES.has(name), name).toBe(true);
    }
    expect(NO_FORCE_PROCESSES.has('explorer')).toBe(true);
  });

  it('never allows a protected name, any casing, or this process', () => {
    expect(isProtectedProcess(win('SVCHOST', 'x', 1), SELF)).toBe(true);
    expect(isProtectedProcess(win('Dwm', 'x', 1), SELF)).toBe(true);
    expect(isProtectedProcess(win('anything', 'x', SELF), SELF)).toBe(true);
    expect(isProtectedProcess(win('notepad', 'x', 1), SELF)).toBe(false);
  });
});

describe('matchProcesses', () => {
  it.each([
    ['notepad', [100, 101]],
    ['the notepad app', [100, 101]],
    ['Notepad', [100, 101]],
    ['chrome', [200]],
    ['google chrome', [200]],
    ['chrom', [200]],
    ['edge', [210]],
    ['microsoft edge', [210]],
    ['vs code', [300]],
    ['vscode', [300]],
    ['code', [300]],
    ['visual studio code', [300]],
    ['spotify', [400]],
    ['spotfy', [400]],
    ['word', [500]],
    ['ms word', [500]],
    ['teams', [600]],
    ['task manager', [700]],
    ['taskmgr', [700]],
    ['calculator', [800]],
    ['calc', [800]],
    ['settings', [810]],
    ['windows terminal', [950]],
    ['terminal', [950]],
    ['powershell', [1100]],
    ['file explorer', [900]],
  ])('%j matches %j', (query, expected) => {
    expect(pids(query)).toEqual(expected);
  });

  it('matches by the application name at the end of the window title', () => {
    const result = matchProcesses('foo editor', [win('foo', 'readme.md - Foo Editor', 5)], SELF);
    expect(result.matches.map((match) => match.pid)).toEqual([5]);
  });

  it('does not match words that merely appear in a title', () => {
    expect(
      matchProcesses('notepad', [win('chrome', 'How to use Notepad - Google Chrome', 1)], SELF)
        .matches,
    ).toEqual([]);
    expect(
      matchProcesses('docs', [win('chrome', 'My docs - Google Chrome', 1)], SELF).matches,
    ).toEqual([]);
  });

  it('returns one entry per process even when it shows several windows', () => {
    const windows = [
      win('chrome', 'A - Google Chrome', 7),
      win('chrome', 'B - Google Chrome', 7),
      win('chrome', 'C', 8),
    ];
    expect(matchProcesses('chrome', windows, SELF).matches.map((match) => match.pid)).toEqual([
      7, 8,
    ]);
  });

  it('never offers Beekeeper itself or system processes', () => {
    expect(matchProcesses('beekeeper', WINDOWS, SELF)).toEqual({
      matches: [],
      protectedName: 'electron',
    });
    expect(matchProcesses('svchost', WINDOWS, SELF)).toEqual({
      matches: [],
      protectedName: 'svchost',
    });
    expect(matchProcesses('photos', WINDOWS, SELF)).toEqual({
      matches: [],
      protectedName: 'ApplicationFrameHost',
    });
  });

  it('does not fall back to a weaker match when the best one is protected', () => {
    const windows = [win('svchost', 'x', 4), win('svchost2', 'y', 5)];
    expect(matchProcesses('svchost', windows, SELF).matches).toEqual([]);
  });

  it('reports nothing for apps that are not running or unusable queries', () => {
    expect(matchProcesses('discord', WINDOWS, SELF)).toEqual({ matches: [], protectedName: null });
    expect(matchProcesses('', WINDOWS, SELF)).toEqual({ matches: [], protectedName: null });
    expect(matchProcesses('!!!', WINDOWS, SELF)).toEqual({ matches: [], protectedName: null });
    expect(matchProcesses('notepad', [], SELF)).toEqual({ matches: [], protectedName: null });
  });

  it('does not match short fragments of process names', () => {
    expect(pids('not')).toEqual([]);
    expect(pids('win')).toEqual([]);
    expect(pids('c')).toEqual([]);
  });
});
