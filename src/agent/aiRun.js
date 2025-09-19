// src/agent/aiRun.js
function js_waitForSelector(selector, timeoutMs = 8000, intervalMs = 150) {
  return `
    (function(){
      const sel=${JSON.stringify(selector)};
      const tEnd=Date.now()+${Number(timeoutMs)};
      function visible(el){ const r=el.getBoundingClientRect(); const st=getComputedStyle(el); return (r.width||r.height) && st.visibility!=='hidden' && st.display!=='none'; }
      return new Promise((resolve,reject)=>{
        (function poll(){
          const el=document.querySelector(sel);
          if (el && visible(el)) return resolve(true);
          if (Date.now()>tEnd) return reject(new Error('Timeout waiting for '+sel));
          setTimeout(poll, ${Number(intervalMs)});
        })();
      });
    })()
  `;
}

function js_clickByText(text, tagHint) {
  return `
    (function(){
      const needle=${JSON.stringify(text)}.toLowerCase().trim();
      const hint=${tagHint?JSON.stringify(tagHint.toLowerCase()):'null'};
      function visible(el){ const r=el.getBoundingClientRect(); const st=getComputedStyle(el); return (r.width||r.height) && st.visibility!=='hidden' && st.display!=='none'; }
      const nodes = document.querySelectorAll(hint? hint : '*');
      for (const el of nodes) {
        if (!visible(el)) continue;
        const t=(el.innerText||'').toLowerCase().trim();
        if (!t) continue;
        if (t===needle || t.includes(needle)) { el.click(); return {ok:true}; }
      }
      return {ok:false, error:'No visible element containing text'};
    })()
  `;
}

async function runSteps(win, steps = []) {
  for (const step of steps) {
    const { tool, args = {} } = step || {};
    if (!tool) continue;

    if (tool === "nav.goto") {
      const href = new URL(args.url, "https://hub.aishacrm.app/").href;
      await win.loadURL(href);
      continue;
    }

    if (tool === "dom.waitForSelector") {
      await win.webContents.executeJavaScript(
        js_waitForSelector(args.selector, args.timeoutMs)
      );
      continue;
    }

    if (tool === "dom.click") {
      await win.webContents.executeJavaScript(\`
        (function(){
          const el = document.querySelector(\${JSON.stringify(args.selector)});
          if (el) el.click();
        })()
      \`);
      continue;
    }

    if (tool === "dom.clickByText") {
      await win.webContents.executeJavaScript(
        js_clickByText(args.text, args.tagHint)
      );
      continue;
    }

    if (tool === "dom.type") {
      await win.webContents.executeJavaScript(\`
        (function(){
          const el = document.querySelector(\${JSON.stringify(args.selector)});
          if (!el) return;
          el.focus();
          el.value=\${JSON.stringify(args.text || "")};
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
        })()
      \`);
      continue;
    }
  }
}

module.exports = { runSteps, js_waitForSelector, js_clickByText };
