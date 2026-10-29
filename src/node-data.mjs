// SPDX-License-Identifier: MIT
// node-data.mjs — 只有 Node 侧用的数据加载（浏览器/窗口里换成 Neutralino 的读法）
import fs from 'node:fs';
import path from 'node:path';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// BB 的 master_info.json 和 servant_info 不一定在同一层（有的把它放在 BBchannel 子目录里），两处都找
function findIn(dir, name) {
  const base = path.resolve(String(dir || '.'));
  for (const d of [base, path.dirname(base)]) {
    const p = path.join(d, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 礼装的中日文名对照表在 mappingData.1/2/3 的某一份里，按内容找，不写死文件名
function loadMcNames(gameDir) {
  let files = [];
  try { files = fs.readdirSync(gameDir).filter((f) => /^mappingData\..*\.json$/i.test(f)); } catch { return null; }
  for (const f of files) {
    const p = path.join(gameDir, f);
    try {
      const text = fs.readFileSync(p, 'utf8');
      if (!text.includes('"mc_names"')) continue;
      const m = JSON.parse(text);
      if (m && m.mc_names) return m.mc_names;
    } catch {}
  }
  return null;
}

export function loadContextData({ bbRoot, chaldeaHome }) {
  const game = chaldeaHome + '/userdata/game';
  // 少了哪个文件由 createContext 统一报错（那里的提示是给人看的）
  const tryRead = (p) => { try { return readJson(p); } catch { return null; } };
  const masterInfoPath = findIn(bbRoot, 'master_info.json');
  return {
    servantInfo: tryRead(bbRoot + '/servant_info_CH.json'),
    masterInfo: masterInfoPath ? tryRead(masterInfoPath) : null,
    mcNames: loadMcNames(game),
    baseFunctions: tryRead(game + '/baseFunctions.json'),
    baseSkills: tryRead(game + '/baseSkills.json'),
    baseTds: tryRead(game + '/baseTds.json'),
    mysticCodes: tryRead(game + '/mysticCodes.json'),
  };
}

// 在 atlas 缓存里找这条关卡（文件名是哈希，只能挨个看 id）
export function findQuest(chaldeaHome, questId) {
  if (!questId) return null;
  const dir = chaldeaHome + '/userdata/temp/atlas_api';
  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }
  const needle = '"id":' + questId;
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(dir + '/' + f, 'utf8'); } catch { continue; }
    if (!text.includes(needle)) continue;
    try {
      const q = JSON.parse(text);
      if (q && q.id === questId && Array.isArray(q.stages) && q.stages.length) return q;
    } catch {}
  }
  return null;
}
