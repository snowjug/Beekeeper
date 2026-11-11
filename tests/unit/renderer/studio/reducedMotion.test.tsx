import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderStudio } from './support';

// Kept in a file of its own: the motion library reads the OS preference once, on first use.
function prefersReducedMotion(): void {
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('with reduced motion', () => {
  it('stands the glow frame still and shows the corner brackets at once', async () => {
    prefersReducedMotion();
    await renderStudio();
    const frame = screen.getByTestId('studio-frame');
    expect(frame).toHaveAttribute('data-still', 'true');
    expect(frame).toHaveAttribute('data-glow', 'on');
    const brackets = frame.querySelectorAll<HTMLElement>('.bk-bracket');
    expect(brackets).toHaveLength(4);
    for (const bracket of brackets) {
      expect(bracket.style.opacity).toBe('1');
      expect(bracket.style.transform).toBe('none');
    }
  });
});
