import { describe, expect, it } from 'vitest';
import {
  APP_ALIASES,
  displayNameFor,
  matchAliases,
  normalizeAppName,
  queryVariants,
} from '@main/system/appAliases';
import { MIN_APP_SCORE, rankApps, scoreName } from '@main/system/appRanking';
import { app } from './support';

const CATALOG = [
  app('Notepad', 'builtin', 'notepad.exe'),
  app('Calculator', 'builtin', 'calc.exe'),
  app('File Explorer', 'builtin', 'explorer.exe'),
  app('Task Manager', 'builtin', 'taskmgr.exe'),
  app('Settings', 'builtin', 'ms-settings:'),
  app('Paint', 'builtin', 'mspaint.exe'),
  app('Snipping Tool', 'builtin', 'snippingtool.exe'),
  app('Command Prompt', 'builtin', 'cmd.exe'),
  app('Windows PowerShell', 'builtin', 'powershell.exe'),
  app('Control Panel', 'builtin', 'control.exe'),
  app('Windows Terminal', 'builtin', 'wt.exe'),
  app('Visual Studio Code'),
  app('Visual Studio 2022'),
  app('Visual Studio Installer'),
  app('Google Chrome'),
  app('Chrome Remote Desktop'),
  app('Microsoft Edge'),
  app('Microsoft Edge WebView2 Runtime'),
  app('Spotify'),
  app('Microsoft Teams'),
  app('Microsoft Teams classic'),
  app('Outlook'),
  app('Outlook (new)'),
  app('Word'),
  app('WordPad'),
  app('Excel'),
  app('PowerPoint'),
  app('OneNote'),
  app('Notepad++'),
  app('Discord'),
  app('Steam'),
  app('Mozilla Firefox'),
  app('GitHub Desktop'),
  app('Node.js'),
  app('Python 3.12'),
  app('7-Zip File Manager'),
  app('Photos', 'uwp', 'Microsoft.Windows.Photos_8wekyb3d8bbwe!App'),
  app('Microsoft Store', 'uwp', 'Microsoft.WindowsStore_8wekyb3d8bbwe!App'),
  app('Clock', 'uwp', 'Microsoft.WindowsAlarms_8wekyb3d8bbwe!App'),
];

function top(query: string, limit = 5): string[] {
  return rankApps(query, CATALOG, limit).map((match) => match.app.name);
}

describe('normalizeAppName', () => {
  it.each([
    ['Visual Studio Code', 'visual studio code'],
    ['  Google   Chrome ', 'google chrome'],
    ['Notepad++', 'notepad plus plus'],
    ['C#', 'c sharp'],
    ['Tom & Jerry', 'tom and jerry'],
    ['Node.js', 'node js'],
    ['Microsoft Teams (classic)', 'microsoft teams classic'],
    ['Café Über', 'cafe uber'],
    ['7-Zip File Manager', '7 zip file manager'],
    ['日本語アプリ', '日本語アプリ'],
    ['***', ''],
  ])('normalises %j to %j', (name, expected) => {
    expect(normalizeAppName(name)).toBe(expected);
  });
});

describe('queryVariants', () => {
  it.each([
    ['Notepad', ['notepad']],
    ['the Calculator app', ['calculator app', 'calculator']],
    ['my Chrome browser', ['chrome browser', 'chrome']],
    ['a  Spotify   program', ['spotify program', 'spotify']],
    ['app', ['app']],
    ['', []],
    ['!!!', []],
  ])('turns %j into %j', (raw, expected) => {
    expect(queryVariants(raw)).toEqual(expected);
  });
});

describe('matchAliases and displayNameFor', () => {
  it.each([
    ['vs code', 'Visual Studio Code'],
    ['vscode', 'Visual Studio Code'],
    ['code', 'Visual Studio Code'],
    ['explorer', 'File Explorer'],
    ['files', 'File Explorer'],
    ['task manager', 'Task Manager'],
    ['calc', 'Calculator'],
    ['the calculator app', 'Calculator'],
    ['edge', 'Microsoft Edge'],
    ['google chrome', 'Google Chrome'],
    ['teams', 'Microsoft Teams'],
    ['ms word', 'Word'],
    ['power point', 'PowerPoint'],
    ['cmd', 'Command Prompt'],
    ['snip', 'Snipping Tool'],
    ['windows terminal', 'Windows Terminal'],
  ])('%j is %s', (query, display) => {
    expect(displayNameFor(query)).toBe(display);
  });

  it('tolerates typos in longer phrases but not in short ones', () => {
    expect(matchAliases(['chrmoe'])[0]).toMatchObject({
      exact: false,
      alias: { display: 'Google Chrome' },
    });
    expect(matchAliases(['spotfy'])[0]?.alias.display).toBe('Spotify');
    expect(matchAliases(['cod'])).toEqual([]);
    expect(matchAliases(['edgy'])).toEqual([]);
    expect(matchAliases(['chrome'])[0]?.exact).toBe(true);
  });

  it('title-cases names it does not know', () => {
    expect(displayNameFor('foo bar')).toBe('Foo Bar');
    expect(displayNameFor('discord')).toBe('Discord');
    expect(displayNameFor('')).toBe('');
  });

  it('has a well-formed alias table', () => {
    const phrases = new Set<string>();
    for (const alias of APP_ALIASES) {
      expect(alias.names.length, alias.display).toBeGreaterThan(0);
      for (const phrase of alias.phrases) {
        expect(normalizeAppName(phrase), phrase).toBe(phrase);
        expect(phrases.has(phrase), `duplicate phrase ${phrase}`).toBe(false);
        phrases.add(phrase);
      }
      for (const name of alias.names) expect(normalizeAppName(name)).toBe(name);
      for (const process of alias.processes ?? []) expect(process).toBe(process.toLowerCase());
    }
  });
});

describe('scoreName', () => {
  it.each([
    ['notepad', 'notepad', 1],
    ['vs code', 'vscode', 0.97],
    ['task manager', 'taskmanager', 0.97],
    ['visual studio', 'visual studio code', 0.9],
    ['code', 'visual studio code', 0.7],
    ['notepad', 'notepad plus plus', 0.9],
    ['windows notepad', 'notepad', 0.8],
    ['spotfy', 'spotify', 0.85],
    ['notpad', 'notepad', 0.85],
    ['vis stu co', 'visual studio code', 0.71],
    ['note', 'notepad', 0.7],
  ])('scores %j against %j around %d', (query, key, expected) => {
    expect(scoreName(query, key)).toBeCloseTo(expected, 1);
  });

  it.each([
    ['', 'notepad'],
    ['notepad', ''],
    ['banana', 'notepad'],
    ['no', 'notepad'],
    ['wor', 'visual studio code'],
    ['word', 'ward robe'],
  ])('finds no relation between %j and %j', (query, key) => {
    expect(scoreName(query, key)).toBeLessThan(MIN_APP_SCORE);
  });

  it('keeps every non-exact score below the exact ones', () => {
    for (const [query, key] of [
      ['visual studio', 'visual studio code'],
      ['notepad', 'notepad plus plus'],
      ['chrome', 'google chrome'],
    ] as const) {
      expect(scoreName(query, key)).toBeLessThanOrEqual(0.96);
    }
  });
});

describe('rankApps', () => {
  it.each([
    ['notepad', 'Notepad'],
    ['Notepad', 'Notepad'],
    ['the notepad app', 'Notepad'],
    ['note pad', 'Notepad'],
    ['notpad', 'Notepad'],
    ['notepad plus plus', 'Notepad++'],
    ['vs code', 'Visual Studio Code'],
    ['vscode', 'Visual Studio Code'],
    ['code', 'Visual Studio Code'],
    ['visual studio code', 'Visual Studio Code'],
    ['chrome', 'Google Chrome'],
    ['google chrome', 'Google Chrome'],
    ['gogle chrome', 'Google Chrome'],
    ['chrome browser', 'Google Chrome'],
    ['edge', 'Microsoft Edge'],
    ['microsoft edge', 'Microsoft Edge'],
    ['teams', 'Microsoft Teams'],
    ['word', 'Word'],
    ['ms word', 'Word'],
    ['excel', 'Excel'],
    ['power point', 'PowerPoint'],
    ['one note', 'OneNote'],
    ['calc', 'Calculator'],
    ['calculator', 'Calculator'],
    ['explorer', 'File Explorer'],
    ['file explorer', 'File Explorer'],
    ['files', 'File Explorer'],
    ['task manager', 'Task Manager'],
    ['taskmgr', 'Task Manager'],
    ['settings', 'Settings'],
    ['windows settings', 'Settings'],
    ['terminal', 'Windows Terminal'],
    ['cmd', 'Command Prompt'],
    ['command prompt', 'Command Prompt'],
    ['powershell', 'Windows PowerShell'],
    ['paint', 'Paint'],
    ['snipping tool', 'Snipping Tool'],
    ['snip', 'Snipping Tool'],
    ['spotify', 'Spotify'],
    ['spotfy', 'Spotify'],
    ['discord', 'Discord'],
    ['photos', 'Photos'],
    ['store', 'Microsoft Store'],
    ['github desktop', 'GitHub Desktop'],
    ['node js', 'Node.js'],
    ['python', 'Python 3.12'],
    ['7 zip', '7-Zip File Manager'],
    ['firefox', 'Mozilla Firefox'],
    ['control panel', 'Control Panel'],
  ])('puts %j first: %s', (query, expected) => {
    expect(top(query)[0]).toBe(expected);
  });

  it('prefers the exact name over partial ones', () => {
    const [first, second] = rankApps('notepad', CATALOG);
    expect(first).toMatchObject({ app: { name: 'Notepad' }, score: 1 });
    expect(second?.app.name).toBe('Notepad++');
    expect(second?.score ?? 1).toBeLessThan(0.97);
  });

  it('gives aliases a score just below an exact name', () => {
    const [match] = rankApps('vs code', CATALOG);
    expect(match?.score).toBeCloseTo(0.98, 5);
  });

  it('returns several close candidates for an ambiguous name', () => {
    const names = top('visual studio', 3);
    expect(names).toHaveLength(3);
    expect(names).toEqual(
      expect.arrayContaining([
        'Visual Studio Code',
        'Visual Studio 2022',
        'Visual Studio Installer',
      ]),
    );
  });

  it('ranks a bare "word" above WordPad', () => {
    const [word, wordpad] = rankApps('word', CATALOG);
    expect(word?.app.name).toBe('Word');
    expect(wordpad?.app.name).toBe('WordPad');
    expect((word?.score ?? 0) - (wordpad?.score ?? 0)).toBeGreaterThan(0.2);
  });

  it('keeps well-known apps ahead of look-alike words', () => {
    expect(top('microsoft').slice(0, 3)).toEqual(
      expect.arrayContaining(['Microsoft Edge', 'Microsoft Teams']),
    );
    expect(top('windows')).toEqual(expect.arrayContaining(['Windows Terminal']));
  });

  it('breaks ties in favour of built-ins, then shorter names', () => {
    const catalog = [app('Zed Editor'), app('Zed', 'builtin', 'zed.exe'), app('Zed', 'shortcut')];
    expect(rankApps('zed', catalog).map((match) => match.app.target)).toEqual([
      'zed.exe',
      'C:\\Programs\\Zed.lnk',
      'C:\\Programs\\Zed Editor.lnk',
    ]);
  });

  it('honours the limit and returns nothing for unknown or empty queries', () => {
    expect(rankApps('visual', CATALOG, 2)).toHaveLength(2);
    expect(rankApps('visual', CATALOG, 0)).toHaveLength(1);
    expect(rankApps('qwertyuiop', CATALOG)).toEqual([]);
    expect(rankApps('', CATALOG)).toEqual([]);
    expect(rankApps('   ', CATALOG)).toEqual([]);
    expect(rankApps('notepad', [])).toEqual([]);
  });

  it('only returns scores between the threshold and 1', () => {
    for (const query of ['note', 'vis', 'micro', 'win', 'g', 'edge', 'stu']) {
      for (const match of rankApps(query, CATALOG, 25)) {
        expect(match.score).toBeGreaterThanOrEqual(MIN_APP_SCORE);
        expect(match.score).toBeLessThanOrEqual(1);
      }
    }
  });
});
