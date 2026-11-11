/** Rules for talking to the assistant itself: stop, help, circle to search. */
import { accounted, type Rule } from './common';

export const stopRule: Rule = (u) => {
  const content = u.content();
  if (content.length === 0) return null;
  if (u.has('NEVERMIND')) {
    return accounted(u, ['NEVERMIND', 'NO', 'KA', 'ME', 'THAT', 'ON']) ? 'never mind' : null;
  }
  if (u.has('NO')) return null;
  if (!accounted(u, ['STOPW', 'OFF', 'QUIET', 'CANCEL', 'THAT', 'ME', 'NOW', 'KO', 'GO']))
    return null;
  if (u.has('QUIET')) return 'be quiet';
  if (u.has('CANCEL')) return 'cancel';
  return 'stop';
};

export const helpRule: Rule = (u) => {
  if (u.has('NO', 'PAST')) return null;
  if (
    u.has('CAN') &&
    u.has('WHAT') &&
    accounted(u, ['WHAT', 'CAN', 'YOU', 'ALL', 'ME', 'I', 'SAY', 'TELL'])
  ) {
    if (u.has('SAY') || (u.has('I') && !u.has('YOU'))) return 'what can i say';
    return u.has('YOU') || u.has('DO') ? 'what can you do' : null;
  }
  if (u.has('HELP') && accounted(u, ['HELP', 'ME', 'MY', 'KA', 'KO', 'TELL', 'I'])) return 'help';
  if (u.has('COMMANDS') && accounted(u, ['COMMANDS', 'TELL', 'ME', 'ALL', 'KA', 'MY'])) {
    return 'show commands';
  }
  return null;
};

export const circleRule: Rule = (u) => {
  if (u.has('NO', 'PAST')) return null;
  const verbs = ['START', 'OPEN', 'PLAY', 'SET', 'ME', 'KO', 'KA', 'SEARCH', 'TELL'];
  if (u.has('CIRCLETOSEARCH') && accounted(u, ['CIRCLETOSEARCH', ...verbs])) {
    return 'circle to search';
  }
  if (u.has('CIRCLE') && u.has('SEARCH') && accounted(u, ['CIRCLE', ...verbs])) {
    return 'circle to search';
  }
  if (u.has('CIRCLE') && u.has('THAT') && accounted(u, ['CIRCLE', 'THAT', 'ME', 'KO'])) {
    return 'circle this';
  }
  if (
    u.has('SCREEN') &&
    u.has('SEARCH') &&
    accounted(u, ['SCREEN', 'SEARCH', 'ON', 'KO', 'KA', 'ME', 'MY', 'THAT', 'IN'])
  ) {
    return 'search my screen';
  }
  if (
    u.has('SCREEN') &&
    u.has('WHAT') &&
    accounted(u, ['SCREEN', 'WHAT', 'ON', 'IN', 'KA', 'MY', 'TELL', 'ME'])
  ) {
    return "what's on my screen";
  }
  return null;
};

// ---------------------------------------------------------------------------
// Briefing, repeat, dictation: "गुड मॉर्निंग", "फिर से बोलो", "डिक्टेशन शुरू करो"
// ---------------------------------------------------------------------------

export const briefingRule: Rule = (u) => {
  if (u.has('NO', 'PAST')) return null;
  if (u.has('GREET') && accounted(u, ['GREET', 'ME'])) return 'good morning';
  const framing = ['TELL', 'PLAY', 'ME', 'MY', 'KA', 'KO', 'NOW', 'TODAY', 'MORNING', 'NEW'];
  if (u.has('BRIEFING') && accounted(u, ['BRIEFING', ...framing])) return 'give me my briefing';
  const day = ['DAY', 'HOW', 'MY', 'TODAY', 'KA', 'FUT', 'NOW', 'ME', 'WHAT'];
  return u.has('DAY') && u.has('HOW') && accounted(u, day) ? 'what does my day look like' : null;
};

export const repeatRule: Rule = (u) => {
  if (u.has('NO', 'PAST')) return null;
  const framing = ['THAT', 'AGAIN', 'ME', 'KO', 'KA', 'TELL', 'SAY', 'PLAY', 'ON', 'ANSWER'];
  if (u.has('REPEAT') && accounted(u, ['REPEAT', ...framing])) return 'repeat that';
  if (u.has('AGAIN') && u.has('TELL', 'SAY', 'PLAY') && accounted(u, framing)) {
    return 'repeat that';
  }
  const asked = ['WHAT', 'SAY', 'YOU', 'THAT'];
  return u.has('WHAT') && u.has('SAY') && accounted(u, asked) ? 'what did you say' : null;
};

export const dictateRule: Rule = (u) => {
  if (u.has('NO', 'PAST')) return null;
  const framing = [
    'START',
    'OPEN',
    'PLAY',
    'SET',
    'MODE',
    'ME',
    'MY',
    'KA',
    'KO',
    'ON',
    'NOW',
    'PUT',
  ];
  if (u.has('DICTATE') && accounted(u, ['DICTATE', ...framing])) return 'start dictation';
  if (u.has('VOICE') && u.has('TYPE') && accounted(u, ['VOICE', 'TYPE', ...framing])) {
    return 'voice typing';
  }
  const spoken = ['TYPE', 'WRITE', 'SAY', 'I', 'THAT', 'ME'];
  if (!u.has('TYPE', 'WRITE') || !u.has('SAY') || !accounted(u, spoken)) return null;
  return u.has('I') ? 'type what i say' : 'start dictation';
};
