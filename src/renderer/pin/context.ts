import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { PinController, PinState, PinStateActions } from './controller';

export const PinControllerContext = createContext<PinController | null>(null);

export function usePinController(): PinController {
  const controller = useContext(PinControllerContext);
  if (!controller) throw new Error('PinController is not provided.');
  return controller;
}

/** Selects a slice of the pin's store; the component re-renders when that slice changes. */
export function usePin<T>(selector: (state: PinState & PinStateActions) => T): T {
  return useStore(usePinController().store, selector);
}
