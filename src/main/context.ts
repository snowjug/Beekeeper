import type { AppLogger } from './logging';
import type { AiService } from './ai/aiService';
import type { AppPaths } from './paths';
import type { AssistantService } from './assistant/assistantService';
import type { CircleWindowController } from './circle/windowController';
import type { WakeWordController } from './wake/controller';
import type { ConfirmationServiceImpl } from './services/confirmation';
import type { HistoryServiceImpl } from './services/history';
import type { ModelManager } from './services/modelManager';
import type { SecureKeys } from './services/secureKeys';
import type { SettingsStore } from './services/settingsStore';
import type { TimersServiceImpl } from './services/timers';
import type { NotesService } from './commands/types';
import type { HotkeyManager } from './hotkeys';
import type { TrayController } from './tray';
import type { UpdateController } from './updater';
import type { AssistantController } from './windows/assistantController';
import type { EdgeGlowController } from './windows/edgeGlow';
import type { WindowManager } from './windows/manager';
import type { WindowOpeners } from './windows/openers';
import type { SettingsView } from '@shared/settings';
import type { TrayStateMachine } from './trayState';

/** Everything the IPC handlers and feature modules share. Built once in bootstrap(). */
export interface AppContext {
  paths: AppPaths;
  logger: AppLogger;
  dev: boolean;
  packaged: boolean;
  /** True when running the portable build (no auto-update, no install location). */
  portable: boolean;
  settings: SettingsStore;
  keys: SecureKeys;
  windows: WindowManager;
  openers: WindowOpeners;
  assistant: AssistantController;
  assistantService: AssistantService;
  edgeGlow: EdgeGlowController;
  circle: CircleWindowController;
  ai: AiService;
  wake: WakeWordController;
  tray: TrayController;
  trayState: TrayStateMachine;
  hotkeys: HotkeyManager;
  history: HistoryServiceImpl;
  notes: NotesService;
  timers: TimersServiceImpl;
  confirmations: ConfirmationServiceImpl;
  models: ModelManager;
  updates: UpdateController;
  settingsView: () => SettingsView;
  quit: () => void;
}
