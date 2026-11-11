import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import type { HistoryEntry } from '@shared/cards';
import { Button, IconButton } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';
import { formatRelativeTime } from '@renderer/lib/format';
import { staggerContainer, staggerItem } from '@renderer/motion/variants';
import { useController } from './context';
import { useAssistantStore } from './store';

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const controller = useController();
  const icon = entry.source === 'voice' ? 'mic' : entry.source === 'circle' ? 'circle' : 'keyboard';
  return (
    <motion.li
      variants={staggerItem}
      className="group flex items-start gap-3 rounded-control px-3 py-2.5 hover:bg-raised-hover"
    >
      <span className="mt-0.5 text-fg-faint">
        <Icon name={icon} size={16} />
      </span>
      <div className="min-w-0 flex-1" data-selectable="true">
        <p className="truncate text-[15px] font-medium">{entry.text}</p>
        {entry.summary ? (
          <p className="truncate text-[13px] text-fg-muted">{entry.summary}</p>
        ) : null}
        <p className="text-[12px] text-fg-faint">{formatRelativeTime(entry.at)}</p>
      </div>
      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton
          size="sm"
          icon="refresh"
          label={`Run "${entry.text}" again`}
          onClick={() => void controller.submit(entry.text, 'chip')}
        />
        <IconButton
          size="sm"
          icon="copy"
          label="Copy"
          onClick={() => void controller.copyText(entry.text)}
        />
      </div>
    </motion.li>
  );
}

/** Searchable list of the last 200 interactions (spec 4.9) with a clear button. */
export function HistoryPanel() {
  const controller = useController();
  const history = useAssistantStore((state) => state.history);
  const query = useAssistantStore((state) => state.historyQuery);
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <section aria-label="History" className="flex min-h-0 flex-1 flex-col px-3 pt-3">
      <div className="flex items-center gap-2 px-1 pb-2">
        <IconButton
          size="sm"
          icon="chevron-right"
          label="Back"
          className="rotate-180"
          onClick={() => controller.closeHistory()}
        />
        <h2 className="flex-1 text-[15px] font-semibold">History</h2>
        {confirmClear ? (
          <>
            <span className="text-[13px] text-fg-muted">Clear everything?</span>
            <Button
              size="sm"
              variant="danger"
              onClick={() => void controller.clearHistory().then(() => setConfirmClear(false))}
            >
              Clear
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon="trash-can"
            disabled={history.length === 0 && query === ''}
            onClick={() => setConfirmClear(true)}
          >
            Clear
          </Button>
        )}
      </div>

      <label className="mx-1 mb-2 flex items-center gap-2 rounded-control bg-sunken px-3">
        <Icon name="search" size={16} />
        <span className="sr-only">Search history</span>
        <input
          value={query}
          onChange={(event) => void controller.loadHistory(event.target.value)}
          placeholder="Search history"
          className="h-9 w-full bg-transparent text-[14px] placeholder:text-fg-faint focus:outline-none"
        />
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <AnimatePresence mode="wait">
          {history.length === 0 ? (
            <motion.p
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="px-3 py-8 text-center text-[14px] text-fg-muted"
            >
              {query
                ? 'Nothing matches your search.'
                : 'Nothing here yet. Your requests will show up here.'}
            </motion.p>
          ) : (
            <motion.ul key="list" variants={staggerContainer} initial="hidden" animate="visible">
              {history.map((entry) => (
                <HistoryRow key={entry.id} entry={entry} />
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
