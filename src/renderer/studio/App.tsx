import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { ToastHost } from '@renderer/components/Toast';
import { tween } from '@renderer/motion/tokens';
import { AssistSheet } from './AssistSheet';
import { useController, useStudio } from './context';
import { Stage } from './Stage';

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
  );
}

/**
 * The Capture Studio overlay: a dimmed screen with the capture in the middle. Esc closes the topmost
 * thing (menu, sheet, review, editor, then the preview); Ctrl+C copies and Ctrl+S saves.
 */
export function App() {
  const controller = useController();
  const visible = useStudio((state) => state.visible);
  const session = useStudio((state) => state.session);
  const announcement = useStudio((state) => state.announcement);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      controller.noteActivity();
      // The editor handles Esc and undo itself while it is open.
      if (event.defaultPrevented) return;
      const state = controller.store.getState();
      if (!state.visible) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (state.menu) controller.closeMenu();
        else if (state.sheet.open) controller.closeSheet();
        else if (state.redaction.status !== 'idle') controller.cancelRedaction();
        else if (state.mode === 'edit') controller.cancelEdit();
        else controller.beginExit();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || state.mode !== 'view' || isTyping(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'c' && (window.getSelection()?.toString() ?? '') === '') {
        event.preventDefault();
        void controller.copy();
      } else if (key === 's') {
        event.preventDefault();
        void controller.save(event.shiftKey);
      }
    };
    const onActivity = (): void => controller.noteActivity();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointermove', onActivity, { passive: true });
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('wheel', onActivity, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointermove', onActivity);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('wheel', onActivity);
    };
  }, [controller]);

  // Keyboard focus starts inside the dialog.
  useEffect(() => {
    if (visible) dialog.current?.focus();
  }, [visible]);

  return (
    <div className="fixed inset-0 overflow-hidden" data-testid="studio-root">
      <AnimatePresence onExitComplete={() => void controller.acknowledgeClosed()}>
        {visible && session ? (
          <motion.div
            key={session.id}
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-label="Capture Studio"
            tabIndex={-1}
            className="absolute inset-0 outline-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: tween.base }}
            exit={{ opacity: 0, transition: tween.base }}
          >
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close preview"
              data-testid="studio-backdrop"
              className="absolute inset-0 cursor-default bg-black/50"
              onClick={() => controller.beginExit()}
            />
            <Stage />
            <AssistSheet />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <ToastHost className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" />
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
