import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/ipc/types';
import { logFailure, type OnboardingBridge } from '../bridge';
import { applyTheme, systemTheme, type Theme } from '../theme';

export interface Appearance {
  theme: Theme;
  /** 'none' = no system backdrop, the root paints a solid surface itself. */
  material: AppInfo['material'];
}

/** Resolved colour scheme and window material; follows `theme:changed` live. */
export function useAppearance(bridge: OnboardingBridge): Appearance {
  // Until app:info answers, assume the OS scheme and a transparent page (the window itself
  // already paints the solid fallback colour when there is no system backdrop).
  const [appearance, setAppearance] = useState<Appearance>(() => ({
    theme: systemTheme(),
    material: 'mica',
  }));

  useEffect(() => {
    let alive = true;
    let themeEvents = 0;
    const off = bridge.on('theme:changed', ({ theme }) => {
      themeEvents += 1;
      if (alive) setAppearance((current) => ({ ...current, theme }));
    });
    bridge
      .invoke('app:info')
      .then((info) => {
        if (!alive) return;
        setAppearance((current) => ({
          theme: themeEvents > 0 ? current.theme : info.theme,
          material: info.material,
        }));
      })
      .catch((error: unknown) => logFailure(bridge, 'app:info', error));
    return () => {
      alive = false;
      off();
    };
  }, [bridge]);

  useEffect(() => {
    applyTheme(appearance.theme);
  }, [appearance.theme]);

  return appearance;
}
