import { clipboard, ClipboardItem, type ClipboardBookmark } from 'electron';
import type { ClipboardPort } from '../system/inputInjector';

type Payload = Blob | ClipboardBookmark;

/** Electron's promise-based clipboard as the paste mode needs it. */
export function createElectronClipboard(): ClipboardPort {
  return {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text),

    // Every format is read now (a Blob is a copy), so it can be put back whatever happens later.
    async snapshot() {
      const copies: ClipboardItem[] = [];
      for (const item of await clipboard.read()) {
        // An empty clipboard comes back as one item without any format.
        if (item.types.length === 0) continue;
        const parts: Record<string, Payload> = {};
        for (const type of item.types) parts[type] = await item.getType(type);
        copies.push(new ClipboardItem(parts));
      }
      return copies;
    },

    async restore(snapshot) {
      const items = snapshot as ClipboardItem[];
      if (items.length === 0) clipboard.clear();
      else await clipboard.write(items);
    },
  };
}
