import { createContext, useContext } from 'react';
import type { AssistantController } from './controller';

export const ControllerContext = createContext<AssistantController | null>(null);

export function useController(): AssistantController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('AssistantController is not provided');
  return controller;
}
