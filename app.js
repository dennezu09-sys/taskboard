// =============================================================
// やることボード  app.js
// =============================================================
const SUPABASE_URL = "https://babosttjcgawzbyhldzs.supabase.co";
const SUPABASE_KEY = "sb_publishable_WAX0T7d8WdWnospz-AE8Lw_86nnaUJl";
const DEMO = new URLSearchParams(location.search).has("demo");
const REFRESH_MS = 3 * 60 * 1000;

const STAGES = ["アイデア", "設計", "実装中", "テスト", "運用中"];
const CATS = { dev: "開発", game: "ゲーム", work: "仕事", life: "生活" };
const AIS = ["Claude", "ChatGPT", "両方", "その他"];
const W = "日月火水木金土";
const SUB_STATES = ["未着手", "作業中", "完了"];

// ---------- small helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("tb:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("tb:" + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 864e5);
const todayStr = () => ymd(new Date());
const md = s => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const mdTs = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };
const daysSince = ts => diffDays(todayStr(), ymd(new Date(ts)));
const isUrl = u => /^https?:\/\//i.test(u || "");

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// =============================================================
// データの読み書き（Supabase / デモ用メモリ）
// =============================================================
function supabaseApi(sb) {
  const apply = (q, o) => {
    for (const [k, v] of Object.entries(o.eq || {})) q = q.eq(k, v);
    for (const [k, v] of Object.entries(o.gte || {})) q = q.gte(k, v);
    if (o.or) q = q.or(o.or);
    return q;
  };
  return {
    async list(t, o = {}) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        let q = apply(sb.from(t).select("*"), o).order(o.order || "created_at", { ascending: true }).range(from, from + 999);
        const { data, error } = await q;
        if (error) throw error;
        out.push(...data);
        if (data.length < 1000) return out;
      }
    },
    async insert(t, row) { const { data, error } = await sb.from(t).insert(row).select().single(); if (error) throw error; return data; },
    async update(t, id, patch) { const { data, error } = await sb.from(t).update(patch).eq("id", id).select().single(); if (error) throw error; return data; },
    async remove(t, id) { const { error } = await sb.from(t).delete().eq("id", id); if (error) throw error; },
    async removeWhere(t, m) { let q = sb.from(t).delete(); for (const [k, v] of Object.entries(m)) q = q.eq(k, v); const { error } = await q; if (error) throw error; },
  };
}

function memoryApi(seed) {
  const db = seed;
  const now = () => new Date().toISOString();
  return {
    async list(t, o = {}) {
      return db[t].filter(r =>
        Object.entries(o.eq || {}).every(([k, v]) => r[k] === v) &&
        Object.entries(o.gte || {}).every(([k, v]) => r[k] >= v) &&
        (!o.memFilter || o.memFilter(r))
      ).map(r => structuredClone(r));
    },
    async insert(t, row) { const r = { id: crypto.randomUUID(), created_at: now(), updated_at: now(), ...row }; db[t].push(r); return structuredClone(r); },
    async update(t, id, patch) { const r = db[t].find(x => x.id === id); Object.assign(r, patch, { updated_at: now() }); return structuredClone(r); },
    async remove(t, id) {
      db[t] = db[t].filter(x => x.id !== id);
      if (t === "projects") { db.subtasks = db.subtasks.filter(x => x.project_id !== id); db.project_logs = db.project_logs.filter(x => x.project_id !== id); }
      if (t === "routines") db.routine_logs = db.routine_logs.filter(x => x.routine_id !== id);
    },
    async removeWhere(t, m) { db[t] = db[t].filter(r => !Object.entries(m).every(([k, v]) => r[k] === v)); },
  };
}

function demoSeed() {
  const ago = d => new Date(Date.now() - d * 864e5).toISOString();
  const t = todayStr();
  const P = (id, name, stage, status, ai, next, upd, links = []) => ({ id, name, stage, status, ai, next_action: next, links, closed_at: status === "done" || status === "cancel" ? ago(upd) : null, created_at: ago(upd + 10), updated_at: ago(upd) });
  const projects = [
    P("p1", "タスク管理アプリ", 2, "active", "Claude", "", 0, [{ label: "チャット", url: "https://claude.ai" }]),
    P("p2", "家計簿ダッシュボード", 2, "active", "Claude", "", 3, [{ label: "公開URL", url: "https://example.com" }]),
    P("p3", "ゲーム周回メモ", 2, "active", "ChatGPT", "保存ボタンの動作を直す", 21),
    P("p4", "旅行しおりジェネレーター", 4, "active", "両方", "使いながら改善", 12),
    P("p5", "読書記録アプリ", 1, "hold", "ChatGPT", "再開するか決める", 40),
    P("p6", "壁紙ジェネレーター", 4, "done", "Claude", "", 30),
  ];
  let pos = 0;
  const S = (project_id, title, state) => ({ id: crypto.randomUUID(), project_id, title, state, position: pos++, created_at: ago(5), updated_at: ago(1) });
  const subtasks = [
    S("p1", "画面モック作成", 2), S("p1", "Supabase準備", 2), S("p1", "アプリ本体", 1), S("p1", "GitHubで公開", 0), S("p1", "MCP連携", 0),
    S("p2", "グラフ表示", 2), S("p2", "CSV読み込み", 1), S("p2", "月別の集計", 0),
  ];
  const project_logs = [
    { id: "l1", project_id: "p1", body: "アプリ本体の作成開始", created_at: ago(0) },
    { id: "l2", project_id: "p6", body: "完了：v1で十分", created_at: ago(30) },
  ];
  const R = (id, title, category, repeat_type, extra = {}) => ({ id, title, category, repeat_type, weekdays: null, month_day: null, interval_days: null, reset_time: "04:00:00", url: null, position: 0, archived: false, created_at: ago(60), updated_at: ago(60), ...extra });
  const routines = [
    R("r1", "ゲームA デイリー", "game", "daily", { url: "https://example.com" }),
    R("r2", "ゲームB デイリー", "game", "daily", { reset_time: "05:00:00" }),
    R("r3", "ゲームB 週間ミッション", "game", "weekly", { weekdays: [1], reset_time: "05:00:00" }),
    R("r4", "ニュースサイト確認", "life", "weekdays", { reset_time: "00:00:00", url: "https://example.com" }),
    R("r5", "エアコンのフィルター掃除", "life", "after_days", { interval_days: 14, reset_time: "00:00:00" }),
  ];
  const routine_logs = [];
  const r1 = routines[0];
  for (let i = 1; i <= 12; i++) routine_logs.push({ id: crypto.randomUUID(), routine_id: "r1", period_date: addDays(currentPeriod(r1), -i), kind: i === 5 ? "skip" : "done", created_at: ago(i) });
  routine_logs.push({ id: crypto.randomUUID(), routine_id: "r5", period_date: addDays(t, -16), kind: "done", created_at: ago(16) });
  const T = (title, category, due) => ({ id: crypto.randomUUID(), title, category, due_date: due == null ? null : addDays(t, due), done_at: null, position: 0, created_at: ago(2), updated_at: ago(2) });
  const tasks = [T("見積書の最終確認", "work", -1), T("ドメインの更新手続き", "dev", 0), T("PCのバックアップ", "life", 2), T("読みたい記事をまとめる", "life", null)];
  return { projects, subtasks, project_logs, routines, routine_logs, tasks };
}

// =============================================================
// 定期タスクの日付計算
// =============================================================
const resetMin = r => { const [h, m] = String(r.reset_time || "00:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const shiftedToday = r => ymd(new Date(Date.now() - resetMin(r) * 60000));
const resetDay = r => (r.weekdays && r.weekdays.length ? r.weekdays[0] : 1);

function scheduledOn(r, s) {
  const w = parseYmd(s).getDay();
  if (r.repeat_type === "weekdays") return w >= 1 && w <= 5;
  if (r.repeat_type === "daily") return !r.weekdays || !r.weekdays.length || r.weekdays.includes(w);
  return true;
}
function monthStart(r, s) {
  const want = r.month_day || 1, d = parseYmd(s);
  const clamp = (y, m) => Math.min(want, new Date(y, m + 1, 0).getDate());
  let y = d.getFullYear(), m = d.getMonth();
  if (d.getDate() < clamp(y, m)) { m--; if (m < 0) { m = 11; y--; } }
  return ymd(new Date(y, m, clamp(y, m)));
}
function currentPeriod(r) {
  const s = shiftedToday(r);
  if (r.repeat_type === "weekly") return addDays(s, -((parseYmd(s).getDay() - resetDay(r) + 7) % 7));
  if (r.repeat_type === "monthly") return monthStart(r, s);
  return s;
}
function prevPeriod(r, p) {
  if (r.repeat_type === "weekly") return addDays(p, -7);
  if (r.repeat_type === "monthly") return monthStart(r, addDays(p, -1));
  if (r.repeat_type === "after_days") return null;
  let q = p;
  for (let i = 0; i < 8; i++) { q = addDays(q, -1); if (scheduledOn(r, q)) return q; }
  return null;
}
function ruleLabel(r) {
  const t = String(r.reset_time || "00:00").slice(0, 5).replace(/^0(\d)/, "$1");
  switch (r.repeat_type) {
    case "daily": return (r.weekdays && r.weekdays.length ? r.weekdays.slice().sort().map(i => W[i]).join("・") : "毎日") + `・${t} リセット`;
    case "weekdays": return `平日・${t} リセット`;
    case "weekly": return `毎週・${W[resetDay(r)]} ${t} リセット`;
    case "monthly": return `毎月${r.month_day || 1}日・${t} リセット`;
    case "after_days": return `完了から${r.interval_days || 1}日ごと`;
  }
  return "";
}
function routineInfo(r) {
  const L = state.logMap.get(r.id) || new Map();
  const cur = currentPeriod(r);
  const mark = L.get(cur) || null;
  let due, extra = "";
  if (r.repeat_type === "after_days") {
    const last = [...L.entries()].filter(([d, k]) => k === "done" && d !== cur).map(([d]) => d).sort().at(-1);
    const n = r.interval_days || 1;
    due = !!mark || !last || diffDays(cur, last) >= n;
    extra = last ? (due ? `前回 ${diffDays(cur, last)}日前` : `次回 ${md(addDays(last, n))}`) : "";
  } else {
    due = (r.repeat_type === "daily" || r.repeat_type === "weekdays") ? scheduledOn(r, cur) : true;
  }
  let streak = null;
  if (r.repeat_type !== "after_days") {
    let p = mark ? cur : prevPeriod(r, cur), n = 0, guard = 0;
    while (p && L.has(p) && guard++ < 1000) { if (L.get(p) === "done") n++; p = prevPeriod(r, p); }
    streak = n;
  }
  return { cur, mark, due, streak, extra };
}

// =============================================================
// 状態
// =============================================================
let api = null, sb = null, userEmail = "";
const state = {
  projects: [], subtasks: [], routines: [], routineLogs: [], tasks: [],
  logMap: new Map(),
  filter: store.get("filter", "進行中"),
  folded: store.get("fold", {}),
  showOff: false, showDone: false,
};
function rebuildLogMap() {
  state.logMap = new Map();
  for (const l of state.routineLogs) {
    if (!state.logMap.has(l.routine_id)) state.logMap.set(l.routine_id, new Map());
    state.logMap.get(l.routine_id).set(l.period_date, l.kind);
  }
}
async function loadAll() {
  const since = addDays(todayStr(), -400);
  const doneSince = new Date(Date.now() - 3 * 864e5).toISOString();
  const [projects, subtasks, routines, routineLogs, tasks] = await Promise.all([
    api.list("projects"),
    api.list("subtasks", { order: "position" }),
    api.list("routines", { eq: { archived: false }, order: "position" }),
    api.list("routine_logs", { gte: { period_date: since }, order: "period_date" }),
    api.list("tasks", { or: `done_at.is.null,done_at.gte."${doneSince}"`, memFilter: r => !r.done_at || r.done_at >= doneSince }),
  ]);
  Object.assign(state, { projects, subtasks, routines, routineLogs, tasks });
  rebuildLogMap();
}
async function run(fn) {
  try { await fn(); }
  catch (e) {
    console.error(e);
    toast("保存できませんでした：" + (e.message || e) + "（再読み込みします）");
    try { await loadAll(); } catch { /* ignore */ }
  }
  render();
}

// =============================================================
// 画面：ログイン
// =============================================================
function renderLogin(msg = "") {
  $("#app").innerHTML = `
    <form class="login" id="loginForm">
      <h1>やることボード</h1>
      <div class="meta">Supabaseで作ったアカウントでログインします</div>
      <label for="em">メールアドレス</label><input id="em" type="email" autocomplete="username" required>
      <label for="pw">パスワード</label><input id="pw" type="password" autocomplete="current-password" required>
      <button type="submit">ログイン</button>
      <div class="err" id="err">${esc(msg)}</div>
    </form>`;
  $("#loginForm").onsubmit = async e => {
    e.preventDefault();
    $("#err").textContent = "ログイン中…";
    const { error } = await sb.auth.signInWithPassword({ email: $("#em").value.trim(), password: $("#pw").value });
    if (error) $("#err").textContent = /invalid/i.test(error.message) ? "メールアドレスかパスワードが違います" : "ログインできませんでした：" + error.message;
  };
}

// =============================================================
// 画面：メイン
// =============================================================
function renderShell() {
  const now = new Date();
  $("#app").innerHTML = `
    ${DEMO ? '<div class="demo-banner">デモモード：保存されません。再読み込みで元に戻ります</div>' : ""}
    <header>
      <h1>やることボード</h1>
      <span class="date">${now.getMonth() + 1}月${now.getDate()}日（${W[now.getDay()]}）</span>
      <span class="spacer"></span>
      <button class="add" data-act="add">＋ 追加</button>
      <button class="menu-btn" data-act="menu" aria-label="メニュー">⋯</button>
    </header>
    <div class="menu" id="menu" hidden>
      <div class="who">${DEMO ? "デモモード" : esc(userEmail)}</div>
      <button data-act="reload">最新の状態に更新</button>
      <button data-act="export">バックアップを書き出す</button>
      ${DEMO ? "" : '<button data-act="logout">ログアウト</button>'}
    </div>
    <main>
      <div class="col">
        <section id="sec-daily"><h2><button class="fold" data-fold="sec-daily"><span class="arw">▼</span>今日の定期タスク</button><span class="count" id="dailyCount"></span></h2>
          <div class="body"><div class="bar"><i id="dailyBar"></i></div><div id="dailyList"></div></div></section>
        <section id="sec-task"><h2><button class="fold" data-fold="sec-task"><span class="arw">▼</span>単発タスク</button><span class="count" id="taskCount"></span></h2>
          <div class="body"><div id="taskList"></div></div></section>
      </div>
      <div class="col">
        <section id="sec-proj"><h2><button class="fold" data-fold="sec-proj"><span class="arw">▼</span>プロジェクト</button><span class="count" id="projCount"></span></h2>
          <div class="body"><div class="filters" id="projFilters"></div><div id="projList"></div></div></section>
      </div>
    </main>`;
  for (const id of Object.keys(state.folded)) if (state.folded[id]) $("#" + id)?.classList.add("folded");
}
function render() {
  if (!$("#sec-daily")) renderShell();
  renderDailies(); renderTasks(); renderProjects();
}

const dot = c => `<span class="dot" style="background:var(--c-${CATS[c] ? c : "life"})" title="${esc(CATS[c] || c)}"></span>`;

function renderDailies() {
  const items = state.routines.map(r => ({ r, i: routineInfo(r) }));
  const due = items.filter(x => x.i.due).sort((a, b) => (!!a.i.mark - !!b.i.mark) || (a.r.position - b.r.position));
  const off = items.filter(x => !x.i.due);
  const n = due.filter(x => x.i.mark).length;
  $("#dailyCount").textContent = due.length ? `${n} / ${due.length} 完了` : "";
  $("#dailyBar").style.width = due.length ? (n / due.length * 100) + "%" : "0";
  const row = ({ r, i }) => `
    <div class="row ${i.mark ? "done" : ""}">
      <button class="chk ${i.mark === "done" ? "on" : i.mark === "skip" ? "skip" : ""}" data-act="r-toggle" data-id="${r.id}" aria-label="完了"></button>
      ${dot(r.category)}
      <button class="title" data-act="r-edit" data-id="${r.id}"><div class="title-t">${esc(r.title)}</div><div class="meta">${esc(ruleLabel(r))}${i.extra ? "・" + esc(i.extra) : ""}</div></button>
      ${i.streak ? `<span class="streak" title="連続達成">🔥${i.streak}</span>` : ""}
      ${isUrl(r.url) ? `<button class="icon-btn" data-act="r-open" data-id="${r.id}"><span class="l">開く</span><span class="s">↗</span></button>` : ""}
      ${i.mark || !i.due ? "" : `<button class="icon-btn" data-act="r-skip" data-id="${r.id}" title="今回はやらない（連続記録は切れません）"><span class="l">スキップ</span><span class="s">休</span></button>`}
    </div>`;
  $("#dailyList").innerHTML =
    `<div class="list">${due.map(row).join("") || '<div class="empty">今日の定期タスクはありません。「＋ 追加」から登録できます</div>'}</div>` +
    (off.length ? `<button class="group-label" data-act="toggle-off">${state.showOff ? "▼" : "▶"} 今日は対象外 ${off.length}件</button>
      ${state.showOff ? `<div class="list">${off.map(row).join("")}</div>` : ""}` : "");
}

function dueTag(t) {
  if (!t.due_date) return `<span class="tag plain">期限なし</span>`;
  const d = diffDays(t.due_date, todayStr());
  if (d < 0) return `<span class="tag warn">${-d}日超過</span>`;
  if (d === 0) return `<span class="tag today">今日まで</span>`;
  if (d === 1) return `<span class="tag plain">明日まで</span>`;
  return `<span class="tag plain">${md(t.due_date)}まで</span>`;
}
function renderTasks() {
  const open = state.tasks.filter(t => !t.done_at).sort((a, b) =>
    (a.due_date || "9999") < (b.due_date || "9999") ? -1 : (a.due_date || "9999") > (b.due_date || "9999") ? 1 : a.created_at < b.created_at ? -1 : 1);
  const done = state.tasks.filter(t => t.done_at).sort((a, b) => a.done_at < b.done_at ? 1 : -1);
  $("#taskCount").textContent = `残り ${open.length}`;
  const row = t => {
    const later = t.due_date && diffDays(t.due_date, todayStr()) >= 1;
    return `<div class="row ${t.done_at ? "done" : ""}">
      <button class="chk ${t.done_at ? "on" : ""}" data-act="t-toggle" data-id="${t.id}" aria-label="完了"></button>
      ${dot(t.category)}<button class="title" data-act="t-edit" data-id="${t.id}"><span class="title-t">${esc(t.title)}</span></button>
      ${t.done_at ? "" : dueTag(t)}
      ${t.done_at ? "" : `<button class="icon-btn" data-act="t-post" data-id="${t.id}" title="1日先送り"><span class="l">${later ? "+1日" : "明日へ"}</span><span class="s">→</span></button>`}
    </div>`;
  };
  $("#taskList").innerHTML = `<div class="list">${open.map(row).join("") || '<div class="empty">単発タスクはありません</div>'}</div>` +
    (done.length ? `<button class="group-label" data-act="toggle-done">${state.showDone ? "▼" : "▶"} 最近の完了 ${done.length}件</button>${state.showDone ? `<div class="list">${done.map(row).join("")}</div>` : ""}` : "");
}

const subsOf = pid => state.subtasks.filter(s => s.project_id === pid).sort((a, b) => a.position - b.position || (a.created_at < b.created_at ? -1 : 1));
function nextOf(p) {
  const subs = subsOf(p.id);
  const doing = subs.find(s => s.state === 1);
  if (doing) return { t: doing.title, auto: true };
  if (p.next_action) return { t: p.next_action, auto: false };
  const todo = subs.find(s => s.state === 0);
  return { t: todo ? todo.title : "未設定", auto: false };
}
function stageTag(p) {
  if (p.status === "hold") return `<span class="stage hold">保留</span>`;
  if (p.status === "done") return `<span class="stage done">完了</span>`;
  if (p.status === "cancel") return `<span class="stage hold">中止</span>`;
  return `<span class="stage ${p.stage === 4 ? "live" : ""}">${STAGES[p.stage]}</span>`;
}
const FILTERS = {
  "進行中": p => p.status === "active" && p.stage < 4,
  "運用中": p => p.status === "active" && p.stage === 4,
  "保留": p => p.status === "hold",
  "完了": p => p.status === "done" || p.status === "cancel",
};
function renderProjects() {
  if (!FILTERS[state.filter]) state.filter = "進行中";
  $("#projFilters").innerHTML = Object.keys(FILTERS).map(f =>
    `<button class="${state.filter === f ? "on" : ""}" data-act="filter" data-f="${f}">${f} ${state.projects.filter(FILTERS[f]).length}</button>`).join("");
  const L = state.projects.filter(FILTERS[state.filter]).sort((a, b) => a.updated_at < b.updated_at ? 1 : -1);
  $("#projCount").textContent = `進行中 ${state.projects.filter(FILTERS["進行中"]).length}件`;
  $("#projList").innerHTML = L.map(p => {
    const idle = daysSince(p.updated_at), closed = p.status === "done" || p.status === "cancel";
    const idleTag = (p.status === "active" && p.stage < 4 && idle >= 14) ? `<span class="tag warn">${idle}日放置</span>` : "";
    const subs = subsOf(p.id), nd = subs.filter(s => s.state === 2).length, nx = nextOf(p);
    return `<button class="proj ${p.status === "cancel" ? "cancel" : ""}" data-act="p-open" data-id="${p.id}">
      <div class="top"><span class="name">${esc(p.name)}</span>${idleTag}${stageTag(p)}</div>
      ${closed ? "" : `<div class="steps">${STAGES.map((s, i) => `<i class="${p.stage >= i ? "on" : ""}"></i>`).join("")}</div>
        ${subs.length ? `<div class="subprog"><span>子タスク ${nd}/${subs.length}</span><div class="bar"><i style="width:${nd / subs.length * 100}%"></i></div></div>` : ""}
        <div class="next"><b>次にやること</b>${esc(nx.t)}${nx.auto ? '<span class="doing">作業中</span>' : ""}</div>`}
      <div class="foot">${p.ai ? `<span>AI：${esc(p.ai)}</span>` : ""}<span>${closed ? (p.status === "done" ? "完了日：" : "中止日：") + mdTs(p.closed_at || p.updated_at) : "更新：" + (idle === 0 ? "今日" : idle + "日前")}</span>${(p.links || []).length ? `<span>リンク ${p.links.length}</span>` : ""}</div>
    </button>`;
  }).join("") || `<div class="empty">該当するプロジェクトはありません</div>`;
}

// =============================================================
// モーダル
// =============================================================
const back = $("#back"), modal = $("#modal");
let onModalClose = null;
function openModal(html) { modal.innerHTML = html; back.classList.add("show"); }
function closeModal() { back.classList.remove("show"); modal.innerHTML = ""; const f = onModalClose; onModalClose = null; if (f) f(); }
back.addEventListener("click", e => { if (e.target === back) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && back.classList.contains("show")) closeModal(); });

const catOptions = sel => Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");
const val = id => ($("#" + id, modal)?.value ?? "").trim();
function segHandler(sel, cb) {
  $$(sel + " button", modal).forEach(b => b.onclick = () => {
    $$(sel + " button", modal).forEach(x => x.classList.toggle("on", x === b)); cb(b.dataset.v);
  });
}
function confirmDelete(btn, fn) {
  btn.onclick = () => {
    if (btn.dataset.armed) return fn();
    btn.dataset.armed = "1"; btn.textContent = "本当に削除する";
  };
}

// ---------- 単発タスク ----------
function taskForm(t = {}) {
  return `<label>タイトル</label><input id="f_title" value="${esc(t.title || "")}" placeholder="例：請求書を送る">
    <label>カテゴリ</label><select id="f_cat">${catOptions(t.category || "life")}</select>
    <label>期限</label><input id="f_due" type="date" value="${esc(t.due_date || "")}">
    <div class="seg" style="margin-top:6px">
      <button type="button" data-due="0">今日</button><button type="button" data-due="1">明日</button>
      <button type="button" data-due="7">1週間後</button><button type="button" data-due="">なし</button></div>`;
}
function bindTaskForm() {
  $$("[data-due]", modal).forEach(b => b.onclick = () => { $("#f_due", modal).value = b.dataset.due === "" ? "" : addDays(todayStr(), +b.dataset.due); });
}
const taskData = () => ({ title: val("f_title"), category: val("f_cat"), due_date: val("f_due") || null });

function editTask(id) {
  const t = state.tasks.find(x => x.id === id);
  openModal(`<h3>単発タスク</h3>${taskForm(t)}
    <div class="actions"><button class="danger" id="del">削除</button><button id="cancel">キャンセル</button><button class="primary" id="save">保存</button></div>`);
  bindTaskForm();
  $("#cancel", modal).onclick = closeModal;
  confirmDelete($("#del", modal), () => { closeModal(); run(async () => { await api.remove("tasks", id); state.tasks = state.tasks.filter(x => x.id !== id); }); });
  $("#save", modal).onclick = () => {
    const d = taskData(); if (!d.title) return toast("タイトルを入力してください");
    closeModal(); run(async () => Object.assign(t, await api.update("tasks", id, d)));
  };
}

// ---------- 定期タスク ----------
function routineForm(r = {}) {
  const rt = r.repeat_type || "daily";
  const wd = r.weekdays || [];
  return `<label>タイトル</label><input id="f_title" value="${esc(r.title || "")}" placeholder="例：ゲームC デイリー">
    <label>カテゴリ</label><select id="f_cat">${catOptions(r.category || "game")}</select>
    <label>繰り返し</label>
    <select id="f_rt">
      <option value="daily" ${rt === "daily" ? "selected" : ""}>毎日（曜日の指定も可）</option>
      <option value="weekdays" ${rt === "weekdays" ? "selected" : ""}>平日（月〜金）</option>
      <option value="weekly" ${rt === "weekly" ? "selected" : ""}>毎週1回（ウィークリー）</option>
      <option value="monthly" ${rt === "monthly" ? "selected" : ""}>毎月1回</option>
      <option value="after_days" ${rt === "after_days" ? "selected" : ""}>完了から◯日ごと</option>
    </select>
    <div id="opt_wd"><label id="wdLabel"></label><div class="wd" id="f_wd">${[1, 2, 3, 4, 5, 6, 0].map(i => `<button type="button" data-v="${i}" class="${wd.includes(i) ? "on" : ""}">${W[i]}</button>`).join("")}</div><div class="hint" id="wdHint"></div></div>
    <div id="opt_md"><label>リセット日（毎月◯日）</label><input id="f_md" type="number" min="1" max="31" value="${r.month_day || 1}"></div>
    <div id="opt_iv"><label>間隔（日）</label><input id="f_iv" type="number" min="1" value="${r.interval_days || 7}"></div>
    <div id="opt_rt"><label>リセット時刻（この時刻で日付が切り替わります）</label><input id="f_reset" type="time" value="${String(r.reset_time || "04:00").slice(0, 5)}"></div>
    <label>開くURL（任意）</label><input id="f_url" type="url" value="${esc(r.url || "")}" placeholder="https://">`;
}
function bindRoutineForm() {
  const sync = () => {
    const rt = val("f_rt");
    $("#opt_wd", modal).hidden = !(rt === "daily" || rt === "weekly");
    $("#opt_md", modal).hidden = rt !== "monthly";
    $("#opt_iv", modal).hidden = rt !== "after_days";
    $("#opt_rt", modal).hidden = rt === "after_days";
    $("#wdLabel", modal).textContent = rt === "weekly" ? "リセットする曜日（1つ）" : "曜日の指定（選ばなければ毎日）";
    $("#wdHint", modal).textContent = rt === "weekly" ? "例：月曜5時リセットのウィークリーなら「月」を選びます" : "";
    if (rt === "weekly") {
      const on = $$("#f_wd button.on", modal);
      on.slice(1).forEach(b => b.classList.remove("on"));
      if (!on.length) $('#f_wd button[data-v="1"]', modal).classList.add("on");
    }
  };
  $$("#f_wd button", modal).forEach(b => b.onclick = () => {
    if (val("f_rt") === "weekly") $$("#f_wd button", modal).forEach(x => x.classList.toggle("on", x === b));
    else b.classList.toggle("on");
  });
  $("#f_rt", modal).onchange = sync; sync();
}
function routineData() {
  const rt = val("f_rt");
  const wd = $$("#f_wd button.on", modal).map(b => +b.dataset.v);
  const url = val("f_url");
  return {
    title: val("f_title"), category: val("f_cat"), repeat_type: rt,
    weekdays: (rt === "daily" || rt === "weekly") && wd.length ? wd : null,
    month_day: rt === "monthly" ? Math.min(31, Math.max(1, +val("f_md") || 1)) : null,
    interval_days: rt === "after_days" ? Math.max(1, +val("f_iv") || 1) : null,
    reset_time: rt === "after_days" ? "00:00" : (val("f_reset") || "00:00"),
    url: url ? (isUrl(url) ? url : "https://" + url) : null,
  };
}
function editRoutine(id) {
  const r = state.routines.find(x => x.id === id);
  openModal(`<h3>定期タスク</h3>${routineForm(r)}
    <div class="actions"><button class="danger" id="del">削除</button><button id="cancel">キャンセル</button><button class="primary" id="save">保存</button></div>`);
  bindRoutineForm();
  $("#cancel", modal).onclick = closeModal;
  confirmDelete($("#del", modal), () => { closeModal(); run(async () => { await api.remove("routines", id); state.routines = state.routines.filter(x => x.id !== id); }); });
  $("#save", modal).onclick = () => {
    const d = routineData(); if (!d.title) return toast("タイトルを入力してください");
    closeModal(); run(async () => Object.assign(r, await api.update("routines", id, d)));
  };
}
async function markRoutine(r, kind) {
  const cur = currentPeriod(r);
  const row = await api.insert("routine_logs", { routine_id: r.id, period_date: cur, kind });
  state.routineLogs.push(row); rebuildLogMap();
}
async function unmarkRoutine(r) {
  const cur = currentPeriod(r);
  await api.removeWhere("routine_logs", { routine_id: r.id, period_date: cur });
  state.routineLogs = state.routineLogs.filter(l => !(l.routine_id === r.id && l.period_date === cur)); rebuildLogMap();
}

// ---------- プロジェクト ----------
async function addLog(p, body) {
  const row = await api.insert("project_logs", { project_id: p.id, body });
  p.updated_at = row.created_at;
  return row;
}
async function openProject(id) {
  const p = state.projects.find(x => x.id === id);
  if (!p) return;
  let logs = [];
  try { logs = (await api.list("project_logs", { eq: { project_id: id } })).sort((a, b) => a.created_at < b.created_at ? 1 : -1); } catch (e) { console.error(e); }
  const closed = p.status === "done" || p.status === "cancel";
  let stage = p.stage;
  openModal(`<h3>${esc(p.name)} ${stageTag(p)}</h3>
    <div class="meta">${p.ai ? "AI：" + esc(p.ai) + "・" : ""}最終更新 ${mdTs(p.updated_at)}</div>
    ${closed ? "" : `
      <label>名前</label><input id="f_name" value="${esc(p.name)}">
      <label>段階</label><div class="seg" id="stageSeg">${STAGES.map((s, i) => `<button data-v="${i}" class="${p.stage === i ? "on" : ""}">${s}</button>`).join("")}</div>
      <label>使っているAI</label><select id="f_ai"><option value="">未設定</option>${AIS.map(a => `<option ${a === p.ai ? "selected" : ""}>${a}</option>`).join("")}</select>
      <label>子タスク <span id="subCount"></span></label><div id="subList"></div>
      <div class="inline"><input id="subIn" placeholder="子タスクを追加"><button id="subAdd">追加</button></div>
      <label>次にやること <span class="meta">（作業中の子タスクがあればそちらを優先表示）</span></label>
      <input id="f_next" value="${esc(p.next_action || "")}" placeholder="手入力するときはここ">`}
    <label>リンク</label><div id="linkList"></div>
    <div class="inline"><input id="lnLabel" placeholder="名前（例：チャット）" style="max-width:40%"><input id="lnUrl" placeholder="https://"><button id="lnAdd">追加</button></div>
    <label>経過メモ</label>
    <div class="inline" style="margin-bottom:8px"><input id="logIn" placeholder="メモを追加（例：ログイン画面まで完成）"><button id="logAdd">追加</button></div>
    <div class="log" id="logList"></div>
    <label>状態</label><div id="statusArea"></div>
    <div class="actions"><button class="danger" id="del">削除</button><button id="close">閉じる</button>${closed ? "" : '<button class="primary" id="save">保存</button>'}</div>`);
  onModalClose = render;

  const drawLogs = () => { $("#logList", modal).innerHTML = logs.map(l => `<div><span>${mdTs(l.created_at)}</span>${esc(l.body)}</div>`).join("") || '<div class="meta">まだありません</div>'; };
  const log = async body => { const row = await addLog(p, body); logs.unshift(row); drawLogs(); };
  const safe = fn => async (...a) => { try { await fn(...a); } catch (e) { console.error(e); toast("保存できませんでした：" + (e.message || e)); } };
  drawLogs();

  // links
  const drawLinks = () => {
    $("#linkList", modal).innerHTML = (p.links || []).map((l, i) => `<div class="linkrow"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)} ↗</a><button class="x" data-i="${i}" title="削除">×</button></div>`).join("") || '<div class="meta">なし</div>';
    $$("#linkList .x", modal).forEach(b => b.onclick = safe(async () => {
      const links = (p.links || []).filter((_, i) => i !== +b.dataset.i);
      Object.assign(p, await api.update("projects", p.id, { links })); drawLinks();
    }));
  };
  drawLinks();
  $("#lnAdd", modal).onclick = safe(async () => {
    let url = val("lnUrl"); if (!url) return toast("URLを入力してください");
    if (!isUrl(url)) url = "https://" + url;
    const links = [...(p.links || []), { label: val("lnLabel") || "リンク", url }];
    Object.assign(p, await api.update("projects", p.id, { links }));
    $("#lnUrl", modal).value = ""; $("#lnLabel", modal).value = ""; drawLinks();
  });

  $("#logAdd", modal).onclick = safe(async () => { const v = val("logIn"); if (!v) return; await log(v); $("#logIn", modal).value = ""; });
  $("#logIn", modal).onkeydown = e => { if (e.key === "Enter" && !e.isComposing) $("#logAdd", modal).click(); };

  // status
  const area = $("#statusArea", modal);
  const setStatus = safe(async (st, msg) => {
    const patch = { status: st, closed_at: st === "done" || st === "cancel" ? new Date().toISOString() : null };
    Object.assign(p, await api.update("projects", p.id, patch));
    await addLog(p, msg); closeModal();
  });
  const drawStatus = () => {
    area.innerHTML = p.status === "active"
      ? `<div class="status-btns"><button class="ok" data-st="done">完了にする</button><button data-st="hold">保留にする</button><button data-st="cancel">中止にする</button></div>`
      : `<div class="status-btns"><button data-st="active">再開する</button></div>`;
    $$("button", area).forEach(b => b.onclick = () => {
      const st = b.dataset.st;
      if (st === "active") return setStatus("active", "再開");
      if (st === "hold") return setStatus("hold", "保留にした");
      const word = st === "done" ? "完了" : "中止";
      area.innerHTML = `<input id="memoIn" placeholder="ひとことメモ（任意）">
        <div class="status-btns" style="margin-top:8px"><button id="stBack">戻る</button><button class="ok" id="stOk">${word}にする</button></div>`;
      $("#stBack", modal).onclick = drawStatus;
      $("#stOk", modal).onclick = () => { const m = val("memoIn"); setStatus(st, word + (m ? "：" + m : "")); };
    });
  };
  drawStatus();

  $("#close", modal).onclick = closeModal;
  confirmDelete($("#del", modal), safe(async () => {
    await api.remove("projects", p.id);
    state.projects = state.projects.filter(x => x.id !== p.id);
    state.subtasks = state.subtasks.filter(s => s.project_id !== p.id);
    closeModal();
  }));
  if (closed) return;

  // subtasks
  const drawSubs = () => {
    const L = subsOf(p.id);
    $("#subCount", modal).textContent = L.length ? `${L.filter(s => s.state === 2).length}/${L.length}` : "";
    $("#subList", modal).innerHTML = L.map(s => `<div class="sub s${s.state}">
        <button class="st s${s.state}" data-id="${s.id}" title="押すと状態が切り替わります">${SUB_STATES[s.state]}</button>
        <span class="t">${esc(s.title)}</span><button class="x" data-del="${s.id}" title="削除">×</button></div>`).join("")
      || '<div class="meta">なし（小さいプロジェクトは付けなくてOK）</div>';
    $$("#subList .st", modal).forEach(b => b.onclick = safe(async () => {
      const s = state.subtasks.find(x => x.id === b.dataset.id);
      Object.assign(s, await api.update("subtasks", s.id, { state: (s.state + 1) % 3 }));
      p.updated_at = new Date().toISOString();
      if (s.state === 2) await log(`子タスク完了：${s.title}`);
      drawSubs();
    }));
    $$("#subList .x", modal).forEach(b => b.onclick = safe(async () => {
      await api.remove("subtasks", b.dataset.del);
      state.subtasks = state.subtasks.filter(x => x.id !== b.dataset.del);
      p.updated_at = new Date().toISOString(); drawSubs();
    }));
  };
  drawSubs();
  const addSub = safe(async () => {
    const v = val("subIn"); if (!v) return;
    const L = subsOf(p.id);
    const row = await api.insert("subtasks", { project_id: p.id, title: v, state: 0, position: L.length ? Math.max(...L.map(s => s.position)) + 1 : 0 });
    state.subtasks.push(row); p.updated_at = new Date().toISOString();
    $("#subIn", modal).value = ""; drawSubs();
  });
  $("#subAdd", modal).onclick = addSub;
  $("#subIn", modal).onkeydown = e => { if (e.key === "Enter" && !e.isComposing) addSub(); };

  segHandler("#stageSeg", v => { stage = +v; });
  $("#save", modal).onclick = safe(async () => {
    const patch = { name: val("f_name") || p.name, next_action: val("f_next") || null, ai: val("f_ai") || null, stage };
    const msgs = [];
    if (stage !== p.stage) msgs.push(`段階を「${STAGES[stage]}」に変更`);
    if ((patch.next_action || "") !== (p.next_action || "") && patch.next_action) msgs.push(`次にやること：${patch.next_action}`);
    Object.assign(p, await api.update("projects", p.id, patch));
    for (const m of msgs) await addLog(p, m);
    closeModal();
  });
}

// ---------- 追加 ----------
function addForm(type = store.get("lastAdd", "task")) {
  const head = `<h3>追加</h3><label>種類</label>
    <div class="seg" id="typeSeg">
      <button data-v="task" class="${type === "task" ? "on" : ""}">単発タスク</button>
      <button data-v="routine" class="${type === "routine" ? "on" : ""}">定期タスク</button>
      <button data-v="project" class="${type === "project" ? "on" : ""}">プロジェクト</button></div>`;
  const body = type === "task" ? taskForm({ due_date: "" })
    : type === "routine" ? routineForm({})
    : `<label>名前</label><input id="f_title" placeholder="例：写真整理アプリ">
       <label>使っているAI</label><select id="f_ai">${AIS.map(a => `<option>${a}</option>`).join("")}</select>
       <label>段階</label><select id="f_stage">${STAGES.map((s, i) => `<option value="${i}">${s}</option>`).join("")}</select>
       <label>次にやること（任意）</label><input id="f_next" placeholder="例：作りたい機能を書き出す">`;
  openModal(head + body + `<div class="actions"><button id="cancel">キャンセル</button><button class="primary" id="save">追加</button></div>`);
  $$("#typeSeg button", modal).forEach(b => b.onclick = () => { store.set("lastAdd", b.dataset.v); addForm(b.dataset.v); });
  if (type === "task") bindTaskForm();
  if (type === "routine") bindRoutineForm();
  setTimeout(() => $("#f_title", modal)?.focus(), 50);
  $("#cancel", modal).onclick = closeModal;
  $("#save", modal).onclick = () => {
    if (!val("f_title")) return toast("タイトルを入力してください");
    if (type === "task") { const d = { ...taskData(), done_at: null }; closeModal(); return run(async () => state.tasks.push(await api.insert("tasks", d))); }
    if (type === "routine") {
      const d = routineData();
      d.archived = false;
      d.position = state.routines.length ? Math.max(...state.routines.map(r => r.position)) + 1 : 0;
      closeModal(); return run(async () => state.routines.push(await api.insert("routines", d)));
    }
    const d = { name: val("f_title"), ai: val("f_ai"), stage: +val("f_stage"), next_action: val("f_next") || null, status: "active", links: [] };
    closeModal();
    run(async () => { const p = await api.insert("projects", d); state.projects.push(p); await addLog(p, "作成"); state.filter = FILTERS["進行中"](p) ? "進行中" : "運用中"; });
  };
}

// ---------- バックアップ ----------
async function exportBackup() {
  const tables = ["projects", "subtasks", "project_logs", "routines", "routine_logs", "tasks"];
  const out = { exported_at: new Date().toISOString() };
  for (const t of tables) out[t] = await api.list(t);
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `taskboard-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("バックアップを書き出しました");
}

// =============================================================
// クリック操作
// =============================================================
document.addEventListener("click", e => {
  const menu = $("#menu");
  if (menu && !menu.hidden && !e.target.closest("#menu") && !e.target.closest('[data-act="menu"]')) menu.hidden = true;
  const b = e.target.closest("[data-act],[data-fold]");
  if (!b || modal.contains(b)) return;
  if (b.dataset.fold) {
    const sec = $("#" + b.dataset.fold); sec.classList.toggle("folded");
    state.folded[b.dataset.fold] = sec.classList.contains("folded"); store.set("fold", state.folded); return;
  }
  const id = b.dataset.id;
  const r = id && state.routines.find(x => x.id === id);
  const t = id && state.tasks.find(x => x.id === id);
  switch (b.dataset.act) {
    case "add": return addForm();
    case "menu": menu.hidden = !menu.hidden; return;
    case "reload": menu.hidden = true; return run(loadAll).then(() => toast("更新しました"));
    case "export": menu.hidden = true; return exportBackup().catch(err => toast("書き出せませんでした：" + err.message));
    case "logout": menu.hidden = true; return sb.auth.signOut();
    case "toggle-off": state.showOff = !state.showOff; return renderDailies();
    case "toggle-done": state.showDone = !state.showDone; return renderTasks();
    case "filter": state.filter = b.dataset.f; store.set("filter", state.filter); return renderProjects();
    case "p-open": return openProject(id);
    case "r-edit": return editRoutine(id);
    case "t-edit": return editTask(id);
    case "r-toggle": return run(() => (routineInfo(r).mark ? unmarkRoutine(r) : markRoutine(r, "done")));
    case "r-skip": return run(() => markRoutine(r, "skip"));
    case "r-open":
      window.open(r.url, "_blank", "noopener");
      if (!routineInfo(r).mark) run(() => markRoutine(r, "done"));
      return;
    case "t-toggle": return run(async () => Object.assign(t, await api.update("tasks", t.id, { done_at: t.done_at ? null : new Date().toISOString() })));
    case "t-post": {
      const base = t.due_date && t.due_date > todayStr() ? t.due_date : todayStr();
      return run(async () => Object.assign(t, await api.update("tasks", t.id, { due_date: addDays(base, 1) })));
    }
  }
});

// =============================================================
// 起動
// =============================================================
let refreshTimer = null, lastDay = todayStr();
function startRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.visibilityState !== "visible" || back.classList.contains("show")) return;
    loadAll().then(render).catch(console.error);
  }, REFRESH_MS);
}
setInterval(() => {   // 日付・リセット時刻をまたいだら描き直す
  if (!$("#sec-daily") || back.classList.contains("show")) return;
  if (todayStr() !== lastDay) { lastDay = todayStr(); renderShell(); }
  render();
}, 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && $("#sec-daily") && !back.classList.contains("show")) loadAll().then(render).catch(console.error);
});

async function startApp() {
  $("#app").innerHTML = '<div class="loading">読み込み中…</div>';
  try { await loadAll(); }
  catch (e) { console.error(e); $("#app").innerHTML = `<div class="loading">データを読み込めませんでした。<br>${esc(e.message || e)}<br><br><button class="add" onclick="location.reload()">もう一度読み込む</button></div>`; return; }
  renderShell(); render(); startRefresh();
}

async function boot() {
  if (DEMO) { api = memoryApi(demoSeed()); return startApp(); }
  const { createClient } = window.supabase;  // supabase.js（同じフォルダ）で読み込み済み
  sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  api = supabaseApi(sb);
  let started = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (session && !started) { started = true; userEmail = session.user.email; setTimeout(startApp, 0); }
    if (!session) { started = false; clearInterval(refreshTimer); renderLogin(); }
  });
}
boot().catch(e => { $("#app").innerHTML = `<div class="loading">起動できませんでした：${esc(e.message || e)}</div>`; });

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(console.error);
}
