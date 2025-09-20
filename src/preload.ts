// src/preload.ts
import { contextBridge } from 'electron';
import { startAgui, stopAgui } from './agent';

declare global {
  interface Window {
    agui: {
      start: (url: string, opts?: { showPanel?: boolean }) => void;
      stop: () => void;
    };
  }
}

contextBridge.exposeInMainWorld('agui', {
  start: (url: string, opts?: { showPanel?: boolean }) => startAgui(url, opts),
                                stop: () => stopAgui()
});


