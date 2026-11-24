// 貼文廚房 · 鍵盤操作與讀屏軟體
// - 對話框打開時：焦點移進去、Tab 只在對話框裡循環；關掉後焦點回到原本的按鈕
// - 只有圖示的按鈕：自動用 title 當作讀屏軟體念的名稱
// - 背景內容在對話框開啟時對讀屏軟體隱藏

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isOpen = el => !el.classList.contains('hidden');
const openModals = () => [...document.querySelectorAll('.modal-backdrop')].filter(isOpen);
const visible = el => el.offsetParent !== null || el.getClientRects().length > 0;
const focusables = root => [...root.querySelectorAll(FOCUSABLE)].filter(visible);

const openers = new WeakMap();

function onModalToggle(modal) {
    const main = [document.querySelector('nav'), document.querySelector('main'), document.getElementById('result-area'), document.querySelector('footer')].filter(Boolean);
    if (isOpen(modal)) {
        if (!openers.has(modal)) openers.set(modal, document.activeElement);
        main.forEach(el => el.setAttribute('aria-hidden', 'true'));
        // 打開視窗的程式可能會自己把焦點放進輸入框；稍等一下，焦點還在外面才移進來
        setTimeout(() => {
            if (!isOpen(modal) || modal.contains(document.activeElement)) return;
            const target = modal.querySelector('input:not([type="checkbox"]), textarea') || focusables(modal)[0];
            target?.focus();
        }, 80);
    } else {
        if (!openModals().length) main.forEach(el => el.removeAttribute('aria-hidden'));
        const opener = openers.get(modal);
        openers.delete(modal);
        if (opener && document.contains(opener) && !openModals().length) opener.focus({ preventScroll: true });
    }
}

function labelIconButtons(root = document) {
    for (const btn of root.querySelectorAll('button')) {
        if (btn.getAttribute('aria-label') || btn.textContent.trim()) continue;
        if (btn.title) btn.setAttribute('aria-label', btn.title);
    }
}

export function setupA11y() {
    const modalObserver = new MutationObserver(records => {
        for (const r of records) if (r.attributeName === 'class') onModalToggle(r.target);
    });
    document.querySelectorAll('.modal-backdrop').forEach(m => modalObserver.observe(m, { attributes: true, attributeFilter: ['class'] }));

    // Tab 只在最上層的對話框裡循環
    document.addEventListener('keydown', e => {
        if (e.key !== 'Tab') return;
        const modal = openModals().at(-1);
        if (!modal) return;
        const items = focusables(modal);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    labelIconButtons();
    new MutationObserver(records => {
        for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) labelIconButtons(n.parentElement || document);
    }).observe(document.body, { childList: true, subtree: true });

    // 用鍵盤操作時才顯示明顯的焦點框
    document.addEventListener('keydown', e => { if (e.key === 'Tab') document.body.classList.add('kbd'); });
    document.addEventListener('mousedown', () => document.body.classList.remove('kbd'));
}
