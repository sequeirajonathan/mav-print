import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { PrintCommand, PrintResponse, PrintJobUpdate } from './types';

// The same preload serves the local settings window and the remote MAV web
// app, so only these channels are exposed. The main process additionally
// checks which window each settings request comes from.
const INVOKE_CHANNELS = new Set([
  'get-settings',
  'save-settings',
  'reload-with-settings',
  'check-settings-configured',
  'get-available-printers',
  'get-printer-info',
]);
const SEND_CHANNELS = new Set(['print-command', 'quit-app']);
const LISTEN_CHANNELS = new Set(['print-response', 'print-job-update', 'electron-sign-out']);

contextBridge.exposeInMainWorld('electron', {
  agentId: process.env.AGENT_ID || 'agent-unknown',
  sendPrintCommand: (command: PrintCommand) => ipcRenderer.send('print-command', command),
  onPrintResponse: (callback: (event: IpcRendererEvent, response: PrintResponse) => void) =>
    ipcRenderer.on('print-response', callback),
  onPrintJobUpdate: (callback: (event: IpcRendererEvent, payload: PrintJobUpdate) => void) =>
    ipcRenderer.on('print-job-update', callback),
  onSignOut: (callback: () => void) => {
    const wrappedCallback = () => callback();
    ipcRenderer.on('electron-sign-out', wrappedCallback);
    return () => ipcRenderer.removeListener('electron-sign-out', wrappedCallback);
  },
  /** Called by the MAV web app with the signed-in print agent's session (null on sign-out). */
  setAuthSession: (session: unknown) => ipcRenderer.send('auth-session', session),
  invoke: (channel: string, ...args: unknown[]) => {
    if (!INVOKE_CHANNELS.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  send: (channel: string, ...args: unknown[]) => {
    if (!SEND_CHANNELS.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    ipcRenderer.send(channel, ...args);
  },
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    if (!LISTEN_CHANNELS.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    ipcRenderer.on(channel, listener);
  },
});
