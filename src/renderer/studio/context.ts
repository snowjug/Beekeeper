import { createContext, useContext, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { Viewport } from './layout';
import type { StudioController } from './controller';
import type { StudioActions, StudioState } from './store';

export const ControllerContext = createContext<StudioController | null>(null);

export function useController(): StudioController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('StudioController is not provided.');
  return controller;
}

/** Selects a slice of the Studio store; the component re-renders when that slice changes. */
export function useStudio<T>(selector: (state: StudioState & StudioActions) => T): T {
  return useStore(useController().store, selector);
}

/** The size of the window in CSS pixels, kept up to date while it is resized. */
export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const update = (): void =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return viewport;
}
