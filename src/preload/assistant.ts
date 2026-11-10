import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('beekeeper', { role: 'assistant' as const });
