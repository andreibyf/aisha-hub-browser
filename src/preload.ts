// src/preload.ts
import { contextBridge } from 'electron';
import { startAgui, stopAgui } from './agent/agui-client';

contextBridge.exposeInMainWorld('agui', {
  start: (url: string, opts?: { showPanel?: boolean }) => startAgui(url, opts),
                                stop: () => stopAgui()
});

