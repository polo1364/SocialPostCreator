// 把串流中「還沒寫完」的 JSON 補上結尾後解析，讓前端能邊寫邊顯示。
// 補不起來（例如停在 key 或冒號後面）就回傳 null，等下一段文字再試。

function repairJson(text) {
    if (!text) return null;
    const start = text.indexOf('{');
    if (start === -1) return null;
    let s = text.slice(start);

    const stack = [];
    let inString = false;
    let escaped = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' || ch === ']') stack.pop();
    }

    if (inString) {
        if (escaped) s = s.slice(0, -1);
        // 跳脫序列 \uXXXX 寫到一半時先截掉
        s = s.replace(/\\u[0-9a-fA-F]{0,3}$/, '');
        s += '"';
    }
    s = s.replace(/[\s,]+$/, '');
    for (let i = stack.length - 1; i >= 0; i--) {
        s = s.replace(/[\s,]+$/, '');
        s += stack[i] === '{' ? '}' : ']';
    }
    return s;
}

function parsePartialJson(text) {
    const repaired = repairJson(text);
    if (!repaired) return null;
    try {
        return JSON.parse(repaired);
    } catch {
        return null;
    }
}

module.exports = { repairJson, parsePartialJson };
