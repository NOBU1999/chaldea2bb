// SPDX-License-Identifier: MIT
const $ = (id) => document.getElementById(id);

async function post(url, body) {
  return window.apiPost(url, body || {});
}

// Chaldea 存档构建号：没超过验证过的范围就说已验证，超过了就说未验证（不拦，但要让人看见）
function buildNote(meta) {
  if (!meta) return '—';
  const build = meta.appBuild ?? '未记录';
  const min = meta.minBuild != null ? '，minBuild ' + meta.minBuild : '';
  return 'Chaldea 构建 ' + build + min + (meta.verified ? '　已验证' : '　未验证，产出请核对');
}

function showResult(r, extra) {
  $('result').classList.add('show');
  $('rawPath').textContent = r.rawPath || '—';
  $('outPath').textContent = r.outPath;
  $('buildNote').textContent = buildNote(r.meta);
  $('warnings').innerHTML = (r.warnings || []).map(w => '<li>' + w + '</li>').join('');
  $('json').textContent = JSON.stringify(r.json, null, 4);
  if (extra !== undefined) $('json').dataset.summary = extra;
}

function item(name, meta, onClick) {
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML = '<span class="name"></span><span class="meta"></span><button class="mini primary">转换</button>';
  el.querySelector('.name').textContent = name;
  el.querySelector('.meta').textContent = meta;
  el.querySelector('button').onclick = onClick;
  return el;
}

/* 转换前先摊出每回合出的牌，勾选要注入出卡策略的回合（不做记忆，每次转换都问） */
let confirmResolve = null;
function askConfirm(plan) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    const box = $('turnList');
    box.innerHTML = '';
    for (const t of plan.turns || []) {
      const row = document.createElement('label');
      row.className = 'turn-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = t.key;
      const txt = document.createElement('span');
      txt.className = 'turn-text';
      txt.textContent = '第 ' + t.round + ' 面　' + t.cards.map((c) => c.text).join(' + ');
      row.appendChild(cb);
      row.appendChild(txt);
      box.appendChild(row);
    }
    $('shuffleRow').style.display = plan.shuffle ? '' : 'none';
    $('shuffleInput').value = '0';
    $('fineToggle').checked = false;
    $('turnList').style.display = '';
    $('fineBody').style.display = 'none';
    $('fineBody').innerHTML = '';
    $('fineHint').textContent = '关：按记录里那三张卡注入';
    $('confirmDialog').classList.add('show');
  });
}
function closeConfirm(v) {
  $('confirmDialog').classList.remove('show');
  const r = confirmResolve; confirmResolve = null;
  if (r) r(v);
}
const turnLabel = (key) => {
  const m = /^r(\d+)t(\d+)$/.exec(key);
  return m ? '第 ' + m[1] + ' 面' : key;
};

$('confirmOk').onclick = () => {
  const fineOn = $('fineToggle').checked;
  if (fineOn) {
    pruneFine();
    const errors = [];
    const warns = [];
    for (const [key, cfg] of Object.entries(fineCfg)) {
      const r = (window.fineCheck && window.fineCheck(cfg)) || {};
      for (const e of r.errors || []) errors.push(turnLabel(key) + '：' + e);
      for (const w of r.warns || []) warns.push(turnLabel(key) + '：' + w);
    }
    if (errors.length) {
      alert('精细策略有问题，先改掉再转换：\n\n' + errors.join('\n'));
      return;
    }
    if (warns.length) alert('这些地方能生成，但请留意：\n\n' + warns.join('\n'));
  }
  closeConfirm({
    decide: true,
    injectTurns: fineOn
      ? Object.keys(fineCfg)
      : Array.from(document.querySelectorAll('#turnList input:checked')).map((i) => i.value),
    shuffleRetries: Math.max(0, parseInt($('shuffleInput').value, 10) || 0),
    fineStrategy: fineOn ? fineCfg : {},
  });
};
$('confirmCancel').onclick = () => closeConfirm(null);
$('confirmDialog').addEventListener('click', (e) => { if (e.target.id === 'confirmDialog') closeConfirm(null); });

/* ---------------- 精细出卡策略（独立面板，按需启用） ---------------- */
const CARD_CODES = ['1B', '2B', '3B', '1A', '2A', '3A', '1Q', '2Q', '3Q'];
let fineCfg = {};          // { 'r1t0': { allow: [[slot,slot,slot]], deny: [...] } }
let currentPlan = null;    // 当前这次转换的回合表

const blankRow = () => [{ type: 2, cards: [] }, { type: 2, cards: [] }, { type: 2, cards: [] }];
const rowFromRecord = (t) => t.cards.map((c) => {
  if (c.kind === 'np') {
    const m = /(\d)/.exec(c.text);
    return { type: 0, cards: [m ? Number(m[1]) : 1] };
  }
  return { type: 1, cards: [c.text] };
});

// 一个格子：宝具 ①②③ 一行 + 三行指令卡（每行一个从者的 B/A/Q）
function slotEditor(slot, index) {
  const card = document.createElement('div');
  card.className = 'slot-card';
  const head = document.createElement('div');
  head.className = 'slot-head';
  const title = document.createElement('span');
  const reset = document.createElement('button');
  reset.className = 'mini';
  reset.type = 'button';
  reset.textContent = '缺省';
  reset.onclick = (e) => { e.preventDefault(); slot.type = 2; slot.cards = []; paint(); };
  head.appendChild(title);
  head.appendChild(reset);
  const body = document.createElement('div');

  const chip = (text, extra) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (extra ? ' ' + extra : '');
    b.textContent = text;
    return b;
  };

  function paint() {
    title.textContent = '格' + (index + 1) + (slot.type === 2 ? '（不约束）' : '');
    card.classList.toggle('on', slot.type !== 2);
    body.innerHTML = '';

    // 宝具：三选一
    const npRow = document.createElement('div');
    npRow.className = 'chip-row';
    for (const n of [1, 2, 3]) {
      const b = chip(n + '号宝具', 'np');
      if (slot.type === 0 && slot.cards[0] === n) b.classList.add('on');
      b.onclick = (e) => {
        e.preventDefault();
        if (slot.type === 0 && slot.cards[0] === n) { slot.type = 2; slot.cards = []; }
        else { slot.type = 0; slot.cards = [n]; }
        paint();
      };
      npRow.appendChild(b);
    }
    body.appendChild(npRow);

    // 指令卡：按从者分行，B/A/Q 三张
    for (const svt of [1, 2, 3]) {
      const row = document.createElement('div');
      row.className = 'chip-row';
      for (const color of ['B', 'A', 'Q']) {
        const code = svt + color;
        const b = chip(code);
        if (slot.type === 1 && slot.cards.includes(code)) {
          b.classList.add('on');
          if (slot.cards.length > 1) b.dataset.idx = String(slot.cards.indexOf(code) + 1);
        }
        b.onclick = (e) => {
          e.preventDefault();
          if (slot.type !== 1) { slot.type = 1; slot.cards = [code]; }
          else if (slot.cards.includes(code)) {
            slot.cards = slot.cards.filter((c) => c !== code);
            if (!slot.cards.length) slot.type = 2;
          } else slot.cards.push(code);
          paint();
        };
        row.appendChild(b);
      }
      body.appendChild(row);
    }
  }

  paint();
  card.appendChild(head);
  card.appendChild(body);
  return card;
}

function fineRow(rowData, onDelete) {
  const row = document.createElement('div');
  row.className = 'fine-row';
  for (let i = 0; i < 3; i++) {
    if (!rowData[i]) rowData[i] = { type: 2, cards: [] };
    row.appendChild(slotEditor(rowData[i], i));
  }
  const del = document.createElement('button');
  del.className = 'mini del';
  del.textContent = '删除';
  del.onclick = (e) => { e.preventDefault(); onDelete(); };
  row.appendChild(del);
  return row;
}

function fineRowList(field, cfg, label, hint) {
  const wrap = document.createElement('div');
  wrap.className = 'fine-sec';
  const head = document.createElement('div');
  head.className = 'fine-sec-head';
  const tag = document.createElement('span');
  tag.className = 'tag ' + (field === 'allow' ? 'want' : 'deny');
  tag.textContent = label;
  head.appendChild(tag);
  const tip = document.createElement('span');
  tip.className = 'hint';
  tip.style.margin = '0';
  tip.textContent = hint;
  head.appendChild(tip);
  wrap.appendChild(head);
  for (const rowData of cfg[field]) {
    wrap.appendChild(fineRow(rowData, () => {
      cfg[field].splice(cfg[field].indexOf(rowData), 1);
      renderFine();
    }));
  }
  const add = document.createElement('button');
  add.className = 'mini';
  add.textContent = '+ 增加一条';
  add.onclick = (e) => {
    e.preventDefault();
    cfg[field].push(blankRow());
    renderFine();
  };
  head.appendChild(add);
  return wrap;
}

function renderFine() {
  const box = $('fineBody');
  box.innerHTML = '';
  const turns = (currentPlan?.turns || []).filter((t) => !t.pureNp);
  if (!turns.length) { box.innerHTML = '<div class="empty">这次转换没有可设置的回合</div>'; return; }
  for (const t of turns) {
    const cfg = (fineCfg[t.key] = fineCfg[t.key] || { allow: [], deny: [] });
    if (!cfg.allow.length && !cfg.deny.length) cfg.allow.push(rowFromRecord(t));
    const sec = document.createElement('section');
    sec.className = 'fine-turn';
    const titleRow = document.createElement('div');
    titleRow.className = 'fine-turn-title';
    const b = document.createElement('b');
    b.textContent = '第 ' + t.round + ' 面';
    const rec = document.createElement('span');
    rec.textContent = '记录：' + t.cards.map((c) => c.text).join(' + ');
    titleRow.appendChild(b);
    titleRow.appendChild(rec);
    sec.appendChild(titleRow);
    sec.appendChild(fineRowList('allow', cfg, '理想', '想按这个顺序出'));
    sec.appendChild(fineRowList('deny', cfg, '禁忌', '这样出就不要，自动转成其余都行'));
    box.appendChild(sec);
  }
}

$('fineToggle').onchange = () => {
  const on = $('fineToggle').checked;
  $('turnList').style.display = on ? 'none' : '';
  $('fineBody').style.display = on ? '' : 'none';
  $('fineHint').textContent = on
    ? '开：自己写理想 / 禁忌牌序，没写牌序的回合不注入策略'
    : '关：按记录里那三张卡注入';
  if (on) renderFine();
};

// 提交前把全空的行收掉：一条牌序都没写的回合等于「不注入」
function pruneFine() {
  for (const key of Object.keys(fineCfg)) {
    const cfg = fineCfg[key];
    const keep = (rows) => rows.filter((r) => r.some((s) => s.type !== 2 && (s.type === 0 || s.cards.length)));
    cfg.allow = keep(cfg.allow);
    cfg.deny = keep(cfg.deny);
    if (!cfg.allow.length && !cfg.deny.length) delete fineCfg[key];
  }
}

async function convertCall(url, body) {
  fineCfg = {};
  const res = await window.apiPost(url, body);
  if (res.ok && res.needsConfirm) {
    const plan = res.plan || {};
    currentPlan = plan;
    // 纯宝具的面没有指令卡，注入策略也没约束力 —— 不列出来
    const turns = (plan.turns || []).filter((t) => !t.pureNp);
    if (!turns.length && !plan.shuffle) {
      return window.apiPost(url, { ...body, decide: true, injectTurns: [], shuffleRetries: 0 });
    }
    const ans = await askConfirm({ turns, shuffle: plan.shuffle });
    if (!ans) return { ok: false, cancelled: true };
    return window.apiPost(url, { ...body, ...ans });
  }
  return res;
}
/* 链接 */
let pendingUrl = '';

$('linkBtn').onclick = async () => {
  const url = $('link').value.trim();
  if (!url) return;
  $('linkBtn').disabled = true;
  const r = await post('/api/link', { url });
  $('linkBtn').disabled = false;
  if (!r.ok) { alert(r.error || '解析失败'); return; }
  pendingUrl = url;
  $('nameInput').value = r.defaultName || '';
  $('nameDialog').classList.add('show');
  $('nameInput').focus();
  $('nameInput').select();
};

function closeDialog() { $('nameDialog').classList.remove('show'); }
$('nameCancel').onclick = closeDialog;
$('nameDialog').addEventListener('click', (e) => { if (e.target.id === 'nameDialog') closeDialog(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDialog(); });

$('nameOk').onclick = async () => {
  $('nameOk').disabled = true;
  const r = await post('/api/link/save', { url: pendingUrl, name: $('nameInput').value.trim() });
  $('nameOk').disabled = false;
  if (!r.ok) { alert(r.error || '保存失败'); return; }
  closeDialog();
  $('result').classList.add('show');
  $('rawPath').textContent = r.rawPath;
  $('outPath').textContent = '—';
  $('warnings').innerHTML = '';
  $('json').textContent = '';
  loadRaw();
};

/* 文件夹 */
/* 打开输出文件夹 */
$('openOutput').onclick = async () => {
  const r = await window.apiPost('/api/reveal', { target: 'output' });
  if (!r.ok) alert(r.error || '打不开输出文件夹');
};
$('pick').onclick = async () => {
  $('pick').disabled = true;
  try {
    const r = await post('/api/pick-folder');
    if (r.ok && r.dir) { $('dir').value = r.dir; await loadTeams(); }
  } finally { $('pick').disabled = false; }
};

// 选好文件夹后自动列出队伍，不再需要单独的「扫描」
async function loadTeams() {
  const dir = $('dir').value.trim();
  if (!dir) return;
  const box = $('list');
  box.innerHTML = '<div class="empty">…</div>';
  const r = await post('/api/scan', { dir });
  box.innerHTML = '';
  if (!r.ok) { box.innerHTML = '<div class="empty">' + (r.error || '读取失败') + '</div>'; return; }
  if (!r.files.length) { box.innerHTML = '<div class="empty">这个文件夹里没有找到队伍</div>'; return; }
  for (const f of r.files) {
    for (const t of f.teams) {
      const el = item(t.name, '关卡 ' + (t.quest?.id ?? '?') + ' · ' + t.actions + ' 条', async () => {
        const res = await convertCall('/api/convert', { file: f.file, index: t.index });
        if (!res.ok) return alert(res.error || '转换失败');
        showResult(res);
      });
      box.appendChild(el);
    }
  }
}

// 只负责把上次用的目录填回去（不再渲染最近目录列表）
async function restoreFolder() {
  if ($('dir').value.trim()) return;
  const r = await window.apiGet('/api/folders');
  if (r.dirs?.length) { $('dir').value = r.dirs[0]; return; }
  // 没选过目录：设置里填了 Chaldea 目录就直接用它，省得再选一次
  const s = await window.apiGet('/api/settings');
  if (s.settings?.chaldeaHome) $('dir').value = s.settings.chaldeaHome;
}
/* raw */
async function loadRaw() {
  const r = await window.apiGet('/api/raw');
  const box = $('rawList');
  box.innerHTML = '';
  if (!r.files?.length) { box.innerHTML = '<div class="empty">—</div>'; return; }
  for (const f of r.files) {
    const el = item(f.name.replace(/\.json$/, ''), (f.size / 1024).toFixed(1) + ' KB', async () => {
      const res = await convertCall('/api/convert-raw', { name: f.name });
      if (!res.ok) return alert(res.error || '转换失败');
      showResult(res);
    });
    box.appendChild(el);
  }
}
$('refreshRaw').onclick = loadRaw;

restoreFolder().then(() => { if ($('dir').value.trim()) loadTeams(); });
loadRaw();


const DEFAULT_SETTINGS = {
  chaldeaHome: '', bbRoot: '',
  onlyFriendAssist: 0, fullEquip: 1, NPlevel: 1, servantLevel: 1,
  skillsLevel: [10, 10, 10, 0, 0, 0, 0, 0],
  assistMode: '从者礼装', assistIdx: 2, server: 'CH',
  clearAP: 1, allowOtherApple: 0, fullFriendshipStop: 1, gameCrushRestart: 0,
  allNotSkip: 1, noGrandRefresh: 1, ignoreFriendship: '', addFriend: 0,
  noChain: 0, stuckRestart: 0, checkStuckInterval: 30, firstBattleSet: 1,
};

const SETTINGS_GROUPS = [
  {
    title: '路径',
    items: [
      ['chaldeaHome', 'Chaldea 目录', 'text'],
      ['bbRoot', 'BBchannel 目录', 'text'],
      ['outputDir', '输出文件夹', 'outdir'],
    ],
  },
  {
    title: '助战',
    items: [
      ['assistMode', '识别模式', 'select', [['不识别','不识别'],['仅礼装','仅礼装'],['仅从者','仅从者'],['从者礼装','从者礼装'],['冠位助战','冠位助战'],['冠位助战仅礼装','冠位助战仅礼装']]],
      ['assistIdx', '助战位次（1–6）', 'num'],
      ['onlyFriendAssist', '仅好友助战', 'bool'],
      ['fullEquip', '满破礼装', 'bool'],
      ['NPlevel', '宝具等级 ≥', 'num'],
      ['servantLevel', '从者等级 ≥', 'num'],
      ['skillsLevel', '技能等级', 'levels'],
      ['server', '服务器', 'select', [['CH','简中服'],['CNTW','繁中服'],['JP','日语服']]],
    ],
  },
  {
    title: '运行',
    items: [
      ['clearAP', '清空体力', 'bool'],
      ['allowOtherApple', '允许其他苹果', 'bool'],
      ['fullFriendshipStop', '满羁绊停止', 'bool'],
      ['gameCrushRestart', '闪退重启', 'bool'],
      ['allNotSkip', 'ALL 阶不跳转', 'bool'],
      ['noGrandRefresh', '冠位页提前刷新', 'bool'],
      ['ignoreFriendship', '忽略满绊位次', 'text'],
      ['addFriend', '自动加好友', 'bool'],
      ['noChain', '宝具后避免连携', 'bool'],
      ['stuckRestart', '卡死重启', 'bool'],
      ['checkStuckInterval', '卡死监测间隔（秒）', 'num'],
      ['firstBattleSet', '首次调速', 'bool'],
    ],
  },
];

// 输出目录候选：默认「程序目录下的 output」；装了 BBchannel 就把它读脚本的 settings 也列出来
async function fillOutdir(select, preferPath) {
  const r = await window.apiGet('/api/outdirs');
  if (!r || !r.ok) return;
  const opts = [['', '默认：程序目录下的 output']];
  for (const c of r.candidates || []) opts.push([c.path, c.label]);
  const customs = Array.isArray(r.customs) ? r.customs.filter(Boolean) : [];
  for (const p of customs) opts.push([p, '自定义：' + p]);
  const cur = String(preferPath || r.current || '');
  if (cur && !opts.some(([v]) => v === cur)) opts.push([cur, '自定义：' + cur]);
  select.innerHTML = opts.map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('');
  select.value = cur;
  select.dataset.customs = JSON.stringify(customs);
  select.dataset.builtins = JSON.stringify((r.candidates || []).map((c) => c.path));
  if (select.oncustomchange) select.oncustomchange();
}

function makeControl(key, type, options, value) {
  let ctrl;
  if (type === 'levels') {
    ctrl = document.createElement('div');
    ctrl.className = 'skill-levels';
    const arr = Array.isArray(value) ? value : [];
    for (let i = 0; i < 8; i++) {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = '0';
      inp.max = '10';
      inp.value = arr[i] ?? 0;
      inp.dataset.slot = String(i);
      ctrl.appendChild(inp);
    }
    ctrl.dataset.key = key;
    ctrl.dataset.type = type;
    return ctrl;
  }
  if (type === 'select') {
    ctrl = document.createElement('select');
    ctrl.innerHTML = options.map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('');
    ctrl.value = String(value);
  } else if (type === 'bool') {
    ctrl = document.createElement('select');
    ctrl.innerHTML = '<option value="1">开</option><option value="0">关</option>';
    ctrl.value = String(value);
  } else if (type === 'outdir') {
    // 候选要问后端（BBchannel 的 settings 装好才知道在哪），所以先搭空下拉，回头填
    ctrl = document.createElement('select');
    fillOutdir(ctrl);
  } else {
    ctrl = document.createElement('input');
    ctrl.value = Array.isArray(value) ? value.join(',') : String(value ?? '');
    if (type === 'num') { ctrl.type = 'number'; ctrl.step = 'any'; }
    if (key === 'skillsLevel') ctrl.classList.add('wide');
    if (key === 'ignoreFriendship') ctrl.placeholder = '空 = 不忽略';
    if (key === 'chaldeaHome') { ctrl.placeholder = '例如 D:/Chaldea'; ctrl.classList.add('wide'); }
    if (key === 'bbRoot') { ctrl.placeholder = '例如 D:/BBchannel'; ctrl.classList.add('wide'); }
  }
  ctrl.className = 'ctrl';
  ctrl.dataset.key = key;
  ctrl.dataset.type = type;

  // 目录类设置：控件旁边统一放一个「选择」按钮，弹系统目录选择框
  const PATH_KEYS = ['chaldeaHome', 'bbRoot', 'outputDir'];
  if (PATH_KEYS.includes(key)) {
    ctrl.classList.add('wide');
    const wrap = document.createElement('div');
    wrap.className = 'pathpick';
    const btn = document.createElement('button');
    btn.className = 'mini';
    btn.textContent = '选择';
    btn.onclick = async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        const r = await window.apiPost('/api/pick-folder');
        if (r.ok && r.dir) {
          if (key === 'outputDir') {
            let customs = [];
            try { customs = JSON.parse(ctrl.dataset.customs || '[]'); } catch { customs = []; }
            const list = customs.includes(r.dir) ? customs : [...customs, r.dir];
            await window.apiPost('/api/settings', { settings: { outputDirs: list, outputDir: r.dir } });
            await fillOutdir(ctrl, r.dir);
          } else ctrl.value = r.dir;
          schedulePersist();
        }
      } finally { btn.disabled = false; }
    };
    wrap.appendChild(ctrl);
    wrap.appendChild(btn);

    // 输出目录额外给一个「删除」：把不需要的自定义目录从下拉里去掉
    if (key === 'outputDir') {
      const del = document.createElement('button');
      del.className = 'mini';
      del.textContent = '删除';
      del.title = '从下拉里移除这个自定义目录';
      // 只要「不是内置项、也不是默认」，就算自定义，可以删（不依赖历史列表，老配置里的值也算）
      const sync = () => {
        let builtins = [];
        try { builtins = JSON.parse(ctrl.dataset.builtins || '[]'); } catch { builtins = []; }
        const v = ctrl.value;
        const isCustom = !!v && !builtins.includes(v);
        del.disabled = !isCustom;
        del.style.opacity = isCustom ? '1' : '.45';
        del.title = isCustom ? '从下拉里移除 ' + v : '当前不是自定义目录（默认项和 BBchannel 的 settings 不能删）';
      };
      ctrl.oncustomchange = sync;
      for (const ev of ['change', 'click', 'focus', 'keyup']) ctrl.addEventListener(ev, sync);
      del.onclick = async (e) => {
        e.preventDefault();
        if (del.disabled) return;
        del.disabled = true;
        await window.apiPost('/api/outdir/remove', { path: ctrl.value });
        await fillOutdir(ctrl);
        schedulePersist();
      };
      sync();
      wrap.appendChild(del);
    }
    return wrap;
  }
  return ctrl;
}

function buildSettings(settings = {}) {
  const box = $('settingsGrid');
  box.innerHTML = '';
  for (const group of SETTINGS_GROUPS) {
    const sec = document.createElement('section');
    sec.className = 'group';
    const h = document.createElement('h3');
    h.textContent = group.title;
    sec.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'grid2';
    for (const [key, label, type, options] of group.items) {
      const field = document.createElement('div');
      field.className = 'field';
      const span = document.createElement('span');
      span.textContent = label;
      field.appendChild(span);
      const value = settings[key] !== undefined && settings[key] !== null ? settings[key] : DEFAULT_SETTINGS[key];
      field.appendChild(makeControl(key, type, options, value));
      grid.appendChild(field);
    }
    sec.appendChild(grid);
    box.appendChild(sec);
  }
}

async function loadSettings() {
  const r = await window.apiGet('/api/settings');
  buildSettings(r.settings || {});
}

function collectSettings() {
  const settings = {};
  document.querySelectorAll('[data-key]').forEach(el => {
    if (el.dataset.type === 'levels') {
      settings[el.dataset.key] = [...el.querySelectorAll('input')].map(i => Number(i.value) || 0);
      return;
    }
    const v = el.value;
    if (v === '' && el.dataset.key !== 'outputDir') return;
    const type = el.dataset.type;
    if (type === 'num' || type === 'bool') settings[el.dataset.key] = Number(v);
    else if (type === 'list') settings[el.dataset.key] = v.split(',').map(x => Number(x.trim())).filter(n => !Number.isNaN(n));
    else if (el.dataset.key === 'skillsLevel') settings[el.dataset.key] = v.split(',').map(x => Number(x.trim())).filter(n => !Number.isNaN(n));
    else settings[el.dataset.key] = v;
  });
  return settings;
}

let persistTimer = null;

async function persistSettings(showLabel) {
  clearTimeout(persistTimer);
  persistTimer = null;
  const settings = collectSettings();
  const r = await post('/api/settings', { settings });
  if (showLabel) {
    $('saveSettings').textContent = r.ok ? '已保存' : '保存失败';
    setTimeout(() => { $('saveSettings').textContent = '保存设置'; }, 1200);
  }
}

// 面板里任何改动都立刻落盘（防抖 400ms）——不用记得点保存，也不会重启后回到初始值
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persistSettings(false), 400);
}

$('settingsGrid').addEventListener('change', schedulePersist);
$('settingsGrid').addEventListener('input', schedulePersist);
$('saveSettings').onclick = () => persistSettings(true);

loadSettings();
/* 使用指引 */
const guideDialog = $('guideDialog');
$('guideBtn').onclick = () => guideDialog.classList.add('show');
$('guideClose').onclick = () => guideDialog.classList.remove('show');
guideDialog.addEventListener('click', (e) => { if (e.target.id === 'guideDialog') guideDialog.classList.remove('show'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') guideDialog.classList.remove('show'); });
if (location.search.includes('guide=1')) guideDialog.classList.add('show');

// 方便截图/调试：地址后加 ?settings=1 直接展开设置面板
if (location.search.includes('settings=1')) document.querySelector('details.panel')?.setAttribute('open', '');
