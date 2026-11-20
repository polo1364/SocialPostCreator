// 估算單次呼叫的費用（美元）。價格為 Anthropic 官方每百萬 tokens 牌價，可能隨時調整，僅供參考。
const PRICES = {
    'claude-opus-5-5': { input: 4, output: 20 },
    'claude-sonnet-5-5': { input: 2, output: 10 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5 }
};
const WEB_SEARCH_PER_REQUEST = 10 / 1000; // 每 1,000 次搜尋 10 美元

function estimateCost(model, usage) {
    const p = PRICES[model];
    if (!p || !usage) return null;
    const input = usage.input_tokens || 0;
    const output = usage.output_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const searches = usage.server_tool_use?.web_search_requests || 0;
    const usd = (input * p.input + cacheWrite * p.input * 1.25 + cacheRead * p.input * 0.1 + output * p.output) / 1e6
        + searches * WEB_SEARCH_PER_REQUEST;
    return {
        usd: Math.round(usd * 1e6) / 1e6,
        inputTokens: input + cacheWrite + cacheRead,
        outputTokens: output,
        searches
    };
}

module.exports = { PRICES, estimateCost };
