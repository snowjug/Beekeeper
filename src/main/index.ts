import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 720,
    height: 200,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/assistant.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(`${devUrl}/assistant/index.html`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/assistant/index.html'));
  }
}

void app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
