/** Short replies to a question the assistant just asked: "हाँ", "5 मिनट", "शाम 6 बजे". */
import { accounted, type Rule } from './common';

const CONFIRM_ALLOWED = ['YES', 'DEL', 'ALL', 'THAT', 'NOTE', 'NOTES'];

/** "हाँ", "जी हाँ, सब हटा दो": the confirmation of a question. */
export const yesRule: Rule = (u) =>
  u.has('YES') && !u.has('NO', 'PAST') && accounted(u, CONFIRM_ALLOWED) ? 'yes' : null;

const DURATION_ANSWER = ['DUR', 'FOR', 'IN', 'AFTER', 'KA', 'NOW'];

/** "5 मिनट", "दस मिनट बाद": how long, when a timer or reminder asked for it. */
export const durationAnswerRule: Rule = (u) => {
  const duration = u.find('DUR');
  if (duration === undefined || u.count('DUR') !== 1 || u.has('NO', 'PAST')) return null;
  if (!accounted(u, DURATION_ANSWER) || duration.payload === undefined) return null;
  return `in ${duration.payload}`;
};

const CLOCK_ANSWER = ['CLK', 'FOR', 'KA', 'NOW', 'ON'];

/** "शाम 6 बजे", "कल सुबह नौ बजे": at what time, when an alarm or reminder asked for it. */
export const clockAnswerRule: Rule = (u) => {
  const clock = u.find('CLK');
  if (clock === undefined || u.count('CLK') !== 1 || u.has('NO', 'PAST')) return null;
  if (!accounted(u, CLOCK_ANSWER) || clock.time === undefined) return null;
  return `${clock.day === undefined ? '' : `${clock.day} `}at ${clock.time}`;
};
