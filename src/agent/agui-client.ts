/* src/agui-client.ts
 * Minimal AG-UI client for the RENDERER process (no Node APIs).
 * - Supports SSE (EventSource) and WebSocket streams
 * - Tools: navigate, click, waitFor, getLocation
 * - startAgui()/stopAgui() API
 * - Optional on-screen status panel for observability
 *
 * NOTE: This relies on DOM types. Your tsconfig should include the "dom" lib
 * (default in TS). Do NOT import Node modules here.
 */

type ToolCall = {
  type?: 'tool_call';
  name: keyof typeof TOOL_HANDLERS | string;
  args?: Record<string, unknown>;
  call_id: string;
};

type ToolResult = {
  call_id: string;
  result?: unknown;
  error?: string;
  ms: number;
};

type StartOptions = {
  showPanel?: boolean;
};

type TransportKind = 'sse' | 'ws';

const log = (...args: unknown[]) => console.log('[AGUI]', ...args);
const warn = (...args: unknown[]) => console.warn('[AGUI]', ...args);
const err = (...args: unknown[]) => console.error('[AGUI]', ...args);

// ---------------- Status panel (optional) ----------------
function createStatusPanel(): void {
  if (document.getElementById('agui-panel')) return;
  const div = document.createElement('div');
  div.id = 'agui-panel';
  div.style.cssText = [
    'position:fixed; right:12px; bottom:12px; z-index:2147483647;',
    'font:12px/1.3 system-ui, sans-serif; color:#111; background:#fff;',
    'border:1px solid #e5e7eb; border-radius:10px; box-shadow:0 6px 16px rgba(0,0,0,.12);',
    'padding:10px 12px; max-width:340px; min-width:220px;'
  ].join('');
  div.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <div style="width:8px;height:8px;border-radius:999px;background:#f59e0b;" id="agui-dot"></div>
      <strong>Agent Console</strong>
      <div style="margin-left:auto; opacity:.7; cursor:pointer;" id="agui-close" title="Close">×</div>
    </div>
    <div id="agui-status" style="white-space:pre-wrap; word-break:break-word;"></div>
  `;
  document.body.appendChild(div);
  const close = document.getElementById('agui-close');
  if (close) close.addEventListener('click', () => div.remove());
}

function setPanelOnline(online: boolean): void {
  const dot = document.getElementById('agui-dot') as HTMLDivElement | null;
  if (!dot) return;
  dot.style.background = online ? '#10b981' : '#f59e0b';
}

function setPanelStatus(text: string): void {
  const el = document.getElementById('agui-status') as HTMLDivElement | null;
  if (!el) return;
  el.textContent = text;
}

// ---------------- Tool implementations ----------------
async function tool_navigate({ path }: { path?: unknown }) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error('navigate.path must be a string starting with "/"');
  }
  const before = location.href;
  history.pushState({}, '', path);
  window.dispatchEvent(new Event('popstate'));
  return { href: location.href, title: document.title, from: before, to: path };
}

async function tool_click({ selector }: { selector?: unknown }) {
  if (typeof selector !== 'string') throw new Error('click.selector must be a string');
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return { clicked: false, selector, reason: 'not_found', href: location.href };
  const evt = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
  const ok = el.dispatchEvent(evt);
  return { clicked: !!ok, selector, tag: el.tagName, href: location.href };
}

async function tool_waitFor({ selector, timeout }: { selector?: unknown; timeout?: unknown }) {
  if (typeof selector !== 'string') throw new Error('waitFor.selector must be a string');
  const to = (typeof timeout === 'number' && isFinite(timeout) && timeout > 0) ? timeout : 8000;
  const has = () => !!document.querySelector(selector);
  if (has()) return { found: true, selector, t: 0 };
  const t0 = performance.now();
  return await new Promise<{ found: boolean; selector: string; t: number }>((resolve) => {
    const ob = new MutationObserver(() => {
      if (has()) { ob.disconnect(); resolve({ found: true, selector, t: Math.round(performance.now() - t0) }); }
    });
    ob.observe(document, { childList: true, subtree: true });
    window.setTimeout(() => { ob.disconnect(); resolve({ found: false, selector, t: Math.round(performance.now() - t0) }); }, to);
  });
}

async function tool_getLocation() {
  return { href: location.href, title: document.title };
}

const TOOL_HANDLERS = {
  navigate: tool_navigate,
  click: tool_click,
  waitFor: tool_waitFor,
  getLocation: tool_getLocation,
} as const;

// ---------------- Transport & state ----------------
let es: EventSource | null = null;
let ws: WebSocket | null = null;
let heartbeatTimer: number | null = null;
let streamUrlCurrent: string | null = null;
let postUrlCurrent: string | null = null;
let active = false;
let optionsCurrent: Required<StartOptions> = { showPanel: true };

function computeEndpoints(streamUrl: string): { kind: TransportKind; postUrl: string } {
  const u = new URL(streamUrl);
  if (u.protocol.startsWith('ws')) {
    c
