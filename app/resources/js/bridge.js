// SPDX-License-Identifier: MIT
// bridge.js — 同一套界面，两种后端：
//   浏览器里（node server.mjs）走 fetch('/api/...')；独立窗口里（Neutralino）直接调文件 API。
// app.js 只认 apiPost/apiGet，不关心跑在哪。
import { createContext, convertTeam, describeTurns, needsShuffle } from './convert.js';
import { fromUrl } from './link.js';

// 只有真正跑在 Neutralino 窗口里才算（浏览器里也会加载 neutralino.js，但没有 NL_TOKEN）
const NL = typeof window !== 'undefined' && !!window.Neutralino && !!(window.NL_TOKEN || window.NL_PORT);
if (NL) window.Neutralino.init();
// 程序所在文件夹（Neutralino 给的是正斜杠路径，直接可用）
let appDirCache = null;
async function APP_DIR() {
  if (appDirCache) return appDirCache;
  const base = String(window.NL_PATH || window.NL_CWD || '.').replace(/[\\/]+$/, '');
  appDirCache = base.replace(/\\/g, '/');
  return appDirCache;
}
// 两个数据目录来自界面设置（不同机器路径不同），没设就直接报错，不用猜
let pathsCache = null;
async function paths() {
  if (pathsCache) return pathsCache;
  const cfg = await settingsGet();
  const bb = String(cfg.bbRoot || '').trim();
  const ch = String(cfg.chaldeaHome || '').trim();
  const miss = [];
  if (!bb) miss.push('BBchannel 目录');
  if (!ch) miss.push('Chaldea 目录');
  if (miss.length) throw new Error('还没设置 ' + miss.join(' 和 ') + '：打开上方「脚本设置 → 路径」填一下');
  pathsCache = { bb, ch };
  return pathsCache;
}
async function ensureDir(p) {
  try { await FS().createDirectory(p); } catch {}
}

const safeName = (s) => String(s || 'team').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
const FS = () => window.Neutralino.filesystem;

async function readJson(p) {
  try { return JSON.parse(await FS().readFile(p)); } catch { return null; }
}

async function listDir(p) {
  try {
    const entries = await FS().readDirectory(p);
    const base = String(p).replace(/\/+$/, '');
    return entries.map((e) => ({ name: e.entry, dir: e.type === 'DIRECTORY', path: base + '/' + e.entry }));
  } catch { return []; }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'output', 'dist', 'build', '.tmp', '.temp']);

async function findDataFiles(dir, depth = 0, acc = []) {
  if (depth > 4) return acc;
  for (const e of await listDir(dir)) {
    if (e.dir) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      await findDataFiles(e.path, depth + 1, acc);
    } else if (/^userdata.*\.json$/i.test(e.name)) {
      acc.push(e.path);
    }
  }
  return acc;
}

// BB 的 master_info.json 和 servant_info 不一定在同一层，两处都找
async function fileExists(p) { try { await FS().getStats(p); return true; } catch { return false; } }
async function findIn(dir, name) {
  const base = String(dir || '').replace(/[\\/]+$/, '');
  for (const d of [base, base.replace(/[\\/][^\\/]+$/, '')]) {
    if (!d) continue;
    const p = d + '/' + name;
    if (await fileExists(p)) return p;
  }
  return null;
}
// 礼装的中日文名对照表在 mappingData.1/2/3 的某一份里，按内容找，不写死文件名
async function loadMcNames(gameDir) {
  for (const e of await listDir(gameDir)) {
    if (e.dir || !/^mappingData\..*\.json$/i.test(e.name)) continue;
    try {
      const text = await FS().readFile(e.path);
      if (text.indexOf('"mc_names"') < 0) continue;
      const m = JSON.parse(text);
      if (m && m.mc_names) return m.mc_names;
    } catch {}
  }
  return null;
}

let ctxCache = null;
async function getCtx() {
  if (ctxCache) return ctxCache;
  const p = await paths();
  const game = p.ch + '/userdata/game';
  const masterInfoPath = await findIn(p.bb, 'master_info.json');
  const data = {
    servantInfo: await readJson(p.bb + '/servant_info_CH.json'),
    masterInfo: masterInfoPath ? await readJson(masterInfoPath) : null,
    mcNames: await loadMcNames(game),
    baseFunctions: await readJson(game + '/baseFunctions.json'),
    baseSkills: await readJson(game + '/baseSkills.json'),
    baseTds: await readJson(game + '/baseTds.json'),
    mysticCodes: await readJson(game + '/mysticCodes.json'),
  };
  ctxCache = createContext(data);
  return ctxCache;
}

const questCache = new Map();
async function findQuest(questId) {
  if (!questId) return null;
  if (questCache.has(questId)) return questCache.get(questId);
  const needle = '"id":' + questId;
  const p = await paths();
  for (const e of await listDir(p.ch + '/userdata/temp/atlas_api')) {
    if (e.dir) continue;
    let text;
    try { text = await FS().readFile(e.path); } catch { continue; }
    if (!text.includes(needle)) continue;
    try {
      const q = JSON.parse(text);
      if (q && q.id === questId && Array.isArray(q.stages) && q.stages.length) {
        questCache.set(questId, q);
        return q;
      }
    } catch {}
  }
  questCache.set(questId, null);
  return null;
}
async function buildPlan(team) {
  const quest = await findQuest(team?.quest?.id);
  const waves = (await getCtx()).waveSlotsOf(quest);
  return { turns: describeTurns(team, waves?.length ?? 0), shuffle: needsShuffle(team) ? { needed: true } : null };
}

async function doConvert(team, body) {
  if (!body.decide) return { ok: true, needsConfirm: true, plan: await buildPlan(team) };
  const overrides = { ...(await settingsGet()), injectTurns: body.injectTurns || [], shuffleRetries: Math.max(0, Number(body.shuffleRetries) || 0) };
  overrides.__quest = await findQuest(team?.quest?.id);
  const { json, warnings, meta } = convertTeam(team, await getCtx(), overrides);
  return { json, warnings, meta };
}

async function settingsGet() {
  try { return JSON.parse(localStorage.getItem('c2b.settings') || '{}'); } catch { return {}; }
}

const handlers = {
  'GET /api/folders': async () => ({ ok: true, dirs: JSON.parse(localStorage.getItem('c2b.folders') || '[]') }),
  'POST /api/pick-folder': async () => {
    const r = await window.Neutralino.os.showFolderDialog('选择 Chaldea 数据目录');
    return { ok: !!r, dir: typeof r === 'string' ? r : '' };
  },
  'POST /api/scan': async (body) => {
    const dir = body.dir;
    if (!dir) return { ok: false, error: '路径不存在' };
    const dirs = JSON.parse(localStorage.getItem('c2b.folders') || '[]');
    if (!dirs.includes(dir)) { dirs.unshift(dir); localStorage.setItem('c2b.folders', JSON.stringify(dirs.slice(0, 8))); }
    const files = [];
    for (const file of await findDataFiles(dir)) {
      const ud = await readJson(file);
      const teams = ud?.users?.[0]?.battleSim?.teams;
      if (!Array.isArray(teams)) continue;
      files.push({
        file,
        mtime: '',
        teams: teams.map((t, i) => ({
          index: i,
          name: t.team?.name || '(未命名)',
          quest: t.quest,
          servants: (t.team?.onFieldSvts || []).map((s) => s.svtId),
          actions: (t.actions || []).length,
        })),
      });
    }
    return { ok: true, files, dir };
  },
  'POST /api/convert': async (body) => {
    const ud = await readJson(body.file);
    const team = ud?.users?.[0]?.battleSim?.teams?.[body.index];
    if (!team) return { ok: false, error: '这个文件里没有这条队伍' };
    const r = await doConvert(team, body);
    if (r.needsConfirm) return r;
    const name = safeName(team.team?.name || ('team' + body.index));
    await ensureDir((await APP_DIR()) + '/output');
    const outPath = (await APP_DIR()) + '/output/' + name + '.json';
    await FS().writeFile(outPath, JSON.stringify(r.json, null, 4));
    return { ok: true, outPath: 'output/' + name + '.json', absPath: outPath, warnings: r.warnings, meta: r.meta, json: r.json };
  },
  'POST /api/convert-raw': async (body) => {
    const rawFile = (await APP_DIR()) + '/raw/' + body.name;
    const team = await readJson(rawFile);
    if (!team) return { ok: false, error: 'raw 里没有这个文件' };
    const r = await doConvert(team, body);
    if (r.needsConfirm) return r;
    await ensureDir((await APP_DIR()) + '/output');
    const outPath = (await APP_DIR()) + '/output/' + body.name;
    await FS().writeFile(outPath, JSON.stringify(r.json, null, 4));
    return { ok: true, outPath: 'output/' + body.name, absPath: outPath, warnings: r.warnings, meta: r.meta, json: r.json };
  },
  'POST /api/link': async (body) => {
    const r = await fromUrl(String(body.url || '').trim());
    if (r.kind !== 'data') return { ok: false, error: '短链需要向 chaldea 的服务器取数据，这个工具不代理解析。请用 data= 开头的那条链接。' };
    const team = r.team;
    return {
      ok: true, source: 'data',
      defaultName: 'share-' + (team.quest?.id ?? 'unknown'),
      summary: { quest: team.quest, servants: (team.team?.onFieldSvts || []).map((x) => x.svtId), actions: (team.actions || []).length },
    };
  },
  'POST /api/link/save': async (body) => {
    const r = await fromUrl(String(body.url || '').trim());
    if (r.kind !== 'data') return { ok: false, error: '短链不支持' };
    await ensureDir((await APP_DIR()) + '/raw');
    const name = safeName(body.name || 'share') + '.json';
    const p = (await APP_DIR()) + '/raw/' + name;
    await FS().writeFile(p, JSON.stringify(r.team, null, 2));
    return { ok: true, rawPath: 'raw/' + name, name };
  },
  'GET /api/raw': async () => {
    const out = [];
    for (const e of await listDir((await APP_DIR()) + '/raw')) {
      if (e.dir || !e.name.endsWith('.json')) continue;
      let size = 0;
      try { size = (await FS().getStats(e.path)).size; } catch {}
      out.push({ name: e.name, size });
    }
    return { ok: true, files: out };
  },
  'GET /api/settings': async () => ({ ok: true, settings: await settingsGet() }),
  'POST /api/settings': async (body) => {
    const next = {};
    for (const [k, v] of Object.entries(body.settings || {})) if (v !== null && v !== '' && v !== undefined) next[k] = v;
    localStorage.setItem('c2b.settings', JSON.stringify(next));
    // 换目录后必须连数据一起重读：否则还拿旧目录的表在转，谁也不会有提示
    pathsCache = null;
    ctxCache = null;
    questCache.clear();
    return { ok: true, settings: next };
  },
  'POST /api/reveal': async (body) => {
    let target = body.target;
    if (target === 'output' || !target) {
      target = (await APP_DIR()) + '/output';
      await ensureDir(target);
    }
    const winPath = String(target).replace(/\//g, '\\');
    const cmdStr = /\.json$/i.test(winPath) ? 'explorer /select,"' + winPath + '"' : 'explorer "' + winPath + '"';
    try { await window.Neutralino.os.execCommand(cmdStr); return { ok: true }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }  },
};

async function call(method, url, body) {
  const h = handlers[method + ' ' + url];
  if (!h) return { ok: false, error: '未实现的接口: ' + url };
  try { return await h(body || {}); } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
}

window.apiPost = (url, body) => (NL ? call('POST', url, body) : post(url, body));
window.apiGet = (url) => (NL ? call('GET', url) : fetch(url).then((r) => r.json()));
window.apiMode = NL ? 'app' : 'browser';