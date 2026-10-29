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
    $('confirmDialog').classList.add('show');
  });
}
function closeConfirm(v) {
  $('confirmDialog').classList.remove('show');
  const r = confirmResolve; confirmResolve = null;
  if (r) r(v);
}
$('confirmOk').onclick = () => closeConfirm({
  decide: true,
  injectTurns: Array.from(document.querySelectorAll('#turnList input:checked')).map((i) => i.value),
  shuffleRetries: Math.max(0, parseInt($('shuffleInput').value, 10) || 0),
});
$('confirmCancel').onclick = () => closeConfirm(null);
$('confirmDialog').addEventListener('click', (e) => { if (e.target.id === 'confirmDialog') closeConfirm(null); });

async function convertCall(url, body) {
  const res = await window.apiPost(url, body);
  if (res.ok && res.needsConfirm) {
    const plan = res.plan || {};
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
  const r = await window.apiGet('/api/folders');
  if (r.dirs?.length && !$('dir').value.trim()) $('dir').value = r.dirs[0];
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

  // 目录类设置：输入框旁边给个「选择」按钮，弹系统目录选择框
  if (key === 'chaldeaHome' || key === 'bbRoot') {
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
        if (r.ok && r.dir) ctrl.value = r.dir;
      } finally { btn.disabled = false; }
    };
    wrap.appendChild(ctrl);
    wrap.appendChild(btn);
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

$('saveSettings').onclick = async () => {
  const settings = {};
  document.querySelectorAll('[data-key]').forEach(el => {
    if (el.dataset.type === 'levels') {
      settings[el.dataset.key] = [...el.querySelectorAll('input')].map(i => Number(i.value) || 0);
      return;
    }
    const v = el.value;
    if (v === '') return;
    const type = el.dataset.type;
    if (type === 'num' || type === 'bool') settings[el.dataset.key] = Number(v);
    else if (type === 'list') settings[el.dataset.key] = v.split(',').map(x => Number(x.trim())).filter(n => !Number.isNaN(n));
    else if (el.dataset.key === 'skillsLevel') settings[el.dataset.key] = v.split(',').map(x => Number(x.trim())).filter(n => !Number.isNaN(n));
    else settings[el.dataset.key] = v;
  });
  const r = await post('/api/settings', { settings });
  $('saveSettings').textContent = r.ok ? '已保存' : '保存失败';
  setTimeout(() => { $('saveSettings').textContent = '保存设置'; }, 1200);
};

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
