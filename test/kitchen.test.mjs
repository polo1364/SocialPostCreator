// 「廚房」邏輯測試：提示詞組裝、串流解析、費用、錯誤訊息。用假的 client，不會呼叫真正的 Claude API。
import test from 'node:test';
import assert from 'node:assert';
import * as K from '../public/kitchen.js';

const img = { mediaType: 'image/png', data: 'AAAA' };

test('出單請求：基本組裝', () => {
    const { params, model, platform } = K.buildCaptionRequest({ images: [img], description: '早午餐', styles: ['humorous', 'warm', 'foodie'], platform: 'facebook', model: 'claude-sonnet-5-5' });
    assert.equal(model, 'claude-sonnet-5-5');
    assert.equal(platform, 'facebook');
    assert.equal(params.model, 'claude-sonnet-5-5');
    assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(params.fallbacks, 'default');
    assert.equal(params.output_config.format.type, 'json_schema');
    const content = params.messages[0].content;
    assert.equal(content[0].type, 'image');
    const prompt = content.at(-1).text;
    assert.match(prompt, /早午餐/);
    assert.match(prompt, /Facebook/);
    assert.match(prompt, /幽默搞笑[\s\S]*溫馨感性[\s\S]*美食專家/);
    assert.match(prompt, /translation 一律填空字串/);
});

test('出單請求：沒有照片會丟錯、風格不足 3 種用預設、Haiku 不開備援', () => {
    assert.throws(() => K.buildCaptionRequest({ images: [] }), /照片/);
    const { params } = K.buildCaptionRequest({ images: [img], styles: ['humorous'], model: 'claude-haiku-5-5' });
    assert.equal(params.betas, undefined);
    assert.match(params.messages[0].content.at(-1).text, /3 則風格各異/);
    const unknown = K.buildCaptionRequest({ images: [img], model: 'gpt-4' });
    assert.equal(unknown.model, 'claude-sonnet-5-5');
});

test('出單請求：多張照片、Hashtag、外語、口吻、重做', () => {
    const { params } = K.buildCaptionRequest({
        images: [img, img, img],
        hashtags: '#台中美食 週末',
        language: 'ja',
        voiceSamples: '今天好開心喔～',
        redoStyle: 'warm',
        avoidCaption: '上一版內容'
    });
    const content = params.messages[0].content;
    assert.equal(content.filter(c => c.type === 'image').length, 3);
    assert.equal(content[0].text, '照片 1：');
    const prompt = content.at(-1).text;
    assert.match(prompt, /#台中美食 #週末/);
    assert.match(prompt, /翻成日文/);
    assert.match(prompt, /今天好開心喔～/);
    assert.match(prompt, /一則貼文/);
    assert.match(prompt, /上一版內容/);
    assert.match(prompt, /溫馨感性/);
});

test('微調請求：檢查必填', () => {
    assert.throws(() => K.buildRefineRequest({ instruction: '短一點' }), /缺少/);
    assert.throws(() => K.buildRefineRequest({ caption: 'x' }), /想怎麼改/);
    const { params } = K.buildRefineRequest({ caption: '原文', instruction: '短一點', history: [{ instruction: '好笑一點' }], language: 'en' });
    const prompt = params.messages[0].content;
    assert.match(prompt, /原文/);
    assert.match(prompt, /好笑一點/);
    assert.match(prompt, /翻成英文/);
    assert.equal(params.output_config.effort, 'low');
});

test('串流 JSON 修補：寫到一半也能解析', () => {
    assert.deepEqual(K.parsePartialJson('{"captions":[{"style":"幽默","caption":"鬆餅疊三'), { captions: [{ style: '幽默', caption: '鬆餅疊三' }] });
    assert.deepEqual(K.parsePartialJson('{"a":[1,2,'), { a: [1, 2] });
    assert.deepEqual(K.parsePartialJson('{"s":"換行\\'), { s: '換行' });
    assert.deepEqual(K.parsePartialJson('{"s":"\\u59'), { s: '' });
    assert.equal(K.parsePartialJson('{"captions":[{"sty'), null);
    assert.equal(K.parsePartialJson(''), null);
    assert.equal(K.repairJson('no json'), null);
});

test('費用估算', () => {
    assert.equal(K.estimateCost('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 }).usd, 3);
    assert.equal(K.estimateCost('claude-opus-5-5', { server_tool_use: { web_search_requests: 3 } }).usd, 0.03);
    assert.equal(K.estimateCost('unknown', { input_tokens: 1 }), null);
});

test('常用 Hashtag 整理', () => {
    assert.deepEqual(K.cleanHashtags('#台中美食 週末去哪,#台中美食  ##咖啡'), ['#台中美食', '#週末去哪', '#咖啡']);
    assert.deepEqual(K.cleanHashtags('#a#b'), ['#a', '#b']);
    assert.deepEqual(K.cleanHashtags(null), []);
    assert.equal(K.cleanHashtags(Array.from({ length: 20 }, (_, i) => 't' + i).join(' ')).length, 10);
});

test('錯誤訊息轉中文', () => {
    class APIError extends Error {}
    class AuthenticationError extends APIError {}
    const Fake = { APIError, AuthenticationError };
    assert.match(K.toUserError(new AuthenticationError('x'), Fake), /API Key 無效/);
    assert.match(K.toUserError(new APIError('x'), Fake), /暫時無法使用/);
    assert.equal(K.toUserError(new Error('自訂'), Fake), '自訂');
});

// 假的串流：照順序送出 content_block_start / delta，最後回傳 finalMessage
function fakeStreamClient(chunks, finalMessage) {
    return {
        beta: {
            messages: {
                stream() {
                    const handlers = [];
                    return {
                        on(name, fn) { if (name === 'streamEvent') handlers.push(fn); return this; },
                        async finalMessage() {
                            const emit = ev => handlers.forEach(h => h(ev));
                            emit({ type: 'content_block_start', content_block: { type: 'text', text: '' } });
                            for (const c of chunks) {
                                emit({ type: 'content_block_delta', delta: { type: 'text_delta', text: c } });
                                await new Promise(r => setTimeout(r, 80));
                            }
                            return finalMessage;
                        }
                    };
                }
            }
        }
    };
}

test('串流出單：邊收邊回報，最後回傳完整結果', async () => {
    const full = JSON.stringify({
        image_analysis: { summary: '鬆餅', subjects: [], visible_text: [], setting: '', mood: '', details: [] },
        alt_texts: ['一盤鬆餅', '多的會被截掉'],
        captions: [{ style: '幽默搞笑', caption: '鬆餅疊三層', translation: '' }]
    });
    const chunks = [full.slice(0, 40), full.slice(40, 120), full.slice(120)];
    const client = fakeStreamClient(chunks, {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: full }],
        usage: { input_tokens: 1000, output_tokens: 200 }
    });
    const partials = [];
    const result = await K.streamCaptions(client, { images: [img], model: 'claude-sonnet-5-5' }, p => partials.push(p));
    assert.ok(partials.length >= 2, `應該有多次部分結果，實際 ${partials.length}`);
    assert.equal(result.captions[0].caption, '鬆餅疊三層');
    assert.deepEqual(result.altTexts, ['一盤鬆餅']);
    assert.equal(result.cost.usd, 0.004);
});

test('串流出單：拒答時丟出中文錯誤並附上費用', async () => {
    const client = fakeStreamClient([], { stop_reason: 'refusal', content: [], usage: { input_tokens: 10, output_tokens: 0 } });
    await assert.rejects(K.streamCaptions(client, { images: [img] }), e => /無法處理/.test(e.message) && !!e.cost);
});

test('店家搜尋：pause_turn 會續跑，費用會加總', async () => {
    let calls = 0;
    const client = {
        beta: {
            messages: {
                async create(params) {
                    calls++;
                    assert.equal(params.tools[0].name, 'web_search');
                    if (calls === 1) return { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use' }], usage: { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 2 } } };
                    return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"found":true,"name":"小日子"}' }], usage: { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 1 } } };
                }
            }
        }
    };
    const r = await K.searchPlace(client, { placeName: '小日子', model: 'claude-haiku-5-5' });
    assert.equal(calls, 2);
    assert.equal(r.placeInfo.name, '小日子');
    assert.equal(r.cost.usd, 0.03);
    await assert.rejects(K.searchPlace(client, { placeName: ' ' }), /名稱/);
});
