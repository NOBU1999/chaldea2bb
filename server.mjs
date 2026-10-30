#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// server.mjs — 本地页面：选文件夹 -> 扫描队伍 -> 预览 -> 转换
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createContext, convertTeam, needsShuffle, describeTurns } from './app/resources/js/convert.js';
import { loadContextData, findQuest } from './src/node-data.mjs';
import { fromUrl } from './app/resources/js/link.js';
import crypto from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(ROOT, 'app', 'resources');
const OUT = path.join(ROOT, 'output');
const RAW = path.join(ROOT, 'raw');
// 输出目录：设置里选过就用它，否则用项目下的 output
const outDirPath = () => loadSettings().outputDir || OUT;
// 路径优先取界面设置，其次环境变量；都没有就跑不了（会在下面给出提示）
const BB_ROOT = process.env.BB_ROOT || '';
const pathCfg = () => {
  const s = loadSettings();
  return {
    bb: s.bbRoot || BB_ROOT,
    ch: s.chaldeaHome || process.env.CHALDEA_HOME || '',
  };
};


fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

const SETTINGS = path.join(ROOT, 'settings.json');

const loadSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } };
const saveSettings = (s) => fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2), 'utf8');
const FOLDERS = path.join(ROOT, 'folders.json');
const loadFolders = () => { try { return JSON.parse(fs.readFileSync(FOLDERS, 'utf8')); } catch { return []; } };
function addFolder(dir) {
  const list = loadFolders().filter(x => x !== dir);
  list.unshift(dir);
  fs.writeFileSync(FOLDERS, JSON.stringify(list.slice(0, 10), null, 2), 'utf8');
}

let ctxCache = null;
const missingPaths = (p) => {
  const miss = [];
  if (!p.bb) miss.push('BBchannel 目录');
  if (!p.ch) miss.push('Chaldea 目录');
  return miss;
};
const getCtx = () => {
  const p = pathCfg();
  const miss = missingPaths(p);
  if (miss.length) throw new Error('还没设置 ' + miss.join(' 和 ') + '：请在「脚本设置 → 路径」里填写，或设置环境变量 BB_ROOT / CHALDEA_HOME');
  return (ctxCache ??= createContext(loadContextData({ bbRoot: p.bb, chaldeaHome: p.ch })));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 5e6) { reject(new Error('请求体过大')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('请求不是合法 JSON')); } });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

// 系统文件夹选择框
function pickFolder() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$f.Description = '选择 Chaldea 数据文件夹'",
    "$f.ShowNewFolderButton = $false",
    "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }",
  ].join('; ');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 600000 }, (err, stdout) => {
      const p = (stdout || '').trim();
      if (err || !p) return resolve(null);
      resolve(p);
    });
  });
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'output', 'dist', 'build', '.temp']);

function findDataFiles(dir, depth = 0, acc = []) {
  if (depth > 4) return acc;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      findDataFiles(p, depth + 1, acc);
    } else if (/^userdata.*\.json$/i.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

function scanDir(dir) {
  const files = [];
  for (const file of findDataFiles(dir)) {
    let ud;
    try { ud = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const teams = ud?.users?.[0]?.battleSim?.teams;
    if (!Array.isArray(teams)) continue;
    files.push({
      file,
      mtime: fs.statSync(file).mtime.toISOString(),
      teams: teams.map((t, i) => ({
        index: i,
        name: t.team?.name || '(未命名)',
        quest: t.quest,
        servants: (t.team?.onFieldSvts || []).map(s => s.svtId),
        actions: (t.actions || []).length,
      })),
    });
  }
  return files;
}

const safeName = (s) => String(s || 'team').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(WEB, 'index.html')));
    return;
  }
  if (req.method === 'GET' && /^\/(app\.js|js\/[\w.-]+\.m?js|img\/[\w.-]+\.(png|jpg|svg))$/.test(p)) {
    const f = path.join(WEB, p.slice(1));
    if (!fs.existsSync(f)) return sendJson(res, 404, { ok: false, error: 'not found' });
    const type = p.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : p.endsWith('.svg') ? 'image/svg+xml'
      : p.endsWith('.png') ? 'image/png' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(f));
    return;
  }
  if (req.method === 'POST' && p === '/api/pick-folder') {
    const dir = await pickFolder();
    return sendJson(res, 200, { ok: !!dir, dir });
  }

  if (req.method === 'POST' && p === '/api/scan') {
    const { dir } = await readBody(req);
    if (!dir || !fs.existsSync(dir)) return sendJson(res, 400, { ok: false, error: '路径不存在' });
    addFolder(dir);
    const files = scanDir(dir);
    if (!files.length) return sendJson(res, 200, { ok: true, files: [], dir, note: '这个文件夹里没找到 userdata.json' });
    return sendJson(res, 200, { ok: true, files, dir });
  }


  // 转换前先把「每回合出什么牌」摊出来让用户勾：勾中的回合才注入出卡策略。不做记忆，每次转换都问。
  function buildPlan(team) {
    const waves = getCtx().waveSlotsOf(findQuest(pathCfg().ch || null, team?.quest?.id));
    return {
      turns: describeTurns(team, waves?.length ?? 0),
      shuffle: needsShuffle(team) ? { needed: true } : null,
    };
  }
  if (req.method === 'POST' && p === '/api/convert') {
    const body = await readBody(req);
    const { file, index } = body;
    let ud;
    try { ud = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return sendJson(res, 400, { ok: false, error: '读不了这个文件' }); }
    const team = ud?.users?.[0]?.battleSim?.teams?.[index];
    if (!team) return sendJson(res, 400, { ok: false, error: '这个文件里没有这条队伍' });
    if (!body.decide) return sendJson(res, 200, { ok: true, needsConfirm: true, plan: buildPlan(team) });
    const overrides = loadSettings();
    overrides.injectTurns = Array.isArray(body.injectTurns) ? body.injectTurns : [];
    overrides.shuffleRetries = Math.max(0, Number(body.shuffleRetries) || 0);
    overrides.fineStrategy = body.fineStrategy || null;
    overrides.__quest = findQuest(pathCfg().ch, team?.quest?.id);
    const { json, warnings, meta } = convertTeam(team, getCtx(), overrides);
    const name = safeName(team.team?.name || ('team' + index));
    const dir = outDirPath();
    fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, name + '.json');
    fs.writeFileSync(outPath, JSON.stringify(json, null, 4), 'utf8');
    return sendJson(res, 200, { ok: true, outPath: path.relative(ROOT, outPath), absPath: outPath, warnings, meta, json });
  }

  if (req.method === 'POST' && p === '/api/link') {
    const { url } = await readBody(req);
    if (!url) return sendJson(res, 400, { ok: false, error: '没有给链接' });
    let team, source;
    try {
      const r = await fromUrl(url.trim());
      if (r.kind === 'data') { team = r.team; source = 'data'; }
      else {
        // 短链要去 chaldea 自己的服务器取，那是它有意设的门槛（按客户端版本设限）。
        // 我们不代理解析，也不绕过；只提示改用自带数据的那条链接。
        return sendJson(res, 400, {
          ok: false,
          error: '短链需要向 chaldea 的服务器取数据，这个工具不代理解析。请在 Chaldea 里用另一条分享链接（data= 开头，自带完整队伍数据，离线可用）。',
        });
      }
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: String(e.message || e) });
    }
    const defaultName = 'share-' + (team.quest?.id ?? 'unknown') + '-' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 6);
    return sendJson(res, 200, {
      ok: true, source, defaultName,
      summary: { quest: team.quest, servants: (team.team?.onFieldSvts || []).map(x => x.svtId), actions: (team.actions || []).length },
    });
  }

  // 输出目录候选：默认项目下的 output；BBchannel 装好了就把它读脚本的 settings 也列出来
  if (req.method === 'GET' && p === '/api/outdirs') {
    const s = loadSettings();
    const bb = String(s.bbRoot || BB_ROOT || '').replace(/[\\/]+$/, '');
    const cands = [];
    for (const d of [bb + '/settings', path.dirname(bb) + '/settings']) {
      if (!bb || !d) continue;
      try { if (fs.statSync(d).isDirectory()) { cands.push({ label: 'BBchannel 的 settings（BB 直接读这里）', path: d }); break; } } catch {}
    }
    return sendJson(res, 200, {
      ok: true, defaultDir: OUT, current: s.outputDir || '', candidates: cands,
      customs: Array.isArray(s.outputDirs) ? s.outputDirs : [],
    });
  }

  if (req.method === 'POST' && p === '/api/outdir/remove') {
    const { path: drop } = await readBody(req);
    const s = loadSettings();
    const customs = (Array.isArray(s.outputDirs) ? s.outputDirs : []).filter((x) => x !== drop);
    s.outputDirs = customs;
    if (s.outputDir === drop) s.outputDir = '';
    saveSettings(s);
    return sendJson(res, 200, { ok: true, settings: s });
  }

  if (p === '/api/settings') {
    if (req.method === 'GET') return sendJson(res, 200, { ok: true, settings: loadSettings() });
    const body = await readBody(req);
    // 合并而不是覆盖：界面每次改动只送变化的那几项
    const next = { ...loadSettings() };
    const patch = body.settings || {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) continue;
      if (v === '' && k !== 'outputDir') continue;
      next[k] = v;
    }
    saveSettings(next);
    if ('chaldeaHome' in patch || 'bbRoot' in patch) {
      ctxCache = null; // 只有换目录才重读数据表
    }
    return sendJson(res, 200, { ok: true, settings: next });
  }

  if (req.method === 'GET' && p === '/api/folders') {
    return sendJson(res, 200, { ok: true, dirs: loadFolders() });
  }

  if (req.method === 'GET' && p === '/api/raw') {
    let files = [];
    try {
      files = fs.readdirSync(RAW).filter(f => f.endsWith('.json')).map(f => {
        const st = fs.statSync(path.join(RAW, f));
        return { name: f, size: st.size, mtime: st.mtime.toISOString(), path: path.join('raw', f) };
      }).sort((a, b) => b.mtime.localeCompare(a.mtime));
    } catch {}
    return sendJson(res, 200, { ok: true, files });
  }

  if (req.method === 'POST' && p === '/api/link/save') {
    const { url, name } = await readBody(req);
    if (!url) return sendJson(res, 400, { ok: false, error: '没有给链接' });
    let team;
    try {
      const r = await fromUrl(url.trim());
      team = r.kind === 'data' ? r.team : await fetchById(r.id);
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: String(e.message || e) });
    }
    const fallback = 'share-' + (team.quest?.id ?? 'unknown') + '-' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 6);
    const finalName = safeName((name || '').trim() || fallback);
    const rawPath = path.join(RAW, finalName + '.json');
    fs.writeFileSync(rawPath, JSON.stringify(team, null, 4), 'utf8');
    return sendJson(res, 200, {
      ok: true, rawPath: path.relative(ROOT, rawPath),
      summary: { quest: team.quest, servants: (team.team?.onFieldSvts || []).map(x => x.svtId), actions: (team.actions || []).length },
    });
  }

  if (req.method === 'POST' && p === '/api/convert-raw') {
    const body = await readBody(req);
    const { name } = body;
    if (!name || !/^[^\\/]+\.json$/.test(name)) return sendJson(res, 400, { ok: false, error: '文件名不合法' });
    const rawFile = path.join(RAW, name);
    if (!fs.existsSync(rawFile)) return sendJson(res, 400, { ok: false, error: 'raw 里没有这个文件' });
    let team;
    try { team = JSON.parse(fs.readFileSync(rawFile, 'utf8')); } catch { return sendJson(res, 400, { ok: false, error: '这个 raw 文件不是队伍 JSON' }); }
    if (!body.decide) return sendJson(res, 200, { ok: true, needsConfirm: true, plan: buildPlan(team) });
    const overrides = loadSettings();
    overrides.injectTurns = Array.isArray(body.injectTurns) ? body.injectTurns : [];
    overrides.shuffleRetries = Math.max(0, Number(body.shuffleRetries) || 0);
    overrides.fineStrategy = body.fineStrategy || null;
    overrides.__quest = findQuest(pathCfg().ch, team?.quest?.id);
    const { json, warnings, meta } = convertTeam(team, getCtx(), overrides);
    const dir = outDirPath();
    fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, name);
    fs.writeFileSync(outPath, JSON.stringify(json, null, 4), 'utf8');
    return sendJson(res, 200, {
      ok: true, outPath: path.relative(ROOT, outPath), absPath: outPath, warnings, meta, json,
      summary: { quest: team.quest, servants: (team.team?.onFieldSvts || []).map(x => x.svtId), actions: (team.actions || []).length },
    });
  }

  if (req.method === 'POST' && p === '/api/reveal') {
    const { target } = await readBody(req);
    let abs = target ? (path.isAbsolute(target) ? target : path.join(ROOT, target)) : '';
    if (target === 'output') { abs = outDirPath(); try { fs.mkdirSync(abs, { recursive: true }); } catch {} }
    if (abs && fs.existsSync(abs)) spawn('explorer.exe', ['/select,', abs], { detached: true }).unref();
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
}

function start(port) {
  const srv = http.createServer((req, res) => {
    handle(req, res).catch(err => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: String(err.message || err) });
    });
  });
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && port !== 0) start(0);
    else { console.error(e); process.exit(1); }
  });
  srv.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + srv.address().port + '/';
    console.log('chaldea2bb 已启动: ' + url);
    console.log('关闭这个窗口即可停止。');
    if (!process.env.NO_OPEN) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  });
}

start(Number(process.env.PORT) || 5180);