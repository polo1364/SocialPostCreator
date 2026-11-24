// 貼文廚房 · Google 雲端硬碟備份
// 用 Google 官方登入（Google Identity Services）取得暫時權杖，只存取 Drive 的「應用程式專用資料夾」
// （drive.appdata：只看得到本 App 自己存的檔案，看不到你雲端硬碟裡的其他東西）。
// 需要一組 OAuth 用戶端 ID（在 Google Cloud Console 免費建立），可寫在下面或在設定裡貼上。
import { actions } from './base.js';
import { $, STORAGE_KEYS, load, save, state, toast } from './core.js';
import { applyBackup, buildBackup, renderHistoryList } from './history.js';

export const DEFAULT_GOOGLE_CLIENT_ID = '';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'post-kitchen-backup.json';
const GIS_URL = 'https://accounts.google.com/gsi/client';

const sync = { token: null, expiresAt: 0, tokenClient: null, auto: false, timer: null, busy: false };

export const clientId = () => (load(STORAGE_KEYS.googleClientId, '') || DEFAULT_GOOGLE_CLIENT_ID || '').trim();

function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = GIS_URL;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('無法載入 Google 登入，請檢查網路'));
        document.head.appendChild(s);
    });
}

const tokenValid = () => sync.token && Date.now() < sync.expiresAt - 60_000;

// 取得權杖：第一次會跳出 Google 授權視窗（必須由按鈕觸發）
async function getToken() {
    if (tokenValid()) return sync.token;
    const id = clientId();
    if (!id) throw new Error('請先在設定裡貼上 Google OAuth 用戶端 ID');
    await loadGis();
    return new Promise((resolve, reject) => {
        sync.tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: id,
            scope: SCOPE,
            callback: resp => {
                if (resp.error) return reject(new Error(resp.error === 'access_denied' ? '你取消了 Google 授權' : `Google 授權失敗：${resp.error}`));
                sync.token = resp.access_token;
                sync.expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
                renderSyncStatus();
                resolve(sync.token);
            },
            error_callback: err => reject(new Error(err?.type === 'popup_closed' ? '授權視窗被關掉了' : '無法開啟 Google 授權視窗（請允許彈出視窗）'))
        });
        sync.tokenClient.requestAccessToken({ prompt: sync.token ? '' : 'consent' });
    });
}

async function drive(path, opts = {}) {
    const token = await getToken();
    const res = await fetch(`https://www.googleapis.com${path}`, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
    if (res.status === 401) { sync.token = null; throw new Error('Google 授權過期，請再按一次'); }
    if (!res.ok) throw new Error(`Google 雲端硬碟回應錯誤（${res.status}）`);
    return res;
}

async function findBackup() {
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const res = await drive(`/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
    const data = await res.json();
    return data.files?.[0] || null;
}

export async function backupNow({ quiet = false } = {}) {
    if (sync.busy) return;
    sync.busy = true;
    renderSyncStatus('備份中…');
    try {
        const body = JSON.stringify(buildBackup());
        const existing = await findBackup();
        if (existing) {
            await drive(`/upload/drive/v3/files/${existing.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
        } else {
            const boundary = `pk${Date.now()}`;
            const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
            const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
            await drive('/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
        }
        save(STORAGE_KEYS.lastSync, new Date().toISOString());
        if (!quiet) toast('已備份到 Google 雲端硬碟（不含照片）', 'success');
    } finally {
        sync.busy = false;
        renderSyncStatus();
    }
}

export async function restoreNow() {
    renderSyncStatus('讀取雲端備份…');
    try {
        const file = await findBackup();
        if (!file) { toast('雲端還沒有備份', 'info'); return; }
        const res = await drive(`/drive/v3/files/${file.id}?alt=media`);
        const r = applyBackup(await res.json());
        renderHistoryList();
        toast(`從雲端還原：新增 ${r.added} 張單、${r.voicesAdded} 組口吻、${r.presetsAdded} 個套餐`, 'success');
    } finally {
        renderSyncStatus();
    }
}

// 訂單有變動時，若這次開啟期間已授權並開啟自動備份，20 秒後自動上傳
export function scheduleAutoBackup() {
    if (!sync.auto || !tokenValid()) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(() => backupNow({ quiet: true }).catch(e => console.warn('自動備份失敗', e)), 20_000);
}

export function renderSyncStatus(busyText) {
    const el = $('sync-status');
    if (!el) return;
    const has = !!clientId();
    $('sync-setup').classList.toggle('hidden', has);
    $('sync-actions').classList.toggle('hidden', !has);
    if (busyText) { el.textContent = busyText; return; }
    const last = load(STORAGE_KEYS.lastSync, '');
    el.textContent = [
        tokenValid() ? '已連結 Google' : '尚未連結（按備份或還原時會請你登入）',
        last ? `上次備份：${new Date(last).toLocaleString('zh-TW', { hour12: false })}` : ''
    ].filter(Boolean).join(' · ');
    $('sync-auto').checked = sync.auto;
}

actions.saveGoogleClientId = () => {
    const v = $('google-client-id').value.trim();
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(v)) return toast('看起來不像 Google OAuth 用戶端 ID（結尾應是 .apps.googleusercontent.com）', 'error');
    save(STORAGE_KEYS.googleClientId, v);
    renderSyncStatus();
    toast('已儲存用戶端 ID', 'success');
};
actions.resetGoogleClientId = () => {
    save(STORAGE_KEYS.googleClientId, '');
    sync.token = null;
    renderSyncStatus();
};

actions.backupNow = () => backupNow().catch(e => toast(e.message || '備份失敗', 'error'));
actions.restoreNow = () => restoreNow().catch(e => toast(e.message || '還原失敗', 'error'));

export function onSyncAutoChange() {
    sync.auto = $('sync-auto').checked;
    if (sync.auto && !tokenValid()) {
        getToken().then(() => toast('已開啟自動備份：這次開著網頁時，訂單有變動就會自動備份', 'success'))
            .catch(e => { sync.auto = false; renderSyncStatus(); toast(e.message, 'error'); });
    }
}
