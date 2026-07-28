(function () {
    'use strict';

    // 重复注入（bookmarklet 多次点击、或与油猴脚本共存）时只重新扫描一次
    if (window.__LHW_AWARD_HELPER__) return window.__LHW_AWARD_HELPER__();

    const CONFIG = {
        amexRatio: 4,       // 4 Amex MR = 1 LHW point
        good: 5.0,          // CPP 配色阈值（美分）
        ok: 3.0,
        hideWarning: false, // 隐藏 "Not enough points" 文字
    };

    const num = v => parseFloat(String(v == null ? '' : v).replace(/,/g, '')) || 0;
    const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
       房型页: roomTotalVal 为整段住期含税总额，积分房的即为其税费。
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

    function rateInfo(vm) {
        const pts = vm.rate.roomTotalPointsVal;
        const cash = ((vm.room && vm.room.roomRates) || []).filter(r => !r.roomTotalPointsVal);
        if (!pts || !cash.length) return null;
        const base = cash.reduce((a, b) => (b.roomTotalVal < a.roomTotalVal ? b : a));
        return calc(base.roomTotalVal, pts, vm.rate.roomTotalVal || 0, vm.$store.getters.getNumberOfNights, base.name);
    }

    function hotelInfo(vm) {
        const a = vm.hotel && vm.hotel.availability;
        if (!a) return null;
        const n = nightsOf(vm.query || {});
        const oop = (a.Taxes || []).reduce((s, t) => s + num(t.AmountVal), 0);
        return calc(num(a.AvgMinPricePerNight) * n, num(a.AvgMinPointsPerNight) * n, oop, n, '全店最低现金价');
    }

    function paint(scope, info, cur, place) {
        let b = scope.querySelector('.lhw-cpp');
        if (!b) {
            b = document.createElement('div');
            place(b);
        }
        const t = `${info.cpp.toFixed(2)}¢ / point`;
        if (b.dataset.v === t) return;
        b.dataset.v = t;
        b.textContent = t;
        b.className = 'lhw-cpp ' + (info.cpp >= CONFIG.good ? 'lhw-g' : info.cpp >= CONFIG.ok ? 'lhw-k' : 'lhw-l');
        b.title =
            `${info.nights} 晚合计\n` +
            `最便宜现金价：${fmt(info.cash)} ${cur}（${info.baseName}）\n` +
            `积分房税费：${fmt(info.oop)} ${cur}\n` +
            `LHW 积分：${info.pts.toLocaleString()}\n` +
            `Amex 1:${CONFIG.amexRatio} → ${info.amex.toLocaleString()} 分\n` +
            `CPP = (${fmt(info.cash)} − ${fmt(info.oop)}) ÷ ${info.pts.toLocaleString()} × 100\n` +
            `    = ${info.cpp.toFixed(3)}¢ / LHW　=　${info.amexCpp.toFixed(3)}¢ / Amex`;
    }

    function doRate(el) {
        const vm = el.__vue__, price = el.querySelector('.rate-price');
        if (!vm || !vm.rate || !price) return;
        const info = rateInfo(vm);
        if (info) paint(el, info, vm.$store.getters.getCurrency || '', b => price.insertAdjacentElement('afterend', b));
    }

    function doHotel(el) {
        const vm = el.__vue__, box = el.querySelector('.hotel-price');
        if (!vm || !vm.hotel || !box) return;
        const info = hotelInfo(vm);
        if (info) paint(el, info, vm.hotel.availability.CurrencyCode || vm.hotel.currency || '', b => box.appendChild(b));
    }

    function sweep(root) {
        if (!root || root.nodeType !== 1) return;
        each(root, BTN, unlock);
        each(root, '.rate', doRate);
        each(root, 'article.hotel', doHotel);
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
            display: inline-block; margin: 4px 0 2px; padding: 2px 8px;
            border-radius: 10px; font-size: 12px; font-weight: 700;
            white-space: nowrap; cursor: help;
        }
        .hotel-price .lhw-cpp { margin-top: 6px; }
        .lhw-g { background: #e3f4e8; color: #1c6b34; border: 1px solid #b6e0c4; }
        .lhw-k { background: #fdf3e0; color: #8a5a12; border: 1px solid #f0dcb4; }
        .lhw-l { background: #f2f3f5; color: #6a6f76; border: 1px solid #dcdfe3; }
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
    const tick = () => sweep(document.body);
    document.addEventListener('DOMContentLoaded', tick);
    window.addEventListener('load', tick);
    setInterval(tick, 1500);
    if (document.body) tick();

    window.__LHW_AWARD_HELPER__ = tick;
})();
