const UNITS: ReadonlyArray<readonly [name: string, seconds: number]> = [
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 days and 4 hours", "45 minutes", "less than a minute" (at most `maxParts` units). */
export function describeDuration(totalSeconds: number, maxParts = 2): string {
  let remaining = Math.max(0, Math.round(totalSeconds));
  if (remaining < 60) return 'less than a minute';

  const parts: string[] = [];
  for (const [name, size] of UNITS) {
    const count = Math.floor(remaining / size);
    remaining -= count * size;
    if (count > 0) parts.push(`${count} ${name}${count === 1 ? '' : 's'}`);
  }
  return parts.slice(0, maxParts).join(' and ');
}
