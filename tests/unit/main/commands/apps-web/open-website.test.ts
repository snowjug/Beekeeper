import { describe, expect, it } from 'vitest';
import { openWebsiteCommand } from '@main/commands/apps-web/open-website';
import { isValidDomain, parseWebsite, restoreCase } from '@main/commands/apps-web/domain';
import { KNOWN_SITES, findKnownSite } from '@main/commands/apps-web/sites';
import { createHarness, match, runCommand, scoreOf, slotsOf } from './support';

describe('open-website matching', () => {
  it.each(openWebsiteCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(openWebsiteCommand, example)).not.toBeNull();
  });

  it.each([
    ['open github.com', 'https://github.com/', 'github.com'],
    ['go to example.org', 'https://example.org/', 'example.org'],
    ['visit https://news.ycombinator.com', 'https://news.ycombinator.com/', 'news.ycombinator.com'],
    ['open the website bbc.co.uk', 'https://bbc.co.uk/', 'bbc.co.uk'],
    ['navigate to openai.com/research', 'https://openai.com/research', 'openai.com'],
    ['browse to docs.python.org', 'https://docs.python.org/', 'docs.python.org'],
    ['take me to wikipedia.org', 'https://wikipedia.org/', 'wikipedia.org'],
    ['head to my-site.io', 'https://my-site.io/', 'my-site.io'],
    ['launch discord.com', 'https://discord.com/', 'discord.com'],
    ['open the site example.dev', 'https://example.dev/', 'example.dev'],
    ['open http://example.com/a?b=1', 'http://example.com/a?b=1', 'example.com'],
    ['open bücher.de', 'https://xn--bcher-kva.de/', 'xn--bcher-kva.de'],
    ['open example.com:8080/path', 'https://example.com:8080/path', 'example.com'],
    ['Hey Beekeeper, please open GitHub.com', 'https://github.com/', 'github.com'],
  ])('"%s" opens %s', (text, url, host) => {
    expect(slotsOf(openWebsiteCommand, text)).toEqual({ url, host });
  });

  it('keeps the case of paths and queries', () => {
    expect(slotsOf(openWebsiteCommand, 'open https://youtu.be/dQw4w9WgXcQ')).toEqual({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      host: 'youtu.be',
    });
    expect(slotsOf(openWebsiteCommand, 'go to GitHub.com/Microsoft/VSCode')).toEqual({
      url: 'https://github.com/Microsoft/VSCode',
      host: 'github.com',
    });
  });

  it('is surer with a verb or an explicit scheme than for a bare address', () => {
    expect(scoreOf(openWebsiteCommand, 'open github.com')).toBe(0.96);
    expect(scoreOf(openWebsiteCommand, 'open https://github.com')).toBe(0.98);
    expect(scoreOf(openWebsiteCommand, 'https://github.com')).toBe(0.9);
    expect(scoreOf(openWebsiteCommand, 'github.com')).toBe(0.72);
    expect(scoreOf(openWebsiteCommand, 'opne github.com')).toBe(0.85);
  });

  it.each([
    'open github',
    'open notepad',
    'open localhost',
    'go to localhost:3000',
    'open 192.168.1.1',
    'open readme.md',
    'open node.js',
    'open setup.exe',
    'open index.html',
    'open example.123',
    'open example.c',
    'open -bad.com',
    'open bad-.com',
    'open a..com',
    'open example.com extra words',
    'open ftp://example.com',
    'open file:///c:/windows/notepad.exe',
    'open javascript:alert(1)',
    'open data:text/html,hello',
    'open https://user:secret@example.com',
    'open ',
    'what is example.com',
    'search for example.com',
    'node.js',
    'readme.md',
    'v1.2',
    'open wifi settings',
  ])('does not open "%s"', (text) => {
    expect(match(openWebsiteCommand, text)).toBeNull();
  });
});

describe('open-website run', () => {
  it('opens the address and shows a status card with the link', async () => {
    const harness = createHarness();
    const result = await runCommand(
      openWebsiteCommand,
      { url: 'https://github.com/', host: 'github.com' },
      harness,
    );

    expect(harness.ui.openExternal).toHaveBeenCalledWith('https://github.com/');
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'success',
      icon: 'web',
      title: 'Opening github.com',
      detail: 'https://github.com/',
      copyText: 'https://github.com/',
      openUrl: 'https://github.com/',
    });
    expect(result.speech).toBe('Opening github.com.');
    expect(result.autoCloseMs).toBe(1500);
  });

  it.each([
    ['returns false', false],
    ['throws', () => Promise.reject(new Error('no browser'))],
  ] as const)('explains a browser that %s', async (_label, openExternal) => {
    const harness = createHarness({ openExternal });
    const result = await runCommand(
      openWebsiteCommand,
      { url: 'https://github.com/', host: 'github.com' },
      harness,
    );
    expect(result.cards[0]).toMatchObject({ tone: 'error', title: "I couldn't open your browser" });
  });
});

describe('domain validation', () => {
  it.each([
    'github.com',
    'a.co',
    'sub.domain.example.org',
    'xn--bcher-kva.de',
    'my-site.io',
    '123.example.com',
    'example.museum',
  ])('accepts %s', (host) => {
    expect(isValidDomain(host)).toBe(true);
  });

  it.each([
    '',
    'localhost',
    'example',
    'example.c',
    'example.123',
    'example.md',
    'readme.txt',
    '-a.com',
    'a-.com',
    'a..com',
    '.com',
    'exa mple.com',
    `${'a'.repeat(64)}.com`,
    `${'a.'.repeat(130)}com`,
    '192.168.1.1',
  ])('rejects %j', (host) => {
    expect(isValidDomain(host)).toBe(false);
  });

  it('adds https and rejects other schemes and credentials', () => {
    expect(parseWebsite('example.org')).toEqual({
      url: 'https://example.org/',
      host: 'example.org',
    });
    expect(parseWebsite('HTTP://Example.ORG/Path')).toEqual({
      url: 'http://example.org/Path',
      host: 'example.org',
    });
    expect(parseWebsite('ftp://example.org')).toBeNull();
    expect(parseWebsite('https://user@example.org')).toBeNull();
    expect(parseWebsite('exa mple.org')).toBeNull();
    expect(parseWebsite('')).toBeNull();
  });

  it('finds a token again in the original text', () => {
    expect(restoreCase('Open GitHub.com/Foo?', 'github.com/foo')).toBe('GitHub.com/Foo');
    expect(restoreCase('open something else', 'missing')).toBe('missing');
  });
});

describe('known sites', () => {
  it.each([
    ['youtube', 'YouTube'],
    ['gmail', 'Gmail'],
    ['github', 'GitHub'],
    ['reddit', 'Reddit'],
    ['x', 'X'],
    ['twitter', 'X'],
    ['facebook', 'Facebook'],
    ['instagram', 'Instagram'],
    ['netflix', 'Netflix'],
    ['amazon', 'Amazon'],
    ['linkedin', 'LinkedIn'],
    ['wikipedia', 'Wikipedia'],
    ['stack overflow', 'Stack Overflow'],
    ['stackoverflow', 'Stack Overflow'],
    ['chatgpt', 'ChatGPT'],
    ['outlook web', 'Outlook on the web'],
    ['the reddit website', 'Reddit'],
    ['youtub', 'YouTube'],
    ['googel maps', 'Google Maps'],
  ])('knows %s', (name, title) => {
    expect(findKnownSite(name)?.title).toBe(title);
  });

  it('does not invent sites', () => {
    expect(findKnownSite('')).toBeNull();
    expect(findKnownSite('the')).toBeNull();
    expect(findKnownSite('notepad')).toBeNull();
    expect(findKnownSite('frobnicator')).toBeNull();
  });

  it('only lists safe https addresses', () => {
    for (const site of KNOWN_SITES) {
      expect(site.url, site.title).toMatch(/^https:\/\/[a-z0-9.-]+\//);
      expect(isValidDomain(new URL(site.url).hostname), site.title).toBe(true);
    }
  });
});
