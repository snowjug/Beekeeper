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
  it('stands the glow still, fully drawn, with nothing that snaps in', async () => {
    prefersReducedMotion();
    await renderStudio();
    const frame = screen.getByTestId('studio-frame');
    expect(frame).toHaveAttribute('data-still', 'true');
    expect(frame).toHaveAttribute('data-glow', 'on');
    expect(frame.querySelector('.bk-studio-glow')).not.toBeNull();
    expect(frame.querySelector('.bk-studio-ring')).not.toBeNull();
    expect(frame.querySelectorAll('.bk-bracket')).toHaveLength(0);
    // The picture is there at once: no fade or zoom from nothing.
    expect(frame.style.opacity).toBe('1');
    expect(frame.style.transform).toBe('none');
  });
});
