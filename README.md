
# Ai-SHA Hub Browser — Windows (hub-only, auto-update, portable + installer)

## Build locally
```powershell
npm install
npm run dist
```
Artifacts in `dist\`:
- Portable EXE and NSIS installer EXE.

## Auto-updates via GitHub
1. Create a repo and push this project.
2. Edit `package.json` → `build.publish` owner/repo.
3. Create a tag like `v1.4.0` and push it.
4. The included GitHub Actions workflow builds and publishes a Release with assets.
5. App checks for updates at startup and via **Help → Check for Updates**.

## Code signing
Set these repo secrets if you have a code-signing cert:
- `CSC_LINK` (e.g., `file://D:/certs/yourcert.pfx` or a base64 data URL)
- `CSC_KEY_PASSWORD`
Workflow will sign automatically during build.

## LLM agent bridge
- `preload.js` exposes `window.agent` with `click/type/readText/goto`.
- `npm run agent` starts a tiny local HTTP bridge at `http://127.0.0.1:4477/act`.
  Example:
  ```powershell
  curl -X POST http://127.0.0.1:4477/act -H "Content-Type: application/json" -d "{\"action\":\"click\",\"selector\":\"button[type=submit]\"}"
  ```

## Allow/deny telemetry
We do **not** include `r.wdfl.co` — it stays blocked by default.
If you ever need it, add `r.wdfl.co` to `config/allowlist.json`.
