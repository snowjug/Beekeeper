import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { Settings, SettingsView } from '@shared/settings';
import type { SettingsController } from './controller';
import { changesOf, patchOf, type PatchSection } from './lib/patch';
import type { SettingsState } from './store';

const ControllerContext = createContext<SettingsController | null>(null);

export interface SettingsProviderProps {
  controller: SettingsController;
  children: ReactNode;
}

export function SettingsProvider({ controller, children }: SettingsProviderProps) {
  return <ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider>;
}

export function useController(): SettingsController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('SettingsProvider is missing.');
  return controller;
}

export function useSettingsStore<T>(selector: (state: SettingsState) => T): T {
  return useStore(useController().store, selector);
}

/** The settings as shown right now (confirmed values plus changes still being saved). */
export function useView(): SettingsView {
  const view = useSettingsStore((state) => state.view);
  if (view === null) throw new Error('Settings are not loaded yet.');
  return view;
}

/** Setter for one section: every call sends exactly one minimal patch. */
export function useSetter<S extends PatchSection>(
  section: S,
): <K extends keyof Settings[S]>(key: K, value: Settings[S][K]) => void {
  const controller = useController();
  return useCallback(
    <K extends keyof Settings[S]>(key: K, value: Settings[S][K]): void => {
      void controller.update(patchOf(section, key, value));
    },
    [controller, section],
  );
}

/** Updater for a choice that changes several keys of one section at once (one patch, changed keys only). */
export function useSectionUpdater<S extends PatchSection>(
  section: S,
): (values: Partial<Settings[S]>) => void {
  const controller = useController();
  return useCallback(
    (values: Partial<Settings[S]>): void => {
      const view = controller.store.getState().view;
      const patch = view === null ? null : changesOf(view, section, values);
      if (patch) void controller.update(patch);
    },
    [controller, section],
  );
}
