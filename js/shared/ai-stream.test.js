// Run with:  node --test js/shared/ai-stream.test.js
// Streaming Alex answers (shared supabase-client.js, vendored in
// reconai-shared/ from DHQ-Shared): OD.callAIStream asks ai-analyze for an SSE
// answer and hands text to the page as it is written; against a server that
// answers plain JSON (the live one until the streaming edge function ships, a
// cache hit, an error) it behaves exactly like OD.callAI. No network — fetch
// is stubbed with real ReadableStreams.
/* global Buffer, ReadableStream, Headers */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SHARED = path.join(__dirname, '..', '..', 'reconai-shared');
const IDENTITY_SRC = fs.readFileSync(path.join(SHARED, 'identity.js'), 'utf8');
const CLIENT_SRC = fs.readFileSync(path.join(SHARED, 'supabase-client.js'), 'utf8');
const DISPATCH_SRC = fs.readFileSync(path.join(SHARED, 'ai-dispatch.js'), 'utf8');

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const nowS = () => Math.floor(Date.now() / 1000);
const token = id => b64url({ alg: 'HS256' }) + '.' + b64url({ sub: id, iat: nowS(), exp: nowS() + 3600, app_metadata: { user_id: id, email: id + '@x.test', session_version: 1 } }) + '.sig';

function makeStore(seed) {
    const m = new Map(Object.entries(seed || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, key: i => Array.from(m.keys())[i] ?? null, get length() { return m.size; } };
}

// A fetch Response whose body streams the given text chunks.
function streamResponse(chunks, { status = 200, contentType = 'text/event-stream; charset=utf-8', failAfter } = {}) {
    const enc = new TextEncoder();
    let i = 0;
    const body = new ReadableStream({
        pull(c) {
            if (failAfter != null && i === failAfter) { c.error(new Error('connection reset')); return; }
            if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]));
            else c.close();
        },
    });
    return { status, ok: status >= 200 && status < 300, headers: new Headers({ 'Content-Type': contentType }), body, json: async () => { throw new Error('not json'); } };
}
function jsonResponse(obj, status = 200) {
    return { status, ok: status >= 200 && status < 300, headers: new Headers({ 'Content-Type': 'application/json' }), body: null, json: async () => obj };
}
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function load(respond, { withDispatch = false } = {}) {
    const calls = [];
    const ctx = {
        console: { log() {}, warn() {}, error() {}, info() {} },
        localStorage: makeStore({ fw_session_v1: { token: token('u1'), user: { id: 'u1', email: 'u1@x.test' } } }),
        sessionStorage: makeStore(),
        setTimeout, clearTimeout, setInterval: () => 0, AbortController, URL, TextEncoder, TextDecoder, Headers, ReadableStream,
        atob: s => Buffer.from(s, 'base64').toString('binary'),
        CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
        navigator: { userAgent: 'node', sendBeacon: () => true },
        document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, referrer: '', visibilityState: 'visible', title: '' },
        location: { href: 'http://localhost/index.html', pathname: '/index.html', search: '', hash: '', hostname: 'localhost', origin: 'http://localhost', reload() {} },
        addEventListener() {}, dispatchEvent() {},
        fetch: (url, opts) => {
            const body = opts && opts.body ? JSON.parse(opts.body) : null;
            calls.push({ url: String(url), opts, body });
            return Promise.resolve(/ai-analyze/.test(url) ? respond(body, opts) : jsonResponse({}));
        },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(IDENTITY_SRC, ctx);
    vm.runInContext(CLIENT_SRC, ctx);
    if (withDispatch) vm.runInContext(DISPATCH_SRC, ctx);
    return { ctx, OD: ctx.OD, calls };
}

test('SSE parser: chunk boundaries anywhere, \\r\\n and \\r endings, comments, multi-line data', () => {
    const { OD } = load(() => jsonResponse({}));
    const src = ': ok\r\n\r\nevent: delta\r\ndata: {"text":"Start "}\r\n\r\nevent: note\ndata: a\ndata: b\n\ndata:x\r\r';
    const p = OD._createSSEParser();
    const got = [];
    for (const ch of src) got.push(...p.push(ch));
    got.push(...p.flush());
    assert.deepEqual(JSON.parse(JSON.stringify(got)), [
        { event: 'delta', data: '{"text":"Start "}' },
        { event: 'note', data: 'a\nb' },
        { event: 'message', data: 'x' },
    ]);
});

test('callAIStream: asks for a stream, hands every delta over in order, resolves to the done payload', async () => {
    const env = load(() => streamResponse([
        ': ok\n\n',
        frame('meta', { provider: 'groq', model: 'm' }),
        frame('delta', { text: 'Start Waddle ' }).slice(0, 20), // split mid-frame
        frame('delta', { text: 'Start Waddle ' }).slice(20),
        frame('delta', { text: 'over Odunze.' }),
        frame('done', { analysis: 'Start Waddle over Odunze.', provider: 'groq', usage: { firstTokenMs: 210 } }),
    ]));
    const seen = [];
    let meta = null;
    const res = await env.OD.callAIStream({ type: 'start-sit', context: '{"messages":[]}', onDelta: (chunk, soFar) => seen.push([chunk, soFar]), onMeta: m => { meta = m; } });
    assert.equal(env.calls[0].body.stream, true);
    assert.equal(env.calls[0].body.type, 'start-sit');
    assert.match(env.calls[0].opts.headers.Accept, /event-stream/);
    assert.deepEqual(seen, [['Start Waddle ', 'Start Waddle '], ['over Odunze.', 'Start Waddle over Odunze.']]);
    assert.equal(meta.provider, 'groq');
    assert.equal(res.analysis, 'Start Waddle over Odunze.');
    assert.equal(res.usage.firstTokenMs, 210);
});

test('callAIStream: a JSON answer (live server, cache hit) resolves exactly like callAI, no deltas', async () => {
    const env = load(() => jsonResponse({ analysis: 'Cached note.', cached: true }));
    let deltas = 0;
    const res = await env.OD.callAIStream({ type: 'start-sit', context: '{}', onDelta: () => { deltas++; } });
    assert.equal(res.analysis, 'Cached note.');
    assert.equal(res.cached, true);
    assert.equal(deltas, 0);
});

test('callAIStream: server error event rejects with its message/status; partial text rides along', async () => {
    const env = load(() => streamResponse([frame('delta', { text: 'Start ' }), frame('error', { error: 'Groq API error 429', status: 500 })]));
    await assert.rejects(env.OD.callAIStream({ type: 'start-sit', context: '{}' }), (err) => {
        assert.equal(err.message, 'Groq API error 429');
        assert.equal(err.status, 500);
        assert.equal(err.partialText, 'Start ');
        return true;
    });
});

test('callAIStream: connection drops mid-answer → keeps the text that arrived; drops before any text → rejects', async () => {
    const partial = load(() => streamResponse([frame('delta', { text: 'You are favored.' }), 'never sent'], { failAfter: 1 }));
    const res = await partial.OD.callAIStream({ type: 'start-sit', context: '{}' });
    assert.equal(res.analysis, 'You are favored.');
    assert.equal(res.partial, true);
    const empty = load(() => streamResponse([], { failAfter: 0 }));
    await assert.rejects(empty.OD.callAIStream({ type: 'start-sit', context: '{}' }), /connection reset/);
});

test('callAIStream: HTTP errors match callAI (429 carries usage; 401 is "session ended")', async () => {
    const limited = load(() => jsonResponse({ error: 'Daily AI limit reached.', usage: { dailyRequests: 15 } }, 429));
    await assert.rejects(limited.OD.callAIStream({ type: 'start-sit', context: '{}' }), (err) => err.status === 429 && err.usage.dailyRequests === 15);
    const expired = load(() => jsonResponse({ error: 'Valid session token required.' }, 401));
    await assert.rejects(expired.OD.callAIStream({ type: 'start-sit', context: '{}' }), (err) => err.status === 401 && /session ended/i.test(err.message));
});

test('callAI is unchanged: never asks for a stream', async () => {
    const env = load(() => jsonResponse({ analysis: 'ok' }));
    const res = await env.OD.callAI({ type: 'start-sit', context: '{}' });
    assert.equal(res.analysis, 'ok');
    assert.equal(env.calls[0].body.stream, undefined);
});

test('callClaude lean+onDelta: streams, sends the prompt once (no userMessage/enrichment), lean system; default path unchanged', async () => {
    const env = load(() => streamResponse([frame('delta', { text: 'Hi.' }), frame('done', { analysis: 'Hi.' })]), { withDispatch: true });
    const got = [];
    const reply = await env.ctx.callClaude([{ role: 'user', content: 'facts' }], false, 2, 400, 'start-sit', { lean: true, system: 'You are Alex.', onDelta: c => got.push(c) });
    assert.equal(reply, 'Hi.');
    assert.deepEqual(got, ['Hi.']);
    const sent = JSON.parse(env.calls[0].body.context);
    assert.equal(env.calls[0].body.stream, true);
    assert.equal(sent.system, 'You are Alex.');
    assert.equal(sent.userMessage, undefined);
    assert.equal(sent.scoringSettings, undefined);
    assert.equal(sent.maxTokens, 400);
    assert.deepEqual(sent.messages, [{ role: 'user', content: 'facts' }]);

    const classic = load(() => jsonResponse({ analysis: 'ok' }), { withDispatch: true });
    await classic.ctx.callClaude([{ role: 'user', content: 'q' }], false, 2, 600, 'home-chat');
    const sentClassic = JSON.parse(classic.calls[0].body.context);
    assert.equal(classic.calls[0].body.stream, undefined);
    assert.equal(sentClassic.userMessage, 'q');
    assert.equal(classic.ctx.App.AI_ROUTES['start-sit'], 'fast', 'telemetry labels the note with its real tier');
});
