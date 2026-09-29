// Run with:  node --test js/shared/alex-answer-chip.test.js
// The "Alex answered" chip: shown when an answer lands after the owner left
// the screen that asked; one tap goes back; hidden once they are back.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, 'alex-answer-chip.js'), 'utf8');

function fakeDom() {
    function el(tag) {
        return {
            tag, children: [], style: {}, attrs: {}, parentNode: null, textContent: '', onclick: null,
            setAttribute(k, v) { this.attrs[k] = v; },
            appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
            removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; },
            get text() { return (this.textContent || '') + this.children.map(c => c.text || c.data || '').join(''); },
        };
    }
    const body = el('body');
    return { body, createElement: el, createTextNode: data => ({ data }) };
}

function load() {
    const listeners = {};
    const nav = [];
    const ctx = {
        document: fakeDom(), setTimeout: () => 0, clearTimeout: () => {},
        addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
        wrNavigateTab: tab => nav.push(tab),
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    const fire = (type, detail) => (listeners[type] || []).forEach(fn => fn({ detail }));
    return { ctx, fire, nav, chip: ctx.WR.AlexAnswerChip, body: ctx.document.body };
}

test('an answer landing elsewhere shows one chip; the latest replaces the previous', () => {
    const env = load();
    env.fire('wr:alex-answered', { tab: 'lineup', label: 'Alex answered your start/sit question' });
    env.fire('wr:alex-answered', { tab: 'lineup', label: 'Alex answered your start/sit question' });
    assert.equal(env.body.children.length, 1);
    assert.match(env.body.children[0].text, /ALEX · Alex answered your start\/sit question — View/);
    assert.equal(env.body.children[0].attrs['aria-live'], 'polite');
    assert.match(env.body.children[0].style.cssText, /var\(--card-radius-sm, 8px\)/, 'rounded identity via the token');
});

test('tapping it goes back to the tab that asked and clears the chip', () => {
    const env = load();
    env.fire('wr:alex-answered', { tab: 'lineup', label: 'x' });
    env.body.children[0].children[0].onclick();
    assert.deepEqual(env.nav, ['lineup']);
    assert.equal(env.body.children.length, 0);
});

test('returning to that tab hides it; another tab does not; × dismisses', () => {
    const env = load();
    env.fire('wr:alex-answered', { tab: 'lineup', label: 'x' });
    env.fire('wr:alex-answer-seen', { tab: 'trades' });
    assert.equal(env.body.children.length, 1);
    env.fire('wr:alex-answer-seen', { tab: 'lineup' });
    assert.equal(env.body.children.length, 0);
    env.fire('wr:alex-answered', { tab: 'lineup', label: 'x' });
    env.body.children[0].children[1].onclick();
    assert.equal(env.body.children.length, 0);
});

test('no tab → nothing shown', () => {
    const env = load();
    env.fire('wr:alex-answered', { label: 'x' });
    assert.equal(env.body.children.length, 0);
});
