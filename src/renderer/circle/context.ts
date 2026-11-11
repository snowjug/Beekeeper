import { createContext, useContext } from 'react';
import type { CircleController } from './controller';

export const ControllerContext = createContext<CircleController | null>(null);

export function useController(): CircleController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('CircleController is not provided.');
  return controller;
}
