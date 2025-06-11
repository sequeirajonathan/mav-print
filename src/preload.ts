import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { PrintCommand, PrintResponse, PrintJobUpdate } from './types';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  agentId: process.env.AGENT_ID || 'agent-unknown',
  sendPrintCommand: (command: PrintCommand) => ipcRenderer.send('print-command', command),
  onPrintResponse: (callback: (event: IpcRendererEvent, response: PrintResponse) => void) => 
    ipcRenderer.on('print-response', callback),
  onPrintJobUpdate: (callback: (event: IpcRendererEvent, payload: PrintJobUpdate) => void) => 
    ipcRenderer.on('print-job-update', callback),
  onSignOut: (callback: () => void) => {
    console.log('Registering electron-sign-out listener');
    const wrappedCallback = () => {
      console.log('Received electron-sign-out event');
      callback();
    };
    ipcRenderer.on('electron-sign-out', wrappedCallback);
    return () => {
      console.log('Removing electron-sign-out listener');
      ipcRenderer.removeListener('electron-sign-out', wrappedCallback);
    };
  },
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
  on: (channel: string, listener: (...args: any[]) => void) => ipcRenderer.on(channel, listener),
}); 