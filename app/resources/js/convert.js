// SPDX-License-Identifier: MIT
// convert.js — 转换核心：Chaldea 队伍对象 -> BBchannel 脚本对象
// 这里不碰任何文件系统：数据由调用方读好传进来（Node 用 fs，窗口里用 Neutralino 的文件 API）。

const SELECT_TARGET_CMD = 13;
// 需要玩家在界面上点一个队友的 funcTargetType（ptOneOther = 「自己以外的一个队友」）
const ALLY_TARGET_TYPES = new Set(['ptOne', 'ptOneOther']);
// 指令卡代号：位次(1-3) + 卡色字母；BB 与 Chaldea 的 cardType 1/2/3 = A/B/Q
const CARD_LETTER = { 1: 'A', 2: 'B', 3: 'Q' };
const cardCode = (atk) => String(atk.svt + 1) + (CARD_LETTER[atk.cardType] ?? 'B');

// 本工具验证过的 Chaldea 存档构建号上限（队伍里的 appBuild）。更高的版本只标「未验证」，不算失败。
export const MAX_VERIFIED_BUILD = 992;

// ---- 读表时的校验 ----
// 表结构不对就直接报错：宁可转换失败，也不要产出一份看起来正常的错脚本。
const fail = (msg) => { throw new Error(msg); };
// BB 的表里偶有把 0 写成 false 的（如源赖光），按 0 收下；其它怪值一律当成没有这张表
const normSkillType = (t) => {
  if (!Array.isArray(t) || t.length !== 3) return null;
  const out = t.map((v) => (v === false ? 0 : v));
  return out.every((v) => v === 0 || v === 1 || v === 2 || v === 3) ? out : null;
};

// ---- 御主礼装编号 ----
// 不写死：Chaldea 的日文名 → Chaldea 的中文名（mappingData 的 mc_names）→ BB master_info 的 SN。
// 少数几件两边译名不同，用别名兜底（键是 Chaldea 的日文名，值是 BB 里的中文名）。
const MC_ALIASES = {
  'ハロウィン・ロイヤリティ': '万圣夜王室装',     // Chaldea 写作「万圣节王室成员」
  'ノーマル・カルデア制服': '标准·迦勒底制服',     // Chaldea 写作「普通迦勒底制服」
  'カルデア・パスファインダー': '迦勒底开拓者',   // Chaldea 写作「迦勒底探险者」
};
// 比对用的归一化：去掉标点与间隔号，抹平几处反复出现的译名差异（高中/高校、学生服/校服、尾字「节」）
const mcKey = (s) => String(s || '')
  .replace(/[·・･\s\-—－()（）]/g, '')
  .replace(/高中/g, '高校')
  .replace(/学生服/g, '校服')
  .replace(/节$/, '');

// 返回 { sn: Chaldea 礼装 id -> BB SN, note: 没查到的礼装（留着给提示用） }
export function buildMcSN(mysticCodes, masterInfo, mcNames) {
  const byName = new Map();
  for (const [name, v] of Object.entries(masterInfo || {})) {
    const sn = Number(v && v.SN);
    if (Number.isInteger(sn)) byName.set(mcKey(name), sn);
  }
  const sn = {};
  const note = {};
  for (const m of mysticCodes || []) {
    if (!m || m.id == null) continue;
    const jp = String(m.name || '');
    const cn = (mcNames && mcNames[jp] && mcNames[jp].CN) || '';
    const hit = byName.get(mcKey(MC_ALIASES[jp] || cn)) ?? byName.get(mcKey(cn));
    if (hit === undefined) note[m.id] = { jp, cn };
    else sn[m.id] = hit;
  }
  return { sn, note };
}

// servantInfo/baseFunctions/baseSkills/baseTds/mysticCodes 是 Chaldea/BB 的表，masterInfo/mcNames 用来算礼装编号
export function createContext(data) {
  const { servantInfo, baseFunctions, baseSkills, baseTds, mysticCodes, masterInfo, mcNames } = data || {};
  const dataWarnings = [];

  if (!Array.isArray(baseFunctions) || !baseFunctions.length) {
    fail('没读到 Chaldea 的 baseFunctions.json（技能/宝具效果表）：确认「Chaldea 目录」选中的是 Chaldea 的数据目录');
  }
  for (const [v, name] of [[baseSkills, 'baseSkills.json（技能表）'], [baseTds, 'baseTds.json（宝具表）'], [mysticCodes, 'mysticCodes.json（御主礼装表）']]) {
    if (!Array.isArray(v) || !v.length) fail('没读到 Chaldea 的 ' + name + '：确认「Chaldea 目录」选中的是 Chaldea 的数据目录');
  }
  if (!servantInfo || typeof servantInfo !== 'object' || Array.isArray(servantInfo) || !Object.keys(servantInfo).length) {
    fail('没读到 BB 的 servant_info（从者名字与技能表）：确认「BBchannel 目录」里有 servant_info_CH.json');
  }

  const nameBySvt = new Map();
  const bbSkillType = new Map(); // SN -> [skill_type x3]，BB 的 UI 表（0 不选人 / 1、3 要选人 / 2 换人）
  let noSn = 0;
  let badType = 0;
  for (const [name, info] of Object.entries(servantInfo)) {
    const raw = info && info.SN;
    if (raw == null || !/^\d+$/.test(String(raw))) { noSn++; continue; }
    const sn = String(raw);
    nameBySvt.set(sn, name);
    const st = normSkillType(info.skill_type);
    if (st) bbSkillType.set(sn, st);
    else badType++;
  }
  if (!nameBySvt.size) fail('servant_info 里没有一条能用的从者记录（缺 SN 字段）：这份表的格式和本工具预期的不一致');
  if (noSn) dataWarnings.push('BB 的 servant_info 里有 ' + noSn + ' 条记录缺 SN，已跳过；用到这些从者会提示「名字表里找不到」');
  if (badType) dataWarnings.push('BB 的 servant_info 里有 ' + badType + ' 条记录的 skill_type 不是 0–3 的三位数，atlas 缺数据时无法退回 BB 的判定');

  const funcs = baseFunctions;
  const funcTarget = new Map(funcs.map(f => [f.funcId, f.funcTargetType]));
  const funcType = new Map(funcs.map(f => [f.funcId, f.funcType]));
  const skills = baseSkills;
  const skillById = new Map(skills.map(s => [s.id, s]));
  const tds = baseTds;
  const tdById = new Map(tds.map(t => [t.id, t]));
  const mcs = mysticCodes;
  const mcById = new Map(mcs.map(m => [m.id, m]));

  const { sn: mcSN, note: mcSNote } = buildMcSN(mcs, masterInfo, mcNames);
  if (!masterInfo) dataWarnings.push('没找到 BB 的 master_info.json（在 BBchannel 目录或其上一级），御主礼装编号无法自动对上');
  if (!mcNames) dataWarnings.push('没在 Chaldea 的 mappingData 里找到 mc_names（礼装中日文名对照），御主礼装只能靠别名表匹配');
  else if (!Object.keys(mcSN).length) dataWarnings.push('御主礼装一件也没能对上 BB 的编号：master_info 可能是别的版本/语言');

  const funcTypes = (fns) => [...new Set((fns || []).map(f => funcTarget.get(f.funcId)).filter(Boolean))];

  // 从已经解析好的关卡对象里取每波的敌方站位（调用方负责找到这个关卡）
  function waveSlotsOf(quest) {
    if (!quest || !Array.isArray(quest.stages) || !quest.stages.length) return null;
    return quest.stages.map(s => (s.enemies || []).map(e => e.deckId ?? e.userSvtId));
  }

  const funcTypeOf = (funcId) => funcType.get(funcId);
  return { nameBySvt, bbSkillType, skillById, tdById, mcById, mcSN, mcSNote, dataWarnings, funcTypes, funcTypeOf, waveSlotsOf };
}

const HAKUNO_IDS = [2300700, 2300800];

// 这条队伍会不会用到「洗牌要刷到想要的卡」这套逻辑（岸波白野的第 1 个技能）
export function needsShuffle(team) {
  const onField = team?.team?.onFieldSvts || [];
  return (team?.actions || []).some((a) => {
    if (a.type !== 'skill' || a.svt === undefined || a.svt === null) return false;
    const svt = onField[a.svt];
    return !!svt && HAKUNO_IDS.includes(Number(svt.svtId)) && a.skill === 0;
  });
}

// 回合 -> 面的分配。
// 默认 flat：不区分波次与回合，第几回合就是第几面（一面一回合），界面与键名都按这个来。
// 保留 mode='wave' 的接口：以后要支持「一面多回合」时，切换过去即可（按关卡面数分配，写超的回合归最后一面）。
export function assignRounds(turnCount, waveCount, mode = 'flat') {
  if (!turnCount) return [];
  if (mode !== 'wave') return Array.from({ length: turnCount }, (_, i) => [i]);
  if (waveCount <= 1) return [Array.from({ length: turnCount }, (_, i) => i)];
  if (turnCount <= waveCount) return Array.from({ length: turnCount }, (_, i) => [i]);
  const head = [];
  for (let i = 0; i < waveCount - 1; i++) head.push([i]);
  head.push(Array.from({ length: turnCount - (waveCount - 1) }, (_, i) => waveCount - 1 + i));
  return head;
}

// ---- 精细出卡策略（界面「精细策略」面板）----
// 用户给的是「想要的牌序」和「不要的牌序」，这里翻译成 BB 的策略数组：
//   想要 → 一条策略；
//   不要 → BB 没有排除语法，只能按「某一格不是那样」拆成最多三条补集。
const CARD_UNIVERSE = ['1B', '2B', '3B', '1A', '2A', '3A', '1Q', '2Q', '3Q'];
const deffSlot = () => ({ type: 2, cards: [], criticalStar: 0, more_or_less: true });
const cardSlot = (cards) => ({ type: 1, cards, criticalStar: 0, more_or_less: true });
const npSlot = (n) => ({ type: 0, cards: [n], criticalStar: 0, more_or_less: true });
const normSlot = (s) => {
  const type = Number(s?.type);
  if (type === 0) { const n = Number(s?.cards?.[0]); return n >= 1 && n <= 3 ? npSlot(n) : deffSlot(); }
  if (type === 1) { const cards = (s?.cards || []).filter((c) => CARD_UNIVERSE.includes(c)); return cards.length ? cardSlot(cards) : deffSlot(); }
  return deffSlot();
};
const isDef = (slot) => slot.type === 2;

// ---- 校验：哪些配置根本生成不出来 ----
// 集合表示：null = 全都要（缺省），否则是字符串集合；宝具写成 'NP1'…'NP3'
const ALL_NP = ['NP1', 'NP2', 'NP3'];
const slotSet = (slot) => {
  if (!slot || slot.type === 2) return null;
  if (slot.type === 0) return new Set(['NP' + slot.cards[0]]);
  return new Set(slot.cards);
};
const interNonEmpty = (a, b) => {
  if (a === null || b === null) return true;
  for (const x of a) if (b.has(x)) return true;
  return false;
};
const isSubset = (a, b) => {
  if (a === null) return b === null;
  if (b === null) return true;
  for (const x of a) if (!b.has(x)) return false;
  return true;
};
const sameSet = (a, b) => (a === null && b === null) || (a !== null && b !== null && a.size === b.size && isSubset(a, b));
const rowSets = (row) => [slotSet(row?.[0]), slotSet(row?.[1]), slotSet(row?.[2])];
const rowFilled = (row) => (row || []).some((s) => s && s.type !== 2 && (s.type === 0 || (s.cards || []).length));

// 返回 { errors: 不能生成, warns: 能生成但要提醒 }
export function checkFineConfig(cfg) {
  const errors = [];
  const warns = [];
  const allow = (cfg?.allow || []).filter(rowFilled);
  const deny = (cfg?.deny || []).filter(rowFilled);

  (cfg?.allow || []).forEach((row, i) => {
    if (rowFilled(row)) return;
    errors.push('理想第 ' + (i + 1) + ' 条三格都是「缺省」：等于没有任何约束，会把后面的条目全部挡住');
  });
  (cfg?.deny || []).forEach((row, i) => {
    if (rowFilled(row)) return;
    errors.push('禁忌第 ' + (i + 1) + ' 条三格都是「缺省」：没有排除任何东西');
  });

  deny.forEach((row, i) => {
    (row || []).forEach((slot, k) => {
      if (slot && slot.type === 1 && (slot.cards || []).length >= CARD_UNIVERSE.length) {
        errors.push('禁忌第 ' + (i + 1) + ' 条的格' + (k + 1) + ' 排除了全部指令卡：补集是空的，生成不出来');
      }
    });
    const filled = (row || []).filter((s) => s && s.type !== 2 && (s.type === 0 || (s.cards || []).length)).length;
    if (filled >= 2) warns.push('禁忌第 ' + (i + 1) + ' 条同时约束了 ' + filled + ' 格：这种写法只有第一条会生效，建议改成逐格写');
  });

  allow.forEach((aRow, ai) => {
    const as = rowSets(aRow);
    deny.forEach((dRow, di) => {
      const ds = rowSets(dRow);
      const allHit = [0, 1, 2].every((k) => interNonEmpty(as[k], ds[k]));
      if (!allHit) return;
      const covered = [0, 1, 2].every((k) => isSubset(as[k], ds[k]));
      if (covered) errors.push('理想第 ' + (ai + 1) + ' 条落在禁忌第 ' + (di + 1) + ' 条里：这条策略生成不出来，请改掉其中一个');
      else warns.push('理想第 ' + (ai + 1) + ' 条与禁忌第 ' + (di + 1) + ' 条可能重合，抽到特定手牌时仍会踩到禁忌');
    });
    allow.forEach((bRow, bi) => {
      if (bi <= ai) return;
      const bs = rowSets(bRow);
      if ([0, 1, 2].every((k) => isSubset(bs[k], as[k])) && ![0, 1, 2].every((k) => sameSet(as[k], bs[k]))) {
        warns.push('理想第 ' + (bi + 1) + ' 条被第 ' + (ai + 1) + ' 条包含：基本不会生效，可以删掉');
      }
    });
  });

  deny.forEach((aRow, ai) => {
    deny.forEach((bRow, bi) => {
      if (bi <= ai) return;
      const as = rowSets(aRow), bs = rowSets(bRow);
      if ([0, 1, 2].every((k) => isSubset(as[k], bs[k])) && ![0, 1, 2].every((k) => sameSet(as[k], bs[k]))) {
        warns.push('禁忌第 ' + (ai + 1) + ' 条被第 ' + (bi + 1) + ' 条包含：多余，可以删掉');
      }
    });
  });

  return { errors, warns };
}

// cfg = { allow: [[slot,slot,slot], …], deny: [[slot,slot,slot], …] }
// prefer = 记录里那回合出的卡（用来决定"格内优先顺序"：记录里的卡排最前）
export function fineToStrategies(cfg, prefer = []) {
  const out = [];
  const seen = new Set();
  const push = (slots) => {
    if (slots.every(isDef)) return;                       // 三格都不约束 = 不写
    const key = JSON.stringify(slots);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ card1: slots[0], card2: slots[1], card3: slots[2], breakpoint: [false, false], colorFirst: true });
  };
  const orderedCards = (allowed) => {
    const first = prefer.filter((c) => allowed.includes(c));
    return [...new Set([...first, ...allowed])];
  };

  for (const row of cfg?.allow || []) push((row || []).map(normSlot));

  // 单格禁忌可以合成一条：BB 只取「第一条凑得出的策略」，合成后才能同时生效
  const forbidCards = [null, null, null];
  const forbidNp = [null, null, null];
  const multi = [];
  for (const row of cfg?.deny || []) {
    const slots = (row || []).map(normSlot);
    const used = slots.map((s, i) => (isDef(s) ? -1 : i)).filter((i) => i >= 0);
    if (used.length === 1) {
      const i = used[0];
      const slot = slots[i];
      if (slot.type === 0) (forbidNp[i] = forbidNp[i] || new Set()).add(slot.cards[0]);
      else {
        forbidCards[i] = forbidCards[i] || new Set();
        for (const c of slot.cards) forbidCards[i].add(c);
      }
    } else if (used.length >= 2) {
      multi.push(slots);
    }
  }

  // 合成后的那一格：允许 = 全部卡减掉被禁的，顺序仍按记录优先
  const merged = [deffSlot(), deffSlot(), deffSlot()];
  let mergedAny = false;
  for (let i = 0; i < 3; i++) {
    if (forbidCards[i]) {
      const allowed = CARD_UNIVERSE.filter((c) => !forbidCards[i].has(c));
      if (allowed.length) { merged[i] = cardSlot(orderedCards(allowed)); mergedAny = true; }
    } else if (forbidNp[i]) {
      const left = [1, 2, 3].filter((n) => !forbidNp[i].has(n));
      if (left.length === 1) { merged[i] = npSlot(left[0]); mergedAny = true; }
      else if (left.length > 1) {
        for (const n of left) {
          const one = [deffSlot(), deffSlot(), deffSlot()];
          one[i] = npSlot(n);
          push(one);
        }
      }
    }
  }
  if (mergedAny) push(merged.map((x) => ({ ...x })));

  // 多格禁忌没法合并，只能一条打破一格；BB 取第一条，所以后面的多半不生效
  for (const slots of multi) {
    slots.forEach((slot, i) => {
      if (isDef(slot)) return;
      const others = [deffSlot(), deffSlot(), deffSlot()];
      if (slot.type === 0) {
        for (const n of [1, 2, 3]) {
          if (slot.cards.includes(n)) continue;
          others[i] = npSlot(n);
          push(others.map((x) => ({ ...x })));
        }
      } else {
        const allowed = CARD_UNIVERSE.filter((c) => !slot.cards.includes(c));
        if (!allowed.length) return;
        others[i] = cardSlot(orderedCards(allowed));
        push(others.map((x) => ({ ...x })));
      }
    });
  }
  return out.length ? out : null;
}

// 把每一面/回合出的是什么牌列出来，供界面让用户决定要不要注入这一回合的出卡策略
export function describeTurns(team, waveCount = 0) {
  const attacks = (team?.actions || []).filter((a) => a.type === 'attack');
  const rounds = assignRounds(attacks.length, waveCount);
  const where = new Map();
  rounds.forEach((idxs, ri) => idxs.forEach((ti, k) => where.set(ti, { round: ri + 1, turn: k })));
  const list = [];
  attacks.forEach((a, ti) => {
    const pos = where.get(ti) || { round: 1, turn: 0 };
    const cards = (a.attacks || []).map((atk) => (atk.isTD
      ? { kind: 'np', text: '宝具·' + (atk.svt + 1) + '号位' }
      : { kind: 'card', text: cardCode(atk) }));
    list.push({
      key: 'r' + pos.round + 't' + pos.turn,
      round: pos.round,
      turn: pos.turn,
      cards,
      npCount: cards.filter((c) => c.kind === 'np').length,
      cardCount: cards.filter((c) => c.kind === 'card').length,
      pureNp: cards.filter((c) => c.kind === 'card').length === 0,
    });
  });
  return list;
}

// overrides.__quest = 已解析的关卡对象（可选，用来算敌方站位）；其余字段是设置项
// overrides.__waveSlots = 直接给每波敌方站位（可选，优先于 __quest）
export function convertTeam(team, ctx, overrides = {}) {
  const warnings = [];
  // 存档字段校验 —— 缺了必需字段就报错，别产出一份看着正常的空脚本
  if (!team || typeof team !== 'object') fail('没有队伍数据：这个文件里没读到队伍');
  if (!team.team || !Array.isArray(team.team.onFieldSvts) || !team.team.onFieldSvts.length) {
    fail('这条队伍没有上场从者（team.onFieldSvts 是空的）：换一条在 Chaldea 战斗模拟里保存过的队伍');
  }
  if (!Array.isArray(team.actions) || !team.actions.length) {
    fail('这条队伍没有动作记录（actions 是空的）：在 Chaldea 的战斗模拟里把这一回合跑完再保存');
  }
  const svts = team.team.onFieldSvts;
  const npType = id => ctx.funcTypes(ctx.tdById.get(id)?.functions);
  const skillType = id => ctx.funcTypes(ctx.skillById.get(id)?.functions);

  // waveSlots 由调用方查好传进来（哪一关卡的缓存是它的 IO 事）
  const waveSlots = overrides?.__waveSlots ?? ctx.waveSlotsOf(overrides?.__quest);
  // 有些从者在 BB 里要「按名字调用」：第三个参数是这个技能弹出的选项值。
  // idx = 第几个技能（0 基）；idx 为 null 表示该从者所有技能都用名字写。opts 是值的完整取值范围。
  const NAMED_SVTS = {
    2501100: { named: 'Kukulkan', idx: null, opts: [0, 1], label: '是否消耗暴击星' },
    204900: { named: 'Barghest', idx: 2, opts: [0, 1], label: '是否变身' },
    704900: { named: 'Soujyuro', idx: 2, opts: ['Q', 'A', 'B'], label: '三色魔放选哪个' },
    2300600: { named: 'BBDubai', idx: 2, opts: [0, 1], label: '是否变身' },
    2300700: { named: 'Hakuno', idx: 2, opts: ['Q', 'A', 'B'], label: '宝具卡色' },
    2300800: { named: 'Hakuno', idx: 2, opts: ['Q', 'A', 'B'], label: '宝具卡色' },
    305600: { named: 'VanGoghMiner', idx: 0, opts: ['Q', 'A', 'B'], label: '三色魔放选哪个' },
    2801000: { named: 'Dante', idx: 1, opts: ['A', 'B'], label: '蓝/红' },
    2301100: { named: 'Gyokuto', idx: 1, opts: ['All', 'One'], label: '全体/单体' },
    603800: { named: 'Charlotte', idx: 2, opts: ['Q', 'A', 'B'], label: '特攻颜色' },
    1002000: { named: 'Flora', idx: 2, opts: ['T', 'D'], label: '充能阶段' },
    505600: { named: 'Prelati', idx: 0, opts: ['不替换', '替换'], label: '是否替换' },
    505700: { named: 'Prelati', idx: 0, opts: ['不替换', '替换'], label: '是否替换' },
    405900: { named: 'Lilith', idx: 2, opts: ['不付与即死', '付与即死'], label: '是否付与即死' },
    203300: { named: 'Masi', idx: 0, opts: ['无敌', '毅力'], label: '无敌/毅力' },
  };
  // 负数写法：[-技能号, 颜色序号]（1 基），用于放宝具前选颜色
  const NEG_SVTS = {
    1100900: { idx: 1, count: 3, label: '宝具颜色' },
    200100: { idx: 2, count: 2, label: '魔放颜色' },
  };
  if (!waveSlots) warnings.push('没找到该关卡的缓存数据，敌方站位按 1/2/3 处理');

  const mcId = team.team.mysticCode?.mysticCodeId;
  const mc = mcId != null ? ctx.mcById.get(mcId) : null;
  if (mcId != null && !(mcId in ctx.mcSN)) {
    const n = ctx.mcSNote?.[mcId];
    warnings.push('御主礼装「' + (mc?.name || n?.jp || mcId) + '」对不上 BB 的编号'
      + (n?.cn ? '（master_info 里没有「' + n.cn + '」）' : '') + '：master_equip 留空，需要在 BB 里手选礼装');
  }

  const nameOf = (s) => (s ? ctx.nameBySvt.get(String(s.svtId)) : null);
  const allSvts = [...svts, ...(team.team.backupSvts || [])];
  const names = allSvts.map(nameOf);
  names.forEach((n, i) => { if (!n && allSvts[i]) warnings.push('从者 ' + allSvts[i].svtId + ' 在 BB 名字表里找不到'); });

  const positions = [...svts];
  const backup = [...(team.team.backupSvts || [])];
  // usedServant：这一轮出场过的位次。前排三位起步，换人上来的后备位也要算进去
  const FRONT_COUNT = positions.length;
  const usedSet = new Set(positions.map((_, i) => i));
  const replaceQueue = [...(team.delegate?.replaceMemberIndexes || [])];
  const actWeightQueue = [...(team.delegate?.actWeightSelections || [])];
  const actSelectQueue = [...(team.delegate?.skillActSelectSelections || [])];
  const hasFlag = (skillId, field) => {
    const s = skillId ? ctx.skillById.get(skillId) : null;
    return (s?.functions || []).some(f => (f.svals || []).some(v => v[field] != null));
  };
  const isReplaceSkill = (skillId) => {
    const s = skillId ? ctx.skillById.get(skillId) : null;
    return (s?.functions || []).some(f => ctx.funcTypeOf(f.funcId) === 'replaceMember');
  };

  const warnedSet = new Set();
  const warnOnce = (key, msg) => { if (!warnedSet.has(key)) { warnedSet.add(key); warnings.push(msg); } };

  const turnList = [];
  let cur = null, turnIndex = -1, currentEnemy = 1;

  // 一面打几回合：记录里只有 attack 动作、没有血量，只能比对「回合数 vs 关卡面数」。
  // 常规是 3 面 3 回合；柱柱战这类只有一面、可能打很多回合，多出来的回合都归那一面 —— 所以超出面数时按最后一面算。
  const turnCount = (team.actions || []).filter(a => a.type === 'attack').length;
  const waveCount = waveSlots?.length ?? 0;
  if (waveCount > 0 && turnCount > waveCount) {
    warnings.push('这一队打了 ' + turnCount + ' 回合、关卡只有 ' + waveCount + ' 面 —— 多出来的回合按最后一面处理（柱柱战这类只有一面的情况是对的；若前面某面打了多回合则站位可能偏）');
  }
  const stageOf = (i) => (waveSlots?.length ? waveSlots[Math.min(i, waveSlots.length - 1)] : null);
  const stageDefault = (stage) => (stage && stage.length ? Math.min(...stage) : 1);
  const startTurn = () => {
    turnIndex++;
    // 每回合开始都按「该面默认选中 = 第一个非空站位」算：换面如此，同一面内目标被打死也会回落到这里。
    // 宁可多插一次 13（多余动作），也不能漏插（打错人）。
    currentEnemy = stageDefault(stageOf(turnIndex));
    cur = { skills: [], np: [] };
  };
  const ensureEnemy = (opts) => {
    // enemyTarget 是 deckId-1；[13, n] 的 n 就是 deckId，也就是敌方屏幕站位
    // （1..3 第一排左中右，4..6 第二排）。
    // 只有「要打的敌人 ≠ 当前选中」时才插：放完一个对敌技能，选中项就落到那个敌人身上，默认是第一个非空站位。
    const want = (opts?.enemyTarget ?? 0) + 1;
    const stage = stageOf(turnIndex);
    if (stage && !stage.includes(want)) warnOnce('E' + turnIndex, '目标站位 ' + want + ' 不在这一波的敌人里（' + stage.join('/') + '），按原样写 [13, ' + want + ']');
    if (want !== currentEnemy) {
      cur.skills.push([SELECT_TARGET_CMD, want]);
      currentEnemy = want;
    }
  };

  const actions = team.actions;
  const unknownTypes = [...new Set(actions.filter((a) => a?.type !== 'skill' && a?.type !== 'attack').map((a) => String(a?.type)))];
  if (unknownTypes.length) warnings.push('有动作的类型不认识（' + unknownTypes.join('、') + '），已跳过：可能是 Chaldea 新加的记法，产出请核对');
  const emptyAttacks = actions.filter((a) => a?.type === 'attack' && !(Array.isArray(a.attacks) && a.attacks.length)).length;
  if (emptyAttacks) warnings.push('有 ' + emptyAttacks + ' 个回合没记录出卡（attacks 是空的），对应的 _np / _strategy 会是空的');
  // 岸波白野技能 1（洗牌）要填“想要哪几张卡”，正好能用这一回合记录的三张卡拼成一条组合
  const HAKUNO_SVTS = new Set(HAKUNO_IDS);
  const shuffleRetries = Math.max(0, Number(overrides?.shuffleRetries ?? 0) || 0);
  // 条件块：释放标志 0 = 「条件不满足才执行」，用它把“再洗一次”包起来
  const startBlock = (invert, mask) => ['Start', invert, mask, ['np', [0, '≥', 0], [0, '≥', 0], [0, '≥', 0]]];
  // 把一回合的三张卡写成一条「条件判断策略」（勾选位按它在 _condition 里的下标来）
  const conditionStrategy = (cards) => {
    const slot = (c) => ({ type: 1, cards: [c], criticalStar: 0, more_or_less: true });
    return { card1: slot(cards[0]), card2: slot(cards[1] ?? cards[0]), card3: slot(cards[2] ?? cards[0]), breakpoint: [false, false], colorFirst: true };
  };
  const nextAttackCards = (from) => {
    for (let k = from + 1; k < actions.length; k++) {
      if (actions[k].type === 'attack') return (actions[k].attacks || []).map(cardCode);
    }
    return null;
  };

  for (let ai = 0; ai < actions.length; ai++) {
    const a = actions[ai];
    if (!cur) startTurn();
    if (a.type === 'skill') {
      const isMC = a.svt === undefined || a.svt === null;
      const idx = a.skill;
      const num = isMC ? 10 + idx : a.svt * 3 + idx + 1;
      const actor = isMC ? null : positions[a.svt];
      const skillId = isMC ? (mc?.skills?.[idx]?.id ?? null) : actor?.skillIds?.[idx] ?? null;
      const types = skillId ? skillType(skillId) : [];
      // 目标判定以 atlas 为准；只有 atlas 没这份技能的功能数据（functions 为空）时才退回 BB 的 skill_type。
      // atlas 同一个 num 有原技能和强化后技能两条，这里取 Chaldea 记录里实际指向的那个 id，天然是强化后的。
      const bbT = (!isMC && actor) ? ctx.bbSkillType.get(String(actor.svtId))?.[idx] : undefined;
      const bbWantsTarget = bbT === 1 || bbT === 3;
      let needTarget = types.some(t => ALLY_TARGET_TYPES.has(t));
      if (!needTarget && types.length === 0 && bbWantsTarget) {
        needTarget = true;
        if (actor) warnOnce('tgt-' + actor.svtId + '-' + idx, 'atlas 缺该技能的功能数据，按 BB 表补目标：' + nameOf(actor) + ' 技能' + (idx + 1));
      } else if (!isMC && actor && bbT !== undefined) {
        const tag = 'tgt-' + actor.svtId + '-' + idx;
        if (bbWantsTarget && !needTarget) warnOnce(tag, '目标判定分歧：' + nameOf(actor) + ' 技能' + (idx + 1) + '，BB 表要选人但 atlas 不要 —— 按 atlas 不写目标');
        else if (!bbWantsTarget && needTarget) warnOnce(tag, '目标判定分歧：' + nameOf(actor) + ' 技能' + (idx + 1) + '，atlas 要选人但 BB 表不要 —— 按 atlas 写目标');
      }
      const spec = (!isMC && actor) ? NAMED_SVTS[actor.svtId] : null;
      const named = spec && (spec.idx === null || spec.idx === idx) ? spec.named : null;
      const negSpec = (!isMC && actor) ? NEG_SVTS[actor.svtId] : null;
      if (skillId && isReplaceSkill(skillId) && replaceQueue.length) {
        const [onFieldIdx, backupIdx] = replaceQueue.shift();
        cur.skills.push([num, onFieldIdx + 1, backupIdx + 4]);
        usedSet.add(FRONT_COUNT + backupIdx);
        if (positions[onFieldIdx] !== undefined && backup[backupIdx] !== undefined) {
          const tmp = positions[onFieldIdx];
          positions[onFieldIdx] = backup[backupIdx];
          backup[backupIdx] = tmp;
        }
      } else {
      // ActSet：技能带“消耗暴击星”这类选项时，记录里的选择按执行顺序排列
      let starFlag = null;
      if (!isMC && skillId) {
        if (hasFlag(skillId, 'ActSet') && actWeightQueue.length) {
          const v = actWeightQueue.shift();
          starFlag = (typeof v === 'number' && v >= 1) ? 1 : 0;
        }
        if (hasFlag(skillId, 'ActSelectIndex') && actSelectQueue.length) {
          const v = actSelectQueue.shift();
          starFlag = (typeof v === 'number' && v >= 1) ? 1 : 0;
        }
      }
      if (!isMC && actor && HAKUNO_SVTS.has(actor.svtId) && idx === 0) {
        const combo = nextAttackCards(ai);
        if (shuffleRetries > 0 && combo && combo.length) {
          // 洗牌是随机的，['Hakuno', …] 那种写法会让 BB 死等；改成「洗一次 + N 个反向条件块再洗」
          cur.skills.push(num);
          for (let k = 0; k < shuffleRetries; k++) {
            cur.skills.push(startBlock(0, [1]), num, ['End']);
          }
          cur.condition = [conditionStrategy(combo)];
          warnOnce('hakuno-retry-' + ai, '岸波白野技能' + (idx + 1) + '：按最多洗 ' + (shuffleRetries + 1) + ' 次生成（条件=本回合要的三张卡，洗到就不再多洗）');
        } else if (combo && combo.length) {
          // 没设置重试次数时退回 BB 自带的等待写法
          cur.skills.push(['Hakuno', num, [combo]]);
        } else {
          cur.skills.push(['Hakuno', num, []]);
          warnOnce('hakuno-' + ai, '岸波白野技能' + (idx + 1) + ' 要填「想要哪几张卡」，但这一回合后面没有记录到出卡，先留空，需手工补');
        }
      } else if (negSpec && negSpec.idx === idx) {
        // 负数写法：Chaldea 记录里没有这个颜色选择，先按 1 号位写，并提示人工改
        cur.skills.push([-num, 1]);
        warnOnce('neg-' + actor.svtId, '负数写法：' + nameOf(actor) + ' 技能' + (idx + 1) + ' 要先选' + negSpec.label + '（共 ' + negSpec.count + ' 项），记录里没有这个选择，先按 1 写，必要时手工改');
      } else if (named) {
        // 第三个参数：Kukulkan 是 0/1 吃星，其它是那张表里的字面值
        let choice;
        if (spec.idx === null) { // 只有库库尔坎的第三个参数是“吃不吃星”，其余都是表里的字面值
          choice = starFlag ?? (needTarget ? 0 : 1);
        } else {
          choice = spec.opts[0];
          warnOnce('opt-' + actor.svtId + '-' + idx, '特殊从者选项：' + nameOf(actor) + ' 技能' + (idx + 1) + ' 要带「' + spec.label + '」（' + spec.opts.join(' / ') + '），记录里没有这个选择，先按「' + choice + '」写，必要时手工改');
        }
        if (needTarget) {
          cur.skills.push([named, num, choice, (a.options?.playerTarget ?? 0) + 1]);
        } else if (types.includes('enemy') && !types.includes('enemyAll')) {
          ensureEnemy(a.options);
          cur.skills.push([named, num, choice]);
        } else {
          cur.skills.push([named, num, choice]);
        }
      } else if (needTarget) {
        cur.skills.push([num, (a.options?.playerTarget ?? 0) + 1]);
      } else if (types.includes('enemy') && !types.includes('enemyAll')) {
        ensureEnemy(a.options);
        cur.skills.push(num);
      } else {
        cur.skills.push(num);
      }
      }
    } else if (a.type === 'attack') {
      const needsEnemy = (a.attacks || []).some(atk => {
        if (!atk.isTD) return true;
        const t = npType(atk.tdId || positions[atk.svt]?.tdId);
        return t.includes('enemy') && !t.includes('enemyAll');
      });
      if (needsEnemy) ensureEnemy(a.options);
      for (const atk of a.attacks || []) if (atk.isTD) cur.np.push(atk.svt + 1);
      // 出卡策略 —— 把这一回合记录的三张卡原样写成 strategy（BB 自带脚本里常见这个字段）
      const cardOf = (atk) => atk.isTD
        ? { type: 0, cards: [atk.svt + 1], criticalStar: 0, more_or_less: true }
        : { type: 1, cards: [cardCode(atk)], criticalStar: 0, more_or_less: true };
      const slots = (a.attacks || []).map(cardOf);
      while (slots.length < 3) slots.push({ type: 2, cards: [], criticalStar: 0, more_or_less: true });
      // 整面只有宝具（没有指令卡）时不写策略：写出来也只是「宝具 + 缺省 + 缺省」，没有约束力
      cur.strategy = (a.attacks || []).some((x) => !x.isTD)
        ? [{ card1: slots[0], card2: slots[1], card3: slots[2], breakpoint: [false, false], colorFirst: true }]
        : null;
      cur.preferCards = (a.attacks || []).filter((x) => !x.isTD).map(cardCode);
      turnList.push(cur);
      cur = null;
    }
  }
  if (cur) turnList.push(cur);



  // 出卡策略按回合挑：overrides.injectTurns 里列到的才写，没传就全写（命令行场景）
  const injectTurns = overrides?.injectTurns;
  const injectSet = Array.isArray(injectTurns) ? new Set(injectTurns) : null;
  const wantStrategy = overrides?.emitStrategy !== false && overrides?.emitStrategy !== 0;
  const injectThis = (r, t) => wantStrategy && (!injectSet || injectSet.has('r' + r + 't' + t));

  const pad = (arr) => { const r = arr.slice(); while (r.length < 6) r.push(null); return r; };
  const out = {
    servant_0_name: names[0] ?? null, servant_1_name: names[1] ?? null, servant_2_name: names[2] ?? null,
    servant_3_name: names[3] ?? null, servant_4_name: names[4] ?? null, servant_5_name: names[5] ?? null,
    dropImage: null, onlyFriendAssist: 0, fullEquip: 1, NPlevel: 1, randomTouch: 0, randomTime: 0.0,
    firstBattleSet: 1, intervalBF: 0.0, intervalAF: 0.1, scrollLimit: 0.96, clearAP: 1,
    allowOtherApple: 0, fullFriendshipStop: 1, gameCrushRestart: 0, dropStopNum: 0, server: 'CH',
    skillsLevel: [10, 10, 10, 0, 0, 0, 0, 0],
    assistMode: '从者礼装', assistIdx: 2, assistEquip: null,
    master_equip: mcId != null ? (ctx.mcSN[mcId] ?? null) : null,
    usedServant: [...usedSet].sort((a, b) => a - b),
    round1_extraStrategy: null, round2_extraStrategy: null, round3_extraStrategy: null,
    connectMode: null, snapshotDevice: null, operateDevice: null,
    allNotSkip: 1, servantLevel: 1, stuck_times: 0, assistTags: [], ignoreFriendship: '',
    addFriend: 0, noChain: 0, noSpeedupSkill: 0, stuckRestart: 0, checkStuckInterval: 30, noGrandRefresh: 1,
    specialKeys: [], jbType: '任意',
    intervalAFswipeAssist: 0.5, intervalBFchooseCard: 0.5,
    round1_extraSkill: [], round2_extraSkill: [], round3_extraSkill: [],
  };

  // 按面分配回合：一面可以不止一回合（柱柱战就是一面打很多回合）
  const rounds = assignRounds(turnList.length, waveCount, overrides?.roundMode);
  if (rounds.length > 3) warnings.push('面数超过 3，后面的面没有写进脚本');
  rounds.slice(0, 3).forEach((idxs, ri) => {
    const r = ri + 1;
    out['round' + r + '_turns'] = idxs.length;
    idxs.forEach((ti, k) => {
      const t = turnList[ti];
      out['round' + r + '_turn' + k + '_skill'] = t.skills;
      out['round' + r + '_turn' + k + '_np'] = t.np;
      // 用了「精细策略」就按用户给的那套，否则用记录推出来的那一条
      const fine = overrides?.fineStrategy?.['r' + r + 't' + k];
      out['round' + r + '_turn' + k + '_strategy'] = injectThis(r, k)
        ? (fine ? fineToStrategies(fine, t.preferCards || []) : (t.strategy ?? null))
        : null;
      out['round' + r + '_turn' + k + '_condition'] = t.condition ?? null;
    });
  });

  const APPLY = [
    'onlyFriendAssist','fullEquip','NPlevel','servantLevel','skillsLevel','assistMode','assistIdx','assistEquip','assistTags',
    'randomTouch','randomTime','server','intervalBF','intervalAF','intervalAFswipeAssist','intervalBFchooseCard','scrollLimit',
    'clearAP','allowOtherApple','dropStopNum','fullFriendshipStop','gameCrushRestart','allNotSkip','noGrandRefresh',
    'ignoreFriendship','addFriend','noChain','noSpeedupSkill','stuckRestart','checkStuckInterval','firstBattleSet',
    'emitStrategy',
  ];
  for (const k of APPLY) {
    const v = overrides?.[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }

  // 存档构建号记进结果。超出验证过的范围只说「未验证」，不当失败 —— 但绝不能当没这回事。
  const meta = {
    questId: team.quest?.id ?? null,
    appBuild: Number.isFinite(team.appBuild) ? team.appBuild : null,
    minBuild: Number.isFinite(team.minBuild) ? team.minBuild : null,
  };
  meta.verified = meta.appBuild != null && meta.appBuild <= MAX_VERIFIED_BUILD;
  if (meta.appBuild == null) {
    warnings.push('这条队伍没记录 Chaldea 构建号（appBuild）：格式是否兼容无法判断，产出请核对');
  } else if (!meta.verified) {
    warnings.push('Chaldea 构建 ' + meta.appBuild + ' 高于本工具验证过的 ' + MAX_VERIFIED_BUILD + '：存档格式可能有变，产出请核对（未验证，不是失败）');
  }

  return { json: out, warnings: [...warnings, ...(ctx.dataWarnings || [])], meta, waveSlots, names: pad(names) };
}
