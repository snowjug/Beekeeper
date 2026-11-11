import { describe, expect, it, vi } from 'vitest';
import type { StatusCard, TextCard } from '@shared/cards';
import { briefingCommand } from '@main/commands/info/briefing';
import { repeatCommand } from '@main/commands/assistant/repeat';
import type { TimerRecord } from '@main/commands/types';
import { createFakeServices, matchOf, runContext, sampleForecast } from '../helpers';

// Thursday 12 November 2026
const MORNING = new Date(2026, 10, 12, 8, 30);
const AFTERNOON = new Date(2026, 10, 12, 14, 0);
const EVENING = new Date(2026, 10, 12, 19, 0);

function record(label: string, hour: number, type: TimerRecord['type'] = 'reminder'): TimerRecord {
  const endsAt = new Date(2026, 10, 12, hour, 30).getTime();
  return {
    id: `t-${label}`,
    type,
    label,
    durationMs: 0,
    startedAt: MORNING.getTime(),
    endsAt,
    state: 'running',
  };
}

describe('briefing: phrases', () => {
  it.each([
    'good morning',
    'Good evening Beekeeper',
    'good afternoon',
    'brief me',
    'catch me up',
    'give me my daily briefing',
    'morning briefing',
    'what does my day look like',
    "what's on today",
    'how is my day looking',
  ])('%s', (text) => {
    expect(matchOf(briefingCommand, text)?.score).toBeGreaterThanOrEqual(0.8);
  });

  it.each(['good', 'morning news', 'what is the weather', 'open mail', 'good night'])(
    'ignores %s',
    (text) => {
      expect(matchOf(briefingCommand, text)).toBeNull();
    },
  );
});

describe('briefing: answer', () => {
  it('covers the date, the weather, today\u2019s reminders and the notes', async () => {
    const services = createFakeServices();
    services.timers.list = vi.fn(() => [
      record('Call Mom', 17),
      record('Standup', 10),
      { ...record('Dentist', 10), endsAt: new Date(2026, 10, 13, 10).getTime() },
    ]);
    services.notes.list = vi.fn(() => ({ notes: [], total: 3 }));
    const ctx = runContext({ now: MORNING, services });

    const result = await briefingCommand.run({}, ctx);

    expect(result.pin).toBe(true);
    expect(result.speech).toContain("Good morning! It's Thursday, November 12.");
    expect(result.speech).toContain(
      "In Paris it's 18 degrees and partly cloudy, with a high of 21.",
    );
    expect(result.speech).toContain(
      'You have 2 reminders or timers today: Standup at 10:30 AM, then Call Mom at 5:30 PM.',
    );
    expect(result.speech).toContain('You have 3 saved notes.');
    expect(result.speech).toMatch(/Have a great day!$/);

    const card = result.cards[0] as TextCard;
    expect(card.kind).toBe('text');
    expect(card.markdown).toContain('**Paris** — 18°C, partly cloudy');
    expect(card.markdown).toContain('- Standup at 10:30 AM');
    expect(card.copyText).not.toContain('**');
    expect(card.actions?.map((action) => action.label)).toEqual(['Weather', 'My notes']);
  });

  it('mentions rain when it is likely', async () => {
    const services = createFakeServices();
    const forecast = sampleForecast();
    forecast.days[0] = { ...forecast.days[0]!, precipChance: 70 };
    services.weather.forecast = vi.fn(() => Promise.resolve(forecast));
    const result = await briefingCommand.run({}, runContext({ now: MORNING, services }));
    expect(result.speech).toContain('with a 70 percent chance of rain');
  });

  it('skips the weather when it cannot be fetched and says the day is clear', async () => {
    const services = createFakeServices();
    services.weather.forecast = vi.fn(() => Promise.reject(new Error('offline')));
    const result = await briefingCommand.run({}, runContext({ now: MORNING, services }));
    expect(result.speech).toBe(
      "Good morning! It's Thursday, November 12. Your day looks clear. Have a great day!",
    );
    const card = result.cards[0] as TextCard;
    expect(card.markdown).toBe('**Thursday, November 12**');
  });

  it('greets by time of day and lists at most three items', async () => {
    const services = createFakeServices();
    services.weather.forecast = vi.fn(() => Promise.reject(new Error('offline')));
    services.timers.list = vi.fn(() => [
      record('One', 15),
      record('Two', 16),
      record('Three', 17),
      record('Four', 18),
      record('Five', 20, 'alarm'),
    ]);
    const afternoon = await briefingCommand.run({}, runContext({ now: AFTERNOON, services }));
    expect(afternoon.speech).toMatch(/^Good afternoon!/);
    expect(afternoon.speech).toContain(
      '5 reminders or timers today: One at 3:30 PM, then Two at 4:30 PM, then Three at 5:30 PM, and 2 more.',
    );
    expect(afternoon.speech).toMatch(/Anything else I can do\?$/);

    const evening = await briefingCommand.run({}, runContext({ now: EVENING, services }));
    expect(evening.speech).toMatch(/^Good evening!/);
  });

  it('describes timers by their end time', async () => {
    const services = createFakeServices();
    services.weather.forecast = vi.fn(() => Promise.reject(new Error('offline')));
    services.timers.list = vi.fn(() => [record('Pasta', 9, 'timer'), record('', 10, 'alarm')]);
    const result = await briefingCommand.run({}, runContext({ now: MORNING, services }));
    expect(result.speech).toContain('Pasta (ends 9:30 AM), then Alarm at 10:30 AM');
  });
});

describe('repeat', () => {
  it.each([
    'repeat that',
    'say that again',
    'read that again',
    'read that out loud',
    'what did you say',
    'could you repeat that again',
    'come again',
  ])('%s', (text) => {
    expect(matchOf(repeatCommand, text)?.score).toBeGreaterThanOrEqual(0.8);
  });

  it('does not take over other requests', () => {
    expect(matchOf(repeatCommand, 'repeat the timer every day')).toBeNull();
    expect(matchOf(repeatCommand, 'read my notes')).toBeNull();
  });

  it('speaks the last answer again without markdown', async () => {
    const services = createFakeServices();
    services.ui.getLastAnswerText = vi.fn(
      () => '**Sunny** in [Paris](https://example.com) at 18°C',
    );
    const result = await repeatCommand.run({}, runContext({ services }));
    expect(result.speech).toBe('Sunny in Paris at 18 degrees Celsius');
    expect((result.cards[0] as StatusCard).title).toBe('Saying that again');
  });

  it('says so when there is nothing to repeat', async () => {
    const result = await repeatCommand.run({}, runContext());
    expect(result.speech).toBe("I haven't said anything yet.");
    expect((result.cards[0] as StatusCard).title).toBe('Nothing to repeat yet');
  });
});
