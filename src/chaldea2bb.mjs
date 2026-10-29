#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// chaldea2bb.mjs — 命令行入口
import fs from 'node:fs';
import { createContext, convertTeam } from '../app/resources/js/convert.js';
import { loadContextData, findQuest } from './node-data.mjs';
import { fromUrl } from '../app/resources/js/link.js';

const BB_ROOT = process.env.BB_ROOT || '';
const CHALDEA_HOME = process.env.CHALDEA_HOME || '';
if (!BB_ROOT || !CHALDEA_HOME) {
  console.error('需要设置环境变量 BB_ROOT（BBchannel 目录）和 CHALDEA_HOME（Chaldea 目录）');
  process.exit(1);
}

const argv = process.argv.slice(2);
const ctx = createContext(loadContextData({ bbRoot: BB_ROOT, chaldeaHome: CHALDEA_HOME }));
const withQuest = (team) => ({ __quest: findQuest(CHALDEA_HOME, team?.quest?.id) });

// 用法二：--link "<分享链接>"
if (argv[0] === '--link') {
  const url = argv[1];
  if (!url) throw new Error('缺少链接');
  const r = await fromUrl(url);
  if (r.kind !== 'data') throw new Error('短链不支持：请在 Chaldea 里用 data= 开头的那条链接');
  const team = r.team;
  const { json, warnings } = convertTeam(team, ctx, withQuest(team));
  for (const w of warnings) console.error('WARN: ' + w);
  const text = JSON.stringify(json, null, 4);
  if (argv[2]) fs.writeFileSync(argv[2], text, 'utf8');
  console.log(text);
  process.exit(0);
}

const [userdataPath = CHALDEA_HOME + '/userdata/user/userdata.json', teamKey = '', outPath = ''] = argv;

const ud = JSON.parse(fs.readFileSync(userdataPath, 'utf8'));
const teams = ud.users?.[0]?.battleSim?.teams || [];
if (!teams.length) throw new Error('这个文件里没有保存的队伍');
const team = teamKey === '' ? teams[teams.length - 1]
  : (/^\d+$/.test(teamKey) ? teams[Number(teamKey)] : teams.find(t => t.team?.name === teamKey));
if (!team) throw new Error('找不到队伍: ' + teamKey);

const { json, warnings } = convertTeam(team, ctx);

for (const w of warnings) console.error('WARN: ' + w);

const text = JSON.stringify(json, null, 4);
if (outPath) fs.writeFileSync(outPath, text, 'utf8');
console.log(text);
console.error('team=' + (team.team?.name || '(未命名)') + ' turns=' + JSON.stringify([1,2,3].map(r => json['round' + r + '_turn0_skill']?.length ?? null)));