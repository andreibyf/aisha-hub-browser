
// src/preload.js - minimal bridge for an external agent to drive the UI safely
const { contextBridge } = require('electron');

function q(sel) { return Array.from(document.querySelectorAll(sel)); }

contextBridge.exposeInMainWorld('agent', {
  click: (selector, idx=0) => { const el = q(selector)[idx]; if (!el) return false; el.click(); return true; },
  type:  (selector, text, idx=0) => { const el = q(selector)[idx]; if (!el) return false; el.focus(); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); return true; },
  readText: (selector, idx=0) => { const el = q(selector)[idx]; return el ? (el.innerText || el.value || "") : ""; },
  goto: (url) => { location.href = url; }
});
