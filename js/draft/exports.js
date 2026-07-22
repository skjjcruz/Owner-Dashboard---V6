// ══════════════════════════════════════════════════════════════════
// js/draft/exports.js — html2canvas PNG pick card generator
//
// Produces a 1080×1920-ish shareable card showing the user's draft
// picks, total DHQ, final grade, and headshot avatars for each pick.
// Rendered to a hidden DOM node, captured via html2canvas (loaded at
// index.html:924), and downloaded as a PNG.
//
// Depends on: html2canvas (global), styles.js
// Exposes:    window.DraftCC.exports.downloadDraftCard(state)
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL } = window.DraftCC.styles;

    async function downloadDraftCard(state) {
        try { await window.ensureHtml2Canvas?.(); } catch (e) { /* handled by guard below */ }
        if (typeof window.html2canvas !== 'function') {
            alert('html2canvas not loaded — cannot export PNG');
            return null;
        }

        const myPicks = state.picks.filter(p => p.rosterId === state.userRosterId || p.isUser);
        const grade = window.DraftCC.state.gradeDraft(myPicks, state.originalPool, { assessment: state.personas?.[state.userRosterId]?.assessment, variant: state.variant, leagueSize: state.leagueSize, rounds: state.rounds, budget: state.auctionBudget });
        const posColors = window.App?.POS_COLORS || {
            QB: 'var(--k-ff6b6b, #ff6b6b)', RB: 'var(--k-4ecdc4, #4ecdc4)', WR: 'var(--k-45b7d1, #45b7d1)', TE: 'var(--k-f7dc6f, #f7dc6f)',
            DL: 'var(--k-e67e22, #e67e22)', LB: 'var(--k-f0a500, #f0a500)', DB: 'var(--k-5dade2, #5dade2)', K: 'var(--k-bb8fce, #bb8fce)',
        };
        // The A–F grade on the share card is a Pro interpretation; the free card
        // keeps the raw haul (picks + total DHQ). Fail-open without pro-gate.js.
        const exPro = typeof window.wrIsPro !== 'function' || window.wrIsPro();
        const gradeCol =
            !exPro || grade.letter === '?' ? 'var(--k-95a5a6, #95a5a6)' :
            grade.letter.startsWith('A') ? 'var(--k-2ecc71, #2ecc71)' :
            grade.letter.startsWith('B') ? 'var(--k-d4af37, #d4af37)' :
            grade.letter.startsWith('C') ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';

        // Build a hidden DOM node (1080×1920 portrait)
        const card = document.createElement('div');
        card.style.cssText = `
            position: fixed;
            top: -9999px;
            left: -9999px;
            width: 1080px;
            height: 1920px;
            background: linear-gradient(180deg, var(--k-000000, #000000) 0%, var(--k-0a0a0a, #0a0a0a) 50%, var(--k-050505, #050505) 100%);
            color: var(--k-ffffff, #ffffff);
            font-family: ${FONT_UI};
            padding: 80px 60px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'text-align:center;margin-bottom:60px';
        header.innerHTML = `
            <div style="font-family:${FONT_DISPL};font-size:42px;font-weight:700;color:var(--k-d4af37, #d4af37);letter-spacing:0.12em;margin-bottom:8px">WAR ROOM</div>
            <div style="font-size:22px;color:var(--k-95a5a6, #95a5a6);letter-spacing:0.08em;text-transform:uppercase">Draft Command Center · ${state.season || ''}</div>
            <div style="width:120px;height:2px;background:var(--k-d4af37, #d4af37);margin:20px auto 0"></div>
        `;
        card.appendChild(header);

        // Grade hero
        const hero = document.createElement('div');
        hero.style.cssText = 'text-align:center;margin-bottom:50px';
        hero.innerHTML = exPro ? `
            <div style="font-size:22px;color:var(--k-d4af37, #d4af37);letter-spacing:0.16em;text-transform:uppercase;margin-bottom:14px">Draft Grade</div>
            <div style="font-family:${FONT_DISPL};font-size:260px;font-weight:700;color:${gradeCol};line-height:0.9;text-shadow:0 0 40px ${gradeCol}66">${grade.letter}</div>
            <div style="font-size:28px;color:var(--k-ffffff, #ffffff);margin-top:14px">
                ${grade.totalDHQ.toLocaleString()} total DHQ · ${myPicks.length} picks · ${grade.pct || 0}% value
            </div>
        ` : `
            <div style="font-size:22px;color:var(--k-d4af37, #d4af37);letter-spacing:0.16em;text-transform:uppercase;margin-bottom:14px">Draft Haul</div>
            <div style="font-family:${FONT_DISPL};font-size:120px;font-weight:700;color:var(--k-d4af37, #d4af37);line-height:1">${grade.totalDHQ.toLocaleString()}</div>
            <div style="font-size:28px;color:var(--k-ffffff, #ffffff);margin-top:14px">
                total DHQ · ${myPicks.length} picks
            </div>
        `;
        card.appendChild(hero);

        // Picks list
        const picksBox = document.createElement('div');
        picksBox.style.cssText = `
            flex: 1;
            background: var(--acc-fill1, rgba(212,175,55,0.04));
            border: 2px solid var(--acc-line2, rgba(212,175,55,0.3));
            border-radius: 16px;
            padding: 28px 32px;
            margin-bottom: 40px;
        `;
        const picksHeader = document.createElement('div');
        picksHeader.style.cssText = 'font-size:22px;color:var(--k-d4af37, #d4af37);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:18px;font-weight:700';
        picksHeader.textContent = 'Your Picks';
        picksBox.appendChild(picksHeader);

        myPicks.forEach((p, i) => {
            const col = posColors[p.pos] || 'var(--k-95a5a6, #95a5a6)';
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                align-items: center;
                padding: 14px 0;
                border-bottom: 1px solid var(--ov-4, rgba(255,255,255,0.06));
                font-size: 28px;
            `;
            row.innerHTML = `
                <span style="width:90px;color:var(--k-d4af37, #d4af37);font-weight:700">R${p.round}.${String(p.slot || 0).padStart(2, '0')}</span>
                <span style="flex:1;color:var(--k-ffffff, #ffffff);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name || '')}</span>
                <span style="padding:6px 14px;border-radius:10px;font-size:22px;font-weight:700;background:${col}22;color:${col};margin:0 18px">${p.pos || ''}</span>
                <span style="min-width:120px;text-align:right;color:${dhqCol(p.dhq)};font-weight:700;font-family:'JetBrains Mono',monospace">${(p.dhq || 0).toLocaleString()}</span>
            `;
            picksBox.appendChild(row);
        });
        card.appendChild(picksBox);

        // Footer
        const footer = document.createElement('div');
        footer.style.cssText = 'text-align:center;font-size:18px;color:var(--k-95a5a6, #95a5a6);opacity:0.7';
        footer.innerHTML = `
            <div>Mock Draft · ${state.mode || 'solo'} · ${state.rounds}R × ${state.leagueSize}T</div>
            <div style="margin-top:6px;font-size:var(--text-body, 1rem);opacity:0.5">warroom.skjjcruz.com</div>
        `;
        card.appendChild(footer);

        document.body.appendChild(card);

        try {
            const canvas = await window.html2canvas(card, {
                backgroundColor: 'var(--k-000000, #000000)',
                scale: 1,
                logging: false,
                useCORS: true,
            });

            // Download as PNG
            canvas.toBlob(blob => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `war-room-draft-${state.season || 'mock'}-${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 'image/png');

            return canvas;
        } catch (e) {
            if (window.wrLog) window.wrLog('exports.downloadDraftCard', e);
            alert('Export failed: ' + (e?.message || e));
            return null;
        } finally {
            if (card.parentNode) card.parentNode.removeChild(card);
        }
    }

    function dhqCol(dhq) {
        if (dhq >= 7000) return 'var(--k-2ecc71, #2ecc71)';
        if (dhq >= 4000) return 'var(--k-3498db, #3498db)';
        if (dhq >= 2000) return 'var(--k-d4af37, #d4af37)';
        return 'var(--k-95a5a6, #95a5a6)';
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.exports = { downloadDraftCard };
})();
