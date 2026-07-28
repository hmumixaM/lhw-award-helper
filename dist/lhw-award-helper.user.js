// ==UserScript==
// @name         LHW Award Helper
// @namespace    https://github.com/hmumixaM/lhw-award-helper
// @version      2.1.0
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
    };

    const OPEN_KEY = 'lhw-cpp-panel-open';
    const SCHEMA = 'v3';    // 表格结构版本，改列后强制重绘

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

    /* 全量扫描：顺带画徽章，并返回按 CPP 降序的排行数据 */
    function collect() {
        const rows = [];
        document.querySelectorAll('.rate, article.hotel').forEach(el => {
            const e = entryOf(el);
            if (!e) return;
            paint(e);
            rows.push(e);
        });
        return rows.sort((a, b) => b.info.cpp - a.info.cpp);
    }

    /* ---- 右下角排行面板，默认收起成一个小按钮 ---- */

    let panel, rowsRef = [];

    function buildPanel() {
        panel = document.createElement('div');
        panel.id = 'lhw-panel';
        panel.innerHTML =
            '<button class="lhw-tog" type="button"></button>' +
            '<div class="lhw-box">' +
            '<div class="lhw-hd"><span>CPP 排行</span><button class="lhw-x" type="button">×</button></div>' +
            '<div class="lhw-scroll"><table></table></div>' +
            `<div class="lhw-ft">Amex ${CONFIG.amexRatio}:1 · 已扣积分房税费 · 悬停徽章看推导</div>` +
            '</div>';
        document.body.appendChild(panel);

        const setOpen = o => {
            panel.classList.toggle('lhw-open', o);
            try { localStorage.setItem(OPEN_KEY, o ? '1' : '0'); } catch (_) { /* 隐私模式 */ }
        };
        panel.querySelector('.lhw-tog').addEventListener('click', () => setOpen(!panel.classList.contains('lhw-open')));
        panel.querySelector('.lhw-x').addEventListener('click', () => setOpen(false));

        // 点击行滚动到对应房型/酒店并高亮
        panel.querySelector('table').addEventListener('click', ev => {
            const tr = ev.target.closest('tr[data-i]');
            if (!tr) return;
            const e = rowsRef[+tr.dataset.i];
            if (!e || !e.el.isConnected) return;
            e.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            e.el.classList.add('lhw-flash');
            setTimeout(() => e.el.classList.remove('lhw-flash'), 1400);
        });

        let open = false;
        try { open = localStorage.getItem(OPEN_KEY) === '1'; } catch (_) { /* 隐私模式 */ }
        if (open) panel.classList.add('lhw-open');
    }

    function renderPanel(rows) {
        if (!CONFIG.panel || !document.body) return;
        if (!panel) buildPanel();

        panel.style.display = rows.length ? '' : 'none';
        if (!rows.length) return;
        rowsRef = rows;

        const sig = SCHEMA + rows.map(e => e.name + e.info.cpp.toFixed(2)).join('|');
        if (panel.dataset.sig === sig) return;
        panel.dataset.sig = sig;

        panel.querySelector('.lhw-tog').textContent = `CPP ${rows[0].info.cpp.toFixed(2)}¢`;
        panel.querySelector('table').innerHTML =
            '<thead><tr><th></th><th>名称</th><th>¢/分</th><th>MR</th><th>¢/MR</th></tr></thead><tbody>' +
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

    // 搜索页可用性数据随滚动懒加载，文本更新不一定触发上面的监听
    const tick = () => {
        if (!document.body) return;
        sweep(document.body);
        renderPanel(collect());
    };
    document.addEventListener('DOMContentLoaded', tick);
    window.addEventListener('load', tick);
    setInterval(tick, 1500);
    tick();

    window.__LHW_AWARD_HELPER__ = tick;
})();
