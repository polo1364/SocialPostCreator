// 貼文廚房前端（純前端版，可直接放在 GitHub Pages）
// 瀏覽器直接拿使用者自己的 Key 呼叫 Claude；提示詞與流程在 kitchen.js，畫面邏輯分在 js/ 底下各模組。
import './js/base.js';
import './js/core.js';
import './js/pwa.js';
import './js/settings.js';
import './js/form.js';
import './js/order.js';
import './js/publish.js';
import './js/history.js';
import { $, STORAGE_KEYS, actions, debounce, restoreInputs, save, saveInputs, state } from './js/core.js';
import { closeInstall, receiveSharedFiles, setupPwa } from './js/pwa.js';
import { closeKeyModal, saveKey, showKeyModal, updateKeyStatus } from './js/settings.js';
import { addImages, updateDescCount, closeCustomStyle, renderLanguages, renderPhotos, renderPlatforms, renderStars, renderStyles, restoreDraftPhotos, searchPlace, setupDragDrop } from './js/form.js';
import { closePresetModal, closeVoiceModal, renderPresets, renderVoiceStatus, restorePresets, restoreVoices, saveVoiceDraft } from './js/profiles.js';
import './js/profiles.js';
import './js/compare.js';
import './js/check.js';
import './js/sync.js';
import { setupA11y } from './js/a11y.js';
import { onSyncAutoChange } from './js/sync.js';
import { closeCheck } from './js/check.js';
import { closeCompare, onCompareSelect } from './js/compare.js';
import { onOverlayInput } from './js/publish.js';
import { checkBtnState, generateCaption, setChatDraft } from './js/order.js';
import { closePublish, drawCropPreview, renderPublishCaption } from './js/publish.js';
import { closeHistoryModal, importHistoryFile, renderHistoryList, restoreCurrentOrder, updateHistoryButton } from './js/history.js';

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    restoreInputs();
    renderStars();
    renderStyles();
    renderPlatforms();
    renderLanguages();
    restoreVoices();
    restorePresets();
    renderVoiceStatus();
    renderPresets();
    renderPhotos();
    updateHistoryButton();
    updateDescCount();
    updateKeyStatus();
    checkBtnState();
    if (!state.apiKey) setTimeout(showKeyModal, 300);

    const autosave = debounce(saveInputs, 400);
    $('user-desc').addEventListener('input', () => { updateDescCount(); checkBtnState(); autosave(); });
    ['place-name', 'place-location', 'hashtags-input'].forEach(id => $(id).addEventListener('input', autosave));
    ['place-name', 'place-location'].forEach(id => $(id).addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); searchPlace(); }
    }));
    $('api-key-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveKey(); });
    $('custom-style-name').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) actions.saveCustomStyle(); });
    $('voice-input').addEventListener('input', () => {
        $('voice-count').textContent = `${$('voice-input').value.length}/3000`;
        saveVoiceDraft();
    });
    $('voice-name').addEventListener('input', saveVoiceDraft);
    ['overlay-title', 'overlay-sub'].forEach(id => $(id).addEventListener('input', onOverlayInput));
    $('overlay-all').addEventListener('change', onOverlayInput);
    $('sync-auto').addEventListener('change', onSyncAutoChange);
    $('compare-a').addEventListener('change', e => onCompareSelect('a', e.target.value));
    $('compare-b').addEventListener('change', e => onCompareSelect('b', e.target.value));
    $('preset-name').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) actions.savePreset(); });
    // 小編聊天框打到一半的字也存起來
    document.addEventListener('input', debounce(e => {
        const input = e.target.closest && e.target.closest('.chat-input');
        const form = input && input.closest('[data-submit="sendRefine"]');
        if (form) setChatDraft(Number(form.dataset.i), input.value);
    }, 300));
    // 離開或切到背景前把輸入立刻存檔（不等自動存檔的延遲）
    const flush = () => saveInputs();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    $('file-upload').addEventListener('change', e => { addImages(e.target.files); e.target.value = ''; });
    $('import-file').addEventListener('change', e => { importHistoryFile(e.target.files[0]); e.target.value = ''; });
    $('fav-only').addEventListener('change', renderHistoryList);
    $('crop-pos').addEventListener('input', () => { if (state.publish) { state.publish.pos = Number($('crop-pos').value); drawCropPreview(); } });
    $('include-translation').addEventListener('change', renderPublishCaption);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeKeyModal(); closeHistoryModal(); closeVoiceModal(); closePublish(); closeInstall(); closeCustomStyle(); closePresetModal(); closeCompare(); closeCheck(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !$('generate-btn').disabled) generateCaption();
    });
    document.addEventListener('paste', e => {
        const images = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
        if (images.length) { e.preventDefault(); addImages(images); }
    });
    setupDragDrop();
    setupPwa();
    setupA11y();
    restoreDraftPhotos().then(receiveSharedFiles);
    restoreCurrentOrder();
});

