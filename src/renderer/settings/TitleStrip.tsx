import { BrandMark } from './ui/BrandMark';

/**
 * Space on the right taken by the native caption buttons (Windows draws them over the page): the
 * page width minus the title-bar-overlay area, with a sensible fallback (3 x 46px) when the
 * environment variables are not available.
 */
const CAPTION_INSET =
  'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 138px)))';

/** 40px draggable strip that replaces the hidden title bar. Nothing interactive lives in it. */
export function TitleStrip() {
  return (
    <header
      className="flex h-10 shrink-0 items-center gap-2.5 pl-4 [-webkit-app-region:drag]"
      style={{ paddingRight: CAPTION_INSET }}
    >
      <BrandMark size={18} />
      <span className="text-[12px] font-medium text-fg-muted">Beekeeper Settings</span>
    </header>
  );
}
