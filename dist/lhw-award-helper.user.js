// ==UserScript==
// @name         LHW Award Helper
// @namespace    https://github.com/hmumixaM/lhw-award-helper
// @version      2.4.0
// @description  解除 lhw.com 积分房的 disabled 置灰，并就地显示 Cents per point（含 Amex 1:4 换算）
// @author       hmumixaM
// @match        *://www.lhw.com/*
// @match        *://*.lhw.com/*
// @run-at       document-start
// @grant        none
// @homepageURL  https://github.com/hmumixaM/lhw-award-helper
// @supportURL   https://github.com/hmumixaM/lhw-award-helper/issues
// @downloadURL  https://raw.githubusercontent.com/hmumixaM/lhw-award-helper/main/dist/lhw-award-helper.user.js
// @updateURL    https://raw.githubusercontent.com/hmumixaM/lhw-award-helper/main/dist/lhw-award-helper.user.js
// ==/UserScript==

(function () {
    'use strict';

    // 重复注入（bookmarklet 多次点击、或与油猴脚本共存）时只重新扫描一次
    if (window.__LHW_AWARD_HELPER__) return window.__LHW_AWARD_HELPER__();

    const CONFIG = {
        amexRatio: 4,       // 4 Amex MR = 1 LHW point
        good: 5.0,          // CPP 配色阈值（美分，按 LHW 分计）
        ok: 3.0,
        hideWarning: false, // 隐藏 "Not enough points" 文字
        panel: true,        // 右下角排行面板
        prefetch: true,     // 搜索页静默补全所有酒店房价（见下方 prefetch）
    };

    // 同时在途的房价请求数。页面自己每展开一批就会并发 10 个，取齐这个数
    // 既不比正常滚动更激进，又能让整片区域（欧洲 300+ 家）在半分钟内补完。
    const MAX_INFLIGHT = 10;
    const PUMP_MS = 200;    // 补位间隔，太长会让并发槽白等

    const OPEN_KEY = 'lhw-cpp-panel-open';
    const SORT_KEY = 'lhw-cpp-panel-sort';
    const SCHEMA = 'v4';    // 表格结构版本，改列后强制重绘

    const num = v => parseFloat(String(v == null ? '' : v).replace(/,/g, '')) || 0;
    const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const int = n => Math.round(n).toLocaleString('en-US');
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const each = (root, sel, fn) => {
        if (root.matches && root.matches(sel)) fn(root);
        if (root.querySelectorAll) root.querySelectorAll(sel).forEach(fn);
    };

    /* 解除置灰 —— 按钮绑定 :disabled="rateDisabled"，只动房型按钮，
       不碰 CONTINUE（那是未选房/提交中防重复点击的正常逻辑）。 */
    const BTN = '.rate-select-btn button, .highlighted-rate-buttons button';
    const unlock = b => {
        if (!b.disabled && !b.hasAttribute('disabled')) return;
        b.removeAttribute('disabled');
        b.disabled = false;
    };

    /* CPP = (最便宜现金价总额 − 积分房现金支出) / 积分数 × 100
       房型页: roomTotalVal / roomTotalPointsVal 均为整段住期合计，
               页面显示的却是 avg/night，故徽章上要标明晚数。
       搜索页: 价格与积分是【每晚】，而 Taxes 是【整段总额】，须先乘晚数对齐。 */
    const calc = (cash, pts, oop, nights, baseName) => {
        if (!pts || !cash) return null;
        const cpp = ((cash - oop) / pts) * 100;
        return { cash, pts, oop, cpp, nights, baseName, amex: pts * CONFIG.amexRatio, amexCpp: cpp / CONFIG.amexRatio };
    };

    const nightsOf = q => {
        const p = s => (String(s || '').length === 8
            ? new Date(+String(s).slice(0, 4), +String(s).slice(4, 6) - 1, +String(s).slice(6, 8)) : null);
        const a = p(q.indate), b = p(q.outdate);
        return a && b ? Math.max(1, Math.round((b - a) / 864e5)) : 1;
    };

    /* 把一个 .rate / article.hotel 元素解析成统一的条目，两种页面共用后续逻辑 */
    function entryOf(el) {
        const vm = el.__vue__;
        if (!vm) return null;

        if (vm.rate && el.matches('.rate')) {
            const pts = vm.rate.roomTotalPointsVal;
            const cash = ((vm.room && vm.room.roomRates) || []).filter(r => !r.roomTotalPointsVal);
            if (!pts || !cash.length) return null;
            const base = cash.reduce((a, b) => (b.roomTotalVal < a.roomTotalVal ? b : a));
            const info = calc(base.roomTotalVal, pts, vm.rate.roomTotalVal || 0,
                vm.$store.getters.getNumberOfNights, base.name);
            if (!info) return null;
            return {
                el, info,
                cur: vm.$store.getters.getCurrency || '',
                name: (vm.room && vm.room.name) || vm.rate.name,
                place: b => {
                    const p = el.querySelector('.rate-price');
                    if (p) p.insertAdjacentElement('afterend', b);
                },
            };
        }

        if (vm.hotel && el.matches('article.hotel')) {
            const a = vm.hotel.availability;
            if (!a) return null;
            const n = nightsOf(vm.query || {});
            const oop = (a.Taxes || []).reduce((s, t) => s + num(t.AmountVal), 0);
            const info = calc(num(a.AvgMinPricePerNight) * n, num(a.AvgMinPointsPerNight) * n, oop, n, '全店最低现金价');
            if (!info) return null;
            return {
                el, info,
                cur: a.CurrencyCode || vm.hotel.currency || '',
                name: vm.hotel.title,
                place: b => {
                    const box = el.querySelector('.hotel-price');
                    if (box) box.appendChild(b);
                },
            };
        }
        return null;
    }

    /* 徽章两行：主行 LHW CPP，副行 Amex 所需分数与折算后的每分价值。
       info.pts 是整段住期合计，而页面显示 avg/night，多晚时补上晚数以免误读。 */
    function paint(e) {
        const { info, cur } = e;
        let b = e.el.querySelector('.lhw-cpp');
        if (!b) {
            b = document.createElement('div');
            e.place(b);
            if (!b.isConnected) return;
        }
        // 旧版本（或旧注入副本）留下的单行徽章没有这两个 span，补建结构
        if (!b.querySelector('.lhw-r1')) {
            b.innerHTML = '<span class="lhw-r1"></span><span class="lhw-r2"></span>';
        }

        const stay = info.nights > 1 ? `${info.nights}晚 ` : '';
        const sig = `${SCHEMA}|${info.cpp.toFixed(2)}|${info.amex}|${stay}`;
        if (b.dataset.v === sig) return;
        b.dataset.v = sig;

        b.className = 'lhw-cpp ' + (info.cpp >= CONFIG.good ? 'lhw-g' : info.cpp >= CONFIG.ok ? 'lhw-k' : 'lhw-l');
        b.firstChild.innerHTML = `${info.cpp.toFixed(2)}<i>¢/分</i>`;
        b.lastChild.innerHTML = `${esc(stay)}${int(info.amex)}<i> MR · </i>${info.amexCpp.toFixed(2)}<i>¢/MR</i>`;
        b.title =
            `${info.nights} 晚合计\n` +
            `最便宜现金价：${fmt(info.cash)} ${cur}（${info.baseName}）\n` +
            `积分房税费：${fmt(info.oop)} ${cur}\n` +
            `LHW 积分：${int(info.pts)}\n` +
            `Amex 1:${CONFIG.amexRatio} → ${int(info.amex)} MR\n` +
            `CPP = (${fmt(info.cash)} − ${fmt(info.oop)}) ÷ ${int(info.pts)} × 100\n` +
            `    = ${info.cpp.toFixed(3)}¢ / LHW 分　=　${info.amexCpp.toFixed(3)}¢ / Amex MR`;
    }

    /* 全量扫描：顺带画徽章，返回排行数据（排序交给面板） */
    function collect() {
        const rows = [];
        document.querySelectorAll('.rate, article.hotel').forEach(el => {
            const e = entryOf(el);
            if (!e) return;
            paint(e);
            rows.push(e);
        });
        return rows;
    }

    /* ---- 搜索页：静默补全所有酒店的房价 ----

       LHW 一次就把整个搜索结果的酒店列表下发了（滚到底也不会变多），
       按滚动懒加载的只是每家的 availability —— 所以「要翻好几页才看得全」
       其实是价格在慢慢冒出来。这里直接派发 store 的 loadHotelAvailability，
       不制造任何滚动，页面不会在用户眼皮底下乱跳。 */

    const PF = { on: false, done: 0, total: 0 };
    const sent = new Map();     // code -> 发出时刻
    const REQ_TTL = 20000;      // 这么久还没回填就当它没了，可以重发
    let searchSig = '';
    let pumpTimer = null;

    const storeOf = () => {
        const a = document.querySelector('article.hotel');
        return (a && a.__vue__ && a.__vue__.$store) || null;
    };

    /* 跑一轮，返回「是否还有活要干」。

       注意 dispatch 兑现得比数据回填早得多（实测 2ms vs 105ms），拿它当
       完成信号既会让并发上限失效、又会让同一家被立刻重排，所以在途与否
       一律以 availability 有没有落地为准。 */
    function pumpOnce() {
        const st = storeOf();
        if (!st || !st.getters) return false;

        // 换了日期/地区/筛选就重新开始（旧的 availability 会被清空）
        const sig = location.pathname + location.search;
        if (sig !== searchSig) { searchSig = sig; sent.clear(); }

        const hotels = st.getters.getHotels || [];
        if (!hotels.length) return false;

        const now = Date.now();
        let live = 0;
        const queue = [];
        for (const h of hotels) {
            const c = h && h.sabreBookingCode;
            if (!c || h.availability) continue;
            const ts = sent.get(c);
            if (ts == null || now - ts > REQ_TTL) queue.push(c);
            else live++;
        }

        for (const c of queue.slice(0, Math.max(0, MAX_INFLIGHT - live))) {
            sent.set(c, now);
            Promise.resolve()
                .then(() => st.dispatch('loadHotelAvailability', c))
                .catch(() => { sent.delete(c); });   // 单家失败不影响其它，下轮再排
        }

        PF.total = hotels.length;
        PF.done = hotels.filter(h => h && h.availability).length;
        PF.on = live > 0 || queue.length > 0;
        return PF.on;
    }

    function prefetch() {
        if (!CONFIG.prefetch || pumpTimer) return;
        if (!pumpOnce()) return;
        pumpTimer = setInterval(() => {
            if (!pumpOnce()) { clearInterval(pumpTimer); pumpTimer = null; }
        }, PUMP_MS);
    }

    /* 搜索页只「显示」前 app.visibleLimit 家（默认 10，滚动才 +10），
       其余 article.hotel 是 display:none —— 没有布局盒子，scrollIntoView
       对它无效。所以定位前先用官方 mutation 把它放出来，再等排版完成。 */
    function reveal(el) {
        const st = storeOf();
        const i = el.__vue__ && el.__vue__.index;
        if (st && st.state.app && typeof i === 'number') {
            let guard = 0;
            while (st.state.app.visibleLimit <= i && guard++ < 500) {
                st.commit('increaseVisibleLimit');
            }
        }
        return new Promise(done => {
            let n = 0;
            const wait = () => (el.getBoundingClientRect().height > 0 || ++n > 60)
                ? done() : requestAnimationFrame(wait);
            wait();
        });
    }

    function locate(e) {
        if (!e || !e.el || !e.el.isConnected) return;
        const el = e.el;
        reveal(el).then(() => {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            el.classList.add('lhw-flash');

            /* 一次放出上百张卡片后，图片是陆续加载的，文档高度一直在长，
               目标很容易被挤到视口边缘。所以落定过程中再校两次位置，
               两次都在高亮消失之前，用户看得到它最终停在哪。 */
            const settle = () => {
                const r = el.getBoundingClientRect();
                if (Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) > innerHeight * 0.35) {
                    el.scrollIntoView({ block: 'center' });
                }
            };
            setTimeout(settle, 500);
            setTimeout(settle, 1300);
            setTimeout(() => el.classList.remove('lhw-flash'), 2200);
        });
    }

    /* ---- 右下角排行面板，默认收起成一个小按钮 ---- */

    /* 可排序的列。dir 是首次点该列时的方向：价值类默认从高到低，
       所需积分默认从低到高（先看换得起的）。¢/MR 与 ¢/分 的顺序其实等价，
       但单独成键才能把箭头标在被点的那一列上。

       get 取的是【显示出来的那个值】（四舍五入到表格里的精度）。因为并列
       与否要以用户看到的为准 —— 7.0712 和 7.0689 都印成 7.07，若按原始值
       比较，这两行明明看着一样却仍分先后，次级排序就像没生效。

       tie 是并列时的次级列，方向固定用它自己的 dir：CPP 相同就先给要分少
       的，所需积分相同就先给更值钱的。 */
    const r2 = v => Math.round(v * 100) / 100;
    const SORTS = {
        cpp: { label: '¢/分', get: e => r2(e.info.cpp), dir: -1, tie: 'amex' },
        amex: { label: 'MR', get: e => Math.round(e.info.amex), dir: 1, tie: 'cpp' },
        amexCpp: { label: '¢/MR', get: e => r2(e.info.amexCpp), dir: -1, tie: 'amex' },
    };

    const cmp = (a, b) => {
        const s = SORTS[sortK];
        let d = (s.get(a) - s.get(b)) * sortD;
        if (!d && s.tie) {
            const t = SORTS[s.tie];
            d = (t.get(a) - t.get(b)) * t.dir;
        }
        return d || String(a.name).localeCompare(String(b.name));   // 兜底，保证顺序稳定
    };

    let panel, rowsRef = [], sortK = 'cpp', sortD = SORTS.cpp.dir;

    function saveSort() {
        try { localStorage.setItem(SORT_KEY, sortK + ':' + sortD); } catch (_) { /* 隐私模式 */ }
    }
    function loadSort() {
        try {
            const [k, d] = String(localStorage.getItem(SORT_KEY) || '').split(':');
            if (SORTS[k]) { sortK = k; sortD = +d === 1 ? 1 : -1; }
        } catch (_) { /* 隐私模式 */ }
    }

    function buildPanel() {
        panel = document.createElement('div');
        panel.id = 'lhw-panel';
        panel.innerHTML =
            '<button class="lhw-tog" type="button"></button>' +
            '<div class="lhw-box">' +
            '<div class="lhw-hd"><span>CPP 排行</span><button class="lhw-x" type="button">×</button></div>' +
            '<div class="lhw-scroll"><table></table></div>' +
            `<div class="lhw-ft">Amex ${CONFIG.amexRatio}:1 · 已扣税费 · 点表头排序 · 点行定位</div>` +
            '</div>';
        document.body.appendChild(panel);

        const setOpen = o => {
            panel.classList.toggle('lhw-open', o);
            try { localStorage.setItem(OPEN_KEY, o ? '1' : '0'); } catch (_) { /* 隐私模式 */ }
        };
        panel.querySelector('.lhw-tog').addEventListener('click', () => setOpen(!panel.classList.contains('lhw-open')));
        panel.querySelector('.lhw-x').addEventListener('click', () => setOpen(false));

        panel.querySelector('table').addEventListener('click', ev => {
            // 点表头切换排序：同一列再点一次反向
            const th = ev.target.closest('th[data-k]');
            if (th) {
                const k = th.dataset.k;
                if (k === sortK) sortD = -sortD;
                else { sortK = k; sortD = SORTS[k].dir; }
                saveSort();
                panel.dataset.sig = '';     // 数据没变，强制重绘
                renderPanel(collect());
                return;
            }
            // 点行定位到对应房型/酒店并高亮
            const tr = ev.target.closest('tr[data-i]');
            if (tr) locate(rowsRef[+tr.dataset.i]);
        });

        loadSort();
        let open = false;
        try { open = localStorage.getItem(OPEN_KEY) === '1'; } catch (_) { /* 隐私模式 */ }
        if (open) panel.classList.add('lhw-open');
    }

    function renderPanel(raw) {
        if (!CONFIG.panel || !document.body) return;
        if (!panel) buildPanel();

        const tog = panel.querySelector('.lhw-tog');
        const loading = PF.on && PF.total;

        // 补房价期间保持可见，让用户知道榜单还在长
        panel.style.display = (raw.length || loading) ? '' : 'none';
        if (!raw.length) {
            if (loading) tog.textContent = `CPP 载入 ${PF.done}/${PF.total}`;
            return;
        }

        const rows = raw.slice().sort(cmp);
        rowsRef = rows;

        // 小按钮始终报当前页最好的 CPP，与表格排序无关
        const best = Math.max(...rows.map(e => e.info.cpp)).toFixed(2);
        tog.textContent = loading ? `CPP ${best}¢ · ${PF.done}/${PF.total}` : `CPP ${best}¢`;

        const sig = `${SCHEMA}|${sortK}|${sortD}|` + rows.map(e => e.name + e.info.cpp.toFixed(2)).join('|');
        if (panel.dataset.sig === sig) return;
        panel.dataset.sig = sig;
        panel.querySelector('table').innerHTML =
            '<thead><tr><th></th><th>名称</th>' +
            Object.keys(SORTS).map(k =>
                `<th data-k="${k}" class="lhw-th${k === sortK ? ' lhw-on' : ''}">` +
                `${SORTS[k].label}${k === sortK ? (sortD < 0 ? ' ▾' : ' ▴') : ''}</th>`
            ).join('') +
            '</tr></thead><tbody>' +
            rows.map((e, i) => {
                const c = e.info.cpp >= CONFIG.good ? 'lhw-g' : e.info.cpp >= CONFIG.ok ? 'lhw-k' : 'lhw-l';
                return `<tr data-i="${i}" title="${esc(e.name)}">` +
                    `<td class="lhw-i">${i + 1}</td>` +
                    `<td class="lhw-nm">${esc(e.name)}</td>` +
                    `<td class="lhw-v ${c}">${e.info.cpp.toFixed(2)}</td>` +
                    `<td class="lhw-mr">${int(e.info.amex)}</td>` +
                    `<td class="lhw-v2">${e.info.amexCpp.toFixed(2)}</td></tr>`;
            }).join('') +
            '</tbody>';
    }

    function sweep(root) {
        if (!root || root.nodeType !== 1) return;
        each(root, BTN, unlock);
    }

    const style = document.createElement('style');
    style.textContent = `
        .rate-select-btn button[disabled],
        .highlighted-rate-buttons button[disabled] {
            opacity: 1 !important; cursor: pointer !important;
            pointer-events: auto !important; filter: none !important;
        }
        ${CONFIG.hideWarning ? '.points-error { display: none !important; }' : ''}

        .lhw-cpp {
            display: inline-flex; flex-direction: column; align-items: flex-start;
            margin: 5px 0 2px; padding: 3px 8px; border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            line-height: 1.35; white-space: nowrap; cursor: help; text-align: left;
        }
        .lhw-cpp .lhw-r1 { font-size: 13px; font-weight: 700; }
        .lhw-cpp .lhw-r2 { font-size: 10.5px; font-weight: 600; opacity: .75; }
        .lhw-cpp i { font-style: normal; font-weight: 500; opacity: .8; }
        .hotel-price .lhw-cpp { margin-top: 6px; }
        .lhw-g { background: #e3f4e8; color: #1c6b34; border: 1px solid #b6e0c4; }
        .lhw-k { background: #fdf3e0; color: #8a5a12; border: 1px solid #f0dcb4; }
        .lhw-l { background: #f2f3f5; color: #6a6f76; border: 1px solid #dcdfe3; }
        .lhw-flash { outline: 2px solid #2c4a63 !important; outline-offset: 2px; }

        #lhw-panel {
            position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #lhw-panel .lhw-tog {
            display: block; margin-left: auto; padding: 7px 13px;
            background: #2c4a63; color: #fff; border: 0; border-radius: 999px;
            font-size: 12px; font-weight: 700; cursor: pointer;
            box-shadow: 0 2px 10px rgba(0,0,0,.28);
        }
        #lhw-panel .lhw-box { display: none; }
        #lhw-panel.lhw-open .lhw-tog { display: none; }
        #lhw-panel.lhw-open .lhw-box {
            display: block; width: 330px; background: #fff;
            border: 1px solid #dcdfe3; border-radius: 10px; overflow: hidden;
            box-shadow: 0 6px 26px rgba(0,0,0,.2);
        }
        #lhw-panel .lhw-hd {
            display: flex; align-items: center; justify-content: space-between;
            padding: 8px 10px; background: #2c4a63; color: #fff; font-size: 12px; font-weight: 700;
        }
        #lhw-panel .lhw-x {
            background: none; border: 0; color: #fff; font-size: 17px;
            line-height: 1; cursor: pointer; padding: 0 2px;
        }
        #lhw-panel .lhw-scroll { max-height: 320px; overflow: auto; scrollbar-width: thin; }
        /* 给覆盖式滚动条留位，避免压住最后一列数字 */
        #lhw-panel th:last-child, #lhw-panel td:last-child { padding-right: 13px; }
        #lhw-panel table { width: 100%; border-collapse: collapse; font-size: 11.5px; color: #23282e; }
        #lhw-panel th {
            position: sticky; top: 0; background: #f6f7f9; color: #6a6f76;
            font-weight: 600; text-align: right; padding: 5px 7px; border-bottom: 1px solid #e6e9ec;
        }
        #lhw-panel th:nth-child(2) { text-align: left; }
        #lhw-panel .lhw-th { cursor: pointer; user-select: none; white-space: nowrap; }
        #lhw-panel .lhw-th:hover { background: #eceff2; color: #23282e; }
        #lhw-panel .lhw-on { color: #2c4a63; }
        #lhw-panel td { padding: 5px 7px; border-bottom: 1px solid #f0f2f4; text-align: right; }
        #lhw-panel tbody tr { cursor: pointer; }
        #lhw-panel tbody tr:hover { background: #f6f9fc; }
        #lhw-panel .lhw-i { color: #a6acb3; width: 18px; }
        #lhw-panel .lhw-nm {
            text-align: left; max-width: 128px; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap;
        }
        #lhw-panel .lhw-v { font-weight: 700; border-radius: 4px; }
        #lhw-panel .lhw-v2 { font-weight: 600; color: #6a6f76; }
        #lhw-panel .lhw-mr { color: #6a6f76; font-variant-numeric: tabular-nums; }
        #lhw-panel .lhw-ft {
            padding: 6px 10px; background: #fafbfc; color: #8a9098;
            font-size: 10px; border-top: 1px solid #f0f2f4;
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    // Vue 在 rateDisabled 不变时不会重设属性，删掉即生效；
    // 但新搜索结果会挂载新组件并带上 disabled，故需持续监听。
    new MutationObserver(rs => rs.forEach(r => {
        if (r.type === 'attributes') sweep(r.target);
        else r.addedNodes.forEach(sweep);
    })).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'],
    });

    // 搜索页可用性数据异步回填，文本更新不一定触发上面的监听
    const tick = () => {
        if (!document.body) return;
        sweep(document.body);
        prefetch();
        renderPanel(collect());
    };
    document.addEventListener('DOMContentLoaded', tick);
    window.addEventListener('load', tick);
    setInterval(tick, 1500);
    tick();

    window.__LHW_AWARD_HELPER__ = tick;
})();
