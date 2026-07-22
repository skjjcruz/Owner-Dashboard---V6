// ══════════════════════════════════════════════════════════════════
// trade-calc.js — TradeCalcTab: Trade Desk (finder + builder), Owner DNA, Trade Log
// ══════════════════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════
    // TRADE CALCULATOR TAB — migrated from trade-calculator.html
    // ══════════════════════════════════════════════════════════════════════════

    // ── tcTab canonical surfaces + legacy alias map (Phase 2 nav re-cut) ──
    // Canonical values: 'desk' | 'dna' | 'log'. Every legacy value any producer
    // can still send (deep-link seeds, command mode, old handlers) maps here so
    // no entry point strands the user. Side effects for 'finder'/'analyzer'
    // (find-mode seed / builder-expanded) live in TradeCalcTab's setTcTab wrapper.
    const TC_TAB_ALIASES = { dealhq: 'desk', finder: 'desk', analyzer: 'desk', profiles: 'dna', inbox: 'log' };
    function normalizeTcTab(v) {
        if (v === 'desk' || v === 'dna' || v === 'log') return v;
        return TC_TAB_ALIASES[v] || 'desk';
    }

    // ── TcProTeaser — warroom-styled lock card for region-scoped Pro gates ──
    // Wraps pro-gate.js's wrLockCard (vanilla HTML string) for JSX surfaces.
    // Only ever rendered when wrIsPro() is false, which implies pro-gate.js
    // loaded — but degrade to a plain lock row if wrLockCard is missing.
    function TcProTeaser({ label, feature, sub }) {
        if (typeof window.wrLockCard === 'function') {
            return <div dangerouslySetInnerHTML={{ __html: window.wrLockCard(label, feature, sub) }} />;
        }
        return typeof window.WrGatedMoreRow === 'function'
            ? React.createElement(window.WrGatedMoreRow, { title: label, sub, feature })
            : null;
    }

    // ── WrTradePipeline — Trade Log pipeline store (Phase 5) ──
    // Canonical schema + cap for WR_KEYS.SAVED_TRADES rows, shared between the Trade
    // Desk/Trade Log (this file) and the Alex-chat trade-card Save button
    // (league-detail.js). trade-calc.js is a DEFERRED script (data-wr-defer="trade"),
    // so league-detail's writer feature-detects window.WrTradePipeline and falls back
    // to the legacy card shape, which normalizeAll migrates on the next Trade Log read.
    // Row schema: { id, createdAt, updatedAt, partnerOwnerId, partnerName,
    //   snapshot: { givePlayers, receivePlayers, givePicks, receivePicks, giveFaab,
    //               receiveFaab, totals, likelihood, grade, userGain },
    //   status: 'idea'|'saved'|'proposed'|'accepted'|'rejected'|'countered',
    //   outcome: null | { grudgeType, note, date }, source: 'trade-desk'|'alex-chat', notes }
    (function () {
        const CAP = 60;
        const STATUSES = ['idea', 'saved', 'proposed', 'accepted', 'rejected', 'countered'];
        const nowIso = () => new Date().toISOString();
        const genId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

        // Pipeline row from a finder/builder deal (buildDeal output or compatible flat shape).
        function fromDeal(deal, opts = {}) {
            deal = deal || {};
            const ts = nowIso();
            const status = opts.status || deal.status;
            return {
                id: deal.id || genId('deal'),
                createdAt: deal.createdAt || ts,
                updatedAt: ts,
                partnerOwnerId: deal.partnerOwnerId ?? null,
                partnerName: deal.partnerName || deal.partnerTeam || '',
                snapshot: {
                    givePlayers: deal.givePlayers || [],
                    receivePlayers: deal.receivePlayers || [],
                    givePicks: deal.givePicks || [],
                    receivePicks: deal.receivePicks || [],
                    giveFaab: deal.giveFaab || 0,
                    receiveFaab: deal.receiveFaab || 0,
                    totals: deal.totals || null,
                    likelihood: deal.likelihood ?? null,
                    grade: deal.grade ?? null,
                    userGain: deal.userGain ?? null,
                },
                status: STATUSES.includes(status) ? status : 'saved',
                outcome: deal.outcome || null,
                source: opts.source || deal.source || 'trade-desk',
                notes: deal.notes || '',
            };
        }

        // Pipeline row from an Alex-chat TRADE_CARD ({ target, yourSide, theirSide }).
        // Sides carry { name, dhq } only — no pids — so these rows summarize but
        // never offer Load-in-Builder. Grade via the shared fairness bands.
        function fromAlexCard(card, savedAt) {
            card = card || {};
            const sideTotal = side => (side || []).reduce((s, a) => s + (Number(a?.dhq) || 0), 0);
            const sideAssets = side => (side || []).map(a => ({ type: 'player', name: a?.name || '', value: Number(a?.dhq) || 0 }));
            const give = sideTotal(card.yourSide);
            const receive = sideTotal(card.theirSide);
            const fg = window.App?.TradeEngine?.fairnessGrade;
            const ts = new Date(savedAt || Date.now()).toISOString();
            return {
                id: genId('alex'),
                createdAt: ts,
                updatedAt: ts,
                partnerOwnerId: null,
                partnerName: card.target || '',
                snapshot: {
                    givePlayers: sideAssets(card.yourSide),
                    receivePlayers: sideAssets(card.theirSide),
                    givePicks: [], receivePicks: [], giveFaab: 0, receiveFaab: 0,
                    totals: { give: { total: give }, receive: { total: receive } },
                    likelihood: null,
                    grade: fg ? fg(give, receive).grade : null,
                    userGain: receive - give,
                },
                status: 'saved',
                outcome: null,
                source: 'alex-chat',
                notes: '',
            };
        }

        // Normalize any historical row shape to the schema. Returns null for garbage.
        function normalizeRow(row) {
            if (!row || typeof row !== 'object') return null;
            if (row.snapshot && typeof row.snapshot === 'object') {
                if (row.id && row.createdAt && row.updatedAt && row.source && STATUSES.includes(row.status)) return row;
                return {
                    ...row,
                    id: row.id || genId('deal'),
                    createdAt: row.createdAt || nowIso(),
                    updatedAt: row.updatedAt || row.createdAt || nowIso(),
                    status: STATUSES.includes(row.status) ? row.status : 'saved',
                    outcome: row.outcome || null,
                    source: row.source || 'trade-desk',
                    notes: row.notes || '',
                };
            }
            if (row.yourSide || row.theirSide) return fromAlexCard(row, row.savedAt);       // legacy Alex-chat rows
            if (row.givePlayers || row.receivePlayers || row.totals) return fromDeal(row);  // pre-Phase-5 flat saveDeal rows
            return null;
        }

        const rowTime = r => Date.parse(r?.updatedAt || r?.createdAt || '') || 0;

        // One-time read migration: list -> { rows, changed }. Dedupes by id, newest first.
        function normalizeAll(list) {
            const input = Array.isArray(list) ? list : [];
            const rows = [];
            const seen = new Set();
            for (const raw of input) {
                const row = normalizeRow(raw);
                if (!row || seen.has(row.id)) continue;
                seen.add(row.id);
                rows.push(row);
            }
            rows.sort((a, b) => rowTime(b) - rowTime(a));
            const changed = rows.length !== input.length || rows.some((r, i) => r !== input[i]);
            return { rows, changed };
        }

        function storageKey(leagueId) {
            const KEYS = window.App?.WR_KEYS || window.WR_KEYS;
            return KEYS?.SAVED_TRADES ? KEYS.SAVED_TRADES(leagueId) : `wr_saved_trades_${leagueId}`;
        }
        function readStore(leagueId) {
            const st = window.App?.WrStorage || window.WrStorage;
            const key = storageKey(leagueId);
            if (st?.get) return st.get(key, []) || [];
            try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
        }
        function writeStore(leagueId, rows) {
            const st = window.App?.WrStorage || window.WrStorage;
            const key = storageKey(leagueId);
            if (st?.set) st.set(key, rows);
            else localStorage.setItem(key, JSON.stringify(rows));
        }

        // Append a row (dedupe by id, newest first, capped). Returns the written array.
        function append(leagueId, row) {
            if (!leagueId || !row) return null;
            const { rows } = normalizeAll(readStore(leagueId));
            const next = [row, ...rows.filter(r => r.id !== row.id)].slice(0, CAP);
            writeStore(leagueId, next);
            return next;
        }

        window.WrTradePipeline = { CAP, STATUSES, fromDeal, fromAlexCard, normalizeRow, normalizeAll, append };
    })();

    // Grade letter → calm ledger color (shared bands: A=steal side, B=fair, C/D=loss, F=fleeced).
    function tcGradeColor(grade) {
        if (!grade || grade === '--') return 'var(--silver)';
        if (grade.startsWith('A')) return 'var(--win-green)';
        if (grade.startsWith('B')) return 'var(--gold)';
        if (grade === 'C' || grade === 'D') return 'var(--warn)';
        return 'var(--loss-red)';
    }

    // ── TcVerdictPanel — extracted from the retired analyzer surface (Step-1 refactor) ──
    // Pure presentational: takes already-computed deal-evaluation values and renders the verdict
    // headline, impact grid, posture/DNA chips, 8-factor psych-tax table, and likelihood bar.
    // Reused by the redesigned single-surface Context Rail's Verdict state.
    // One evaluator (Phase 1): the headline is the shared fairnessGrade — letter (big) +
    // label + numeric gain. Grade/label/diff/side-totals are FREE (Scout parity).
    // Tier split (Phase 2, owner ruling): grade/label/diff/side totals + raw roster-impact
    // values stay free; acceptance %, psych taxes, posture/DNA/behavior chips are Pro
    // (wrIsPro() only — never canAccess).
    function TcVerdictPanel({ verdictColor, diffDisplay, grade, totalA, totalB, rosterImpactLabel, starterValueDelta, pickCapitalDelta, pickQuantityDelta, faabDelta, FAAB_RATE, likelihoodColor, likelihood, netTaxTotal, manualBehaviorFit, otherOwnerId, theirPosture, otherDnaKey, otherDna, manualBehaviorProfile, psychTaxes, grudgeTax, gmFloor, gmModeLabel, gmViability, gmWarnings }) {
        const _pro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
        // Post-review: the 8-factor psych-tax table + approach line live behind a
        // collapsed-by-default 'Why? ▾' toggle (owner-approved wireframe) so the rail
        // Verdict card stays short enough to keep the DNA-mini card above the fold.
        const [whyOpen, setWhyOpen] = React.useState(false);
        return (
            <div className="tc-ta-verdict tc-ta-sticky-summary" id="wr-export-trade">
                <div className="tc-section-hdr" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>TRADE ANALYSIS<button onClick={() => window.wrExport?.capture(document.getElementById('wr-export-trade'), 'trade-analysis')} style={{ background:'none', border:'1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius:'4px', padding:'2px 8px', color:'var(--gold)', fontSize:'var(--text-micro, 0.6875rem)', cursor:'pointer', fontFamily: 'var(--font-body)', minHeight:'44px', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>Snapshot</button></div>
                <div style={{ display:'flex', alignItems:'baseline', gap:'0.6rem', flexWrap:'wrap' }}>
                    <span className="tc-verdict-diff" style={{ color: verdictColor }}>{grade?.grade || '--'}</span>
                    <span style={{ fontFamily:'var(--font-title)', fontSize:'1.1rem', color: verdictColor }}>{(grade?.label || '').toUpperCase()}</span>
                    <span style={{ fontFamily:'var(--font-mono)', fontSize:'1.05rem', fontWeight:600, color: verdictColor }}>{diffDisplay}</span>
                    <span style={{ fontSize:'0.74rem', color:'var(--silver)', opacity:0.655 }}>(gave {totalA.toLocaleString()} / received {totalB.toLocaleString()})</span>
                </div>
                <div className="tc-ta-impact-grid">
                    <div>
                        <span>Roster Impact</span>
                        <strong>{rosterImpactLabel}</strong>
                        <em>{starterValueDelta >= 0 ? '+' : ''}{Math.round(starterValueDelta).toLocaleString()} player DHQ</em>
                    </div>
                    <div>
                        <span>Pick Capital</span>
                        <strong>{pickCapitalDelta >= 0 ? '+' : ''}{Math.round(pickCapitalDelta).toLocaleString()}</strong>
                        <em>{pickQuantityDelta >= 0 ? '+' : ''}{pickQuantityDelta} picks</em>
                    </div>
                    <div>
                        <span>FAAB</span>
                        <strong>{faabDelta >= 0 ? '+' : ''}${faabDelta}</strong>
                        <em>{Math.round(faabDelta * FAAB_RATE).toLocaleString()} DHQ equiv.</em>
                    </div>
                    {_pro ? (
                        <div>
                            <span>Acceptance</span>
                            <strong style={{ color: likelihoodColor }}>{likelihood}%</strong>
                            <em>{netTaxTotal >= 0 ? '+' : ''}{netTaxTotal}% psych · {manualBehaviorFit ? `${manualBehaviorFit.acceptanceDelta >= 0 ? '+' : ''}${manualBehaviorFit.acceptanceDelta}% behavior` : '0% behavior'}</em>
                        </div>
                    ) : (
                        <div>
                            <span>Acceptance</span>
                            <strong style={{ color: 'var(--gold)' }}>{'🔒'} Pro</strong>
                            <em>psych-modeled odds</em>
                        </div>
                    )}
                </div>
                {_pro && otherOwnerId && (
                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                        <span style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.65 }}>Their posture:</span>
                        <span className="tc-posture-badge" style={{ color:theirPosture.color, borderColor:theirPosture.color, background:`${theirPosture.color}18` }}>{theirPosture.label}</span>
                        {otherDnaKey !== 'NONE' && <span className="tc-chip tc-chip-dna">{otherDna.label}</span>}
                        {(manualBehaviorProfile?.inferences || []).slice(0, 3).map(tag => <span key={tag} className="tc-chip">{tag.replace(/-/g, ' ')}</span>)}
                    </div>
                )}
                {!_pro && typeof window.WrGatedMoreRow === 'function' && (
                    React.createElement(window.WrGatedMoreRow, { title: 'Acceptance odds & trade psychology', sub: 'Accept %, the 8-factor psych-tax breakdown, and posture, DNA, and behavior reads are Pro.', feature: 'trade-psychology' })
                )}
                {_pro && <div>
                    <button type="button" className="tc-dhq-detail-toggle" onClick={() => setWhyOpen(v => !v)}>
                        {whyOpen ? 'Hide why ▴' : 'Why? ▾'}
                    </button>
                    {whyOpen && <div style={{ marginTop:'0.45rem', display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                    <div>
                    <div style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.65, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'0.35rem' }}>Psychological Tax Breakdown {React.createElement(Tip, null, 'Each owner\'s DNA type creates percentage-point acceptance modifiers beyond pure value. Taxes reduce likelihood, bonuses increase it. Factors: endowment effect, panic premium, status tax, loss aversion, rebuilding discount, need fulfillment, window alignment, and posture.')}</div>
                    <div className="tc-tax-table">
                        {psychTaxes.map((t,i) => (
                            <div key={i} className={`tc-tax-table-row ${t.type === 'BONUS' ? 'tc-bonus' : 'tc-tax'}`}>
                                <span className="tc-tax-name">{t.name}</span>
                                <span className="tc-tax-desc">{t.desc}</span>
                                <span className="tc-tax-val" style={{ color: t.impact > 0 ? 'var(--win-green)' : 'var(--loss-red)' }}>{t.impact > 0 ? '+' : ''}{t.impact}%</span>
                            </div>
                        ))}
                        {grudgeTax.total !== 0 && (
                            <div className={`tc-tax-table-row ${grudgeTax.total < 0 ? 'tc-tax' : 'tc-bonus'}`}>
                                <span className="tc-tax-name">Grudge Tax</span>
                                <span className="tc-tax-desc">{grudgeTax.entries.length} logged interaction{grudgeTax.entries.length!==1?'s':''}</span>
                                <span className="tc-tax-val" style={{ color: grudgeTax.total < 0 ? 'var(--loss-red)' : 'var(--win-green)' }}>{grudgeTax.total > 0 ? '+' : ''}{grudgeTax.total}%</span>
                            </div>
                        )}
                        {manualBehaviorFit && (
                            <div className={`tc-tax-table-row ${manualBehaviorFit.acceptanceDelta >= 0 ? 'tc-bonus' : 'tc-tax'}`}>
                                <span className="tc-tax-name">Observed Behavior</span>
                                <span className="tc-tax-desc">{manualBehaviorFit.framing || 'Trade history adjusted acceptance odds.'}</span>
                                <span className="tc-tax-val" style={{ color: manualBehaviorFit.acceptanceDelta >= 0 ? 'var(--win-green)' : 'var(--loss-red)' }}>{manualBehaviorFit.acceptanceDelta >= 0 ? '+' : ''}{manualBehaviorFit.acceptanceDelta}%</span>
                            </div>
                        )}
                        <div className="tc-tax-table-row tc-total">
                            <span className="tc-tax-name">NET MODIFIER</span>
                            <span className="tc-tax-desc">Folded into effective surplus</span>
                            <span className="tc-tax-val" style={{ color: netTaxTotal > 0 ? 'var(--win-green)' : netTaxTotal < 0 ? 'var(--loss-red)' : 'var(--silver)' }}>{netTaxTotal > 0 ? '+' : ''}{netTaxTotal}%</span>
                        </div>
                    </div>
                    </div>
                    {otherDnaKey !== 'NONE' && otherDna.strategy && (
                        <div style={{ fontSize:'0.76rem', color:otherDna.color, fontStyle:'italic', background:`${otherDna.color}0d`, border:`1px solid ${otherDna.color}25`, borderRadius:5, padding:'0.4rem 0.6rem' }}>Approach: {otherDna.strategy}</div>
                    )}
                    </div>}
                </div>}
                {_pro && <div>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.3rem' }}>
                        <span style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.7, textTransform:'uppercase', letterSpacing:'0.06em' }}>Likelihood of Acceptance {React.createElement(Tip, null, 'Their chance to accept — starts at 50%, then value difference plus psychological modifiers from DNA, posture, needs, window, and history. This is the OTHER owner\'s odds, not your bar to act.')}</span>
                        <span style={{ fontFamily:'var(--font-mono)', fontSize:'1.4rem', fontWeight:600, color: likelihoodColor }}>{likelihood}%</span>
                    </div>
                    <div className="tc-likelihood-bar-wrap" style={{ position:'relative' }}>
                        <div className="tc-likelihood-bar-fill" style={{ width:`${likelihood}%`, background: likelihoodColor }} />
                        {typeof gmFloor === 'number' && (
                            <div title={`Your GM bar to act: ${gmFloor}%`} style={{ position:'absolute', top:'-2px', bottom:'-2px', left:`${gmFloor}%`, width:'2px', background:'var(--gold)', boxShadow:'0 0 0 1px rgba(0,0,0,0.45)' }} />
                        )}
                    </div>
                    {(gmModeLabel || gmViability) && (
                        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginTop:'0.4rem', flexWrap:'wrap' }}>
                            {gmViability && (() => {
                                const vColor = gmViability === 'Playable' ? 'var(--win-green)' : gmViability === 'Negotiable' ? 'var(--warn)' : 'var(--loss-red)';
                                const vBg = gmViability === 'Playable' ? 'rgba(46,204,113,0.12)' : gmViability === 'Negotiable' ? 'rgba(230,176,40,0.12)' : 'rgba(231,76,60,0.12)';
                                return <span style={{ fontSize:'0.68rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', padding:'2px 8px', borderRadius:'4px', color:vColor, border:`1px solid ${vColor}`, background:vBg }}>{gmViability}</span>;
                            })()}
                            <span style={{ fontSize:'0.7rem', color:'var(--silver)', opacity:0.72 }}>
                                {gmModeLabel ? `${gmModeLabel} lens` : 'GM lens'} · your bar to act {typeof gmFloor === 'number' ? `${gmFloor}%` : '—'}
                                {React.createElement(Tip, null, 'Set by your GM Strategy (mode + aggression). Playable = clears your bar comfortably; Negotiable = near your bar; Moonshot = below your bar — long-shot leverage only. This is YOUR threshold for acting, distinct from their odds to accept above.')}
                            </span>
                        </div>
                    )}
                </div>}
                {/* GM Strategy warnings are the user's OWN strategy reads (untouchables, target/sell) — free at every tier. */}
                {gmWarnings && gmWarnings.length > 0 && (
                    <div style={{ marginTop:'0.45rem', display:'flex', flexDirection:'column', gap:'0.25rem' }}>
                        {gmWarnings.map((w, i) => (
                            <div key={i} style={{ fontSize:'0.7rem', color:'var(--loss-red)', display:'flex', alignItems:'center', gap:'0.35rem' }}>
                                <span style={{ opacity:0.9 }}>⚠</span>{w.text}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // ── TcDealCard — extracted from renderDealHQ (Step-1 refactor; no behavior change) ──
    // One generated deal package: send/receive summary, decision strip (grade/accept/Δ), and an
    // expandable why-drawer. Closures it used (sideSummary, loadDealIntoBuilder, saveDeal) are props.
    function TcDealCard({ deal, idx, actionFloor, expandedDealId, setExpandedDealId, loadDealIntoBuilder, saveDeal, sideSummary }) {
                const deltaColor = deal.userGain >= 0 ? 'var(--good)' : 'var(--bad)';
                const likelihoodColor2 = deal.likelihood >= actionFloor ? 'var(--good)' : deal.likelihood >= Math.max(55, actionFloor - 15) ? 'var(--warn)' : 'var(--bad)';
                const expanded = expandedDealId === deal.id;
                const whyView = typeof window.App?.Intelligence?.buildWhyView === 'function'
                    ? window.App.Intelligence.buildWhyView(deal.intelligence, { title: 'Why this trade', limit: 4 })
                    : null;
                const whyLines = whyView?.lines || (typeof window.App?.Intelligence?.recommendationWhyLines === 'function'
                    ? window.App.Intelligence.recommendationWhyLines(deal.intelligence, 4)
                    : []);
                return <div key={deal.id} className={`tc-dhq-deal-card${idx === 0 ? ' tc-dhq-top-deal' : ''}`}>
                    <div className="tc-dhq-deal-top">
                        <div>
                            <h3>{deal.partnerName}</h3>
                        </div>
                        <div className="tc-dhq-actions">
                            <button onClick={() => loadDealIntoBuilder(deal)}>Load in Builder</button>
                            <button onClick={() => saveDeal(deal)}>Save</button>
                        </div>
                    </div>
                    <div className="tc-dhq-deal-grid">
                        {sideSummary('You Send', deal, 'give')}
                        {sideSummary('You Get', deal, 'receive')}
                    </div>
                    <div className="tc-dhq-decision-strip">
                        <div className="tc-dhq-decision">
                            <span>Grade</span>
                            <strong style={{ color:deal.gradeColor }}>{deal.grade}</strong>
                        </div>
                        <div className="tc-dhq-decision">
                            <span>Accept %</span>
                            <strong style={{ color:likelihoodColor2 }}>{deal.likelihood}%</strong>
                        </div>
                        <div className="tc-dhq-decision">
                            <span>DHQ Delta</span>
                            <strong style={{ color:deltaColor }}>{deal.userGain >= 0 ? '+' : ''}{Math.round(deal.userGain).toLocaleString()}</strong>
                        </div>
                    </div>
                    <button className="tc-dhq-detail-toggle" onClick={() => setExpandedDealId(expanded ? null : deal.id)}>
                        {expanded ? 'Hide why ▴' : 'Why ▾'}
                    </button>
                    {expanded && <div className="tc-dhq-detail-drawer">
                        <div className="tc-dhq-stat-bar">
                            <div className="tc-dhq-stat">
                                <span>Fit</span>
                                <strong>{deal.fit}%</strong>
                            </div>
                            <div className="tc-dhq-stat">
                                <span>Lane</span>
                                <strong style={{ color:deal.viability === 'Moonshot' ? 'var(--bad)' : deal.viability === 'Negotiable' ? 'var(--warn)' : 'var(--good)' }}>{deal.viability || deal.windowImpact.label.replace(/^Window\s*/i, '')}</strong>
                            </div>
                            <div className="tc-dhq-stat">
                                <span>Window</span>
                                <strong style={{ color:deal.windowImpact.color }}>{deal.windowImpact.label.replace(/^Window\s*/i, '')}</strong>
                            </div>
                        </div>
                        <div className="tc-dhq-readout">
                            <div><b>Accept:</b><span>{deal.whyAccept}</span></div>
                            <div><b>You:</b><span>{deal.whyYou}</span></div>
                            <div><b>Swing:</b><span>{deal.swing}</span></div>
                            {deal.formatReadout && <div><b>Format:</b><span>{deal.formatReadout}</span></div>}
                            {deal.behaviorReadout && <div><b>Behavior:</b><span>{deal.behaviorReadout}</span></div>}
                        </div>
                        {whyLines.length > 0 && <div className="tc-dhq-evidence">{whyLines.slice(0, 4).map(line => <span key={line}>{line}</span>)}</div>}
                        {deal.caution.length > 0 && <div className="tc-dhq-cautions">{deal.caution.slice(0, 3).map(c => <span key={c}>{c}</span>)}</div>}
                    </div>}
                </div>;
    }

    // ── TcTradeSide — extracted from the retired analyzer surface (builder rework; no behavior change) ──
    // One side of the manual builder: owner select, added players/picks with value bars, a roster
    // picker, FAAB input, and a side total. ~29 deps (state, setters, helper closures, value fns)
    // passed via a tradeSideDeps bag. The new persistent-builder layout will refine this contract.
    function TcTradeSide({ side, color, label, tradeIds, tradePickIds, tradeFaab, getPlayerValue, pickValueForParts, FAAB_RATE, rosterPlayersFor, tradeOwner, picksByOwner, comparePicksByDraftOrder, setTradeOwner, setSearchText, ownerOptions, playersData, MAX_VALUE, removePlayer, posColor, normPos, PICK_COLORS, ownerNameForRosterId, allRosters, removePick, pickLabel, searchText, TC_POS_ORDER, addPlayer, makePickId, addPick, setTradeFaab }) {
                const ids = tradeIds[side];
                const pickIds = tradePickIds[side];
                const faab = tradeFaab[side] || 0;
                const tot = ids.reduce((s, id) => s + (getPlayerValue(id).value || 0), 0)
                    + pickIds.reduce((s, pkId) => { const p = pkId.split('-'); const sl = (p[4] || '').charAt(0) === 's' ? Number(p[4].slice(1)) : null; return s + pickValueForParts(p[1], Number(p[2]), p[3], sl); }, 0)
                    + Math.round(faab * FAAB_RATE);
                const rosterPlayers = rosterPlayersFor(side);
                const ownerId = tradeOwner[side] || null;
                const ownerPicksList = ownerId ? (picksByOwner[ownerId] || []).slice().sort(comparePicksByDraftOrder) : [];
                // The roster filter also searches draft picks so a specific pick is
                // easy to find: matches the label ("2026 1.13"), round ("r1", "round 1"),
                // slot/year, or the team a pick came "via".
                const pickQuery = (searchText[side] || '').toLowerCase().trim();
                const filteredPicks = !pickQuery ? ownerPicksList : ownerPicksList.filter(p => {
                    const lbl = pickLabel(p.year, p.round, p.fromRosterId, p.slot);
                    const via = ownerNameForRosterId(p.fromRosterId) || '';
                    const ord = p.round === 1 ? '1st' : p.round === 2 ? '2nd' : p.round === 3 ? '3rd' : p.round + 'th';
                    const hay = `${lbl} round ${p.round} r${p.round} ${ord} ${p.round}${p.slot != null ? '.' + String(p.slot).padStart(2, '0') : ''} ${via}`.toLowerCase();
                    return hay.includes(pickQuery);
                });

                return (
                    <div className={`tc-ta-side tc-side-${side.toLowerCase()}`}>
                        <span style={{ fontFamily:'var(--font-title)', fontSize:'0.95rem', color, letterSpacing:'0.08em' }}>{label}</span>
                        <select className="tc-ta-owner-select" value={tradeOwner[side] || ''} onChange={e => { setTradeOwner(prev => ({ ...prev, [side]: e.target.value || null })); setSearchText(prev => ({ ...prev, [side]: '' })); }}>
                            {ownerOptions.map(o => <option key={o.id||'none'} value={o.id||''}>{o.label}</option>)}
                        </select>

                        {/* Added players */}
                        {ids.map(pid => {
                            const p = playersData[pid]; const v = getPlayerValue(pid);
                            const pct = Math.round((v.value / MAX_VALUE) * 100);
                            if (!p) return null;
                            return (
                                <div key={pid} className="tc-ta-player-row">
                                    <button className="tc-ta-remove" onClick={() => removePlayer(side, pid)}>X</button>
                                    <span className="tc-ta-pos-dot" style={{ background: posColor(normPos(p.position)) }} />
                                    <span style={{ flex:1, fontSize:'0.82rem', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.first_name} {p.last_name}</span>
                                    <div className="tc-ta-val-col" style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2 }}>
                                        <div className="tc-ta-val-bar-wrap"><div className="tc-ta-val-bar-fill" style={{ width:`${pct}%`, background: color }} /></div>
                                        <span style={{ fontSize:'0.7rem', fontWeight:700, color }}>{v.value > 0 ? v.value.toLocaleString() : '--'}</span>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Added picks */}
                        {pickIds.map(pkId => {
                            const parts = pkId.split('-');
                            const yr = parts[1], rd = Number(parts[2]), fromRid = parts[3];
                            const slot = (parts[4] || '').charAt(0) === 's' ? Number(parts[4].slice(1)) : null;
                            const val = pickValueForParts(yr, rd, fromRid, slot);
                            const pct = Math.round((val / MAX_VALUE) * 100);
                            const pickColor = PICK_COLORS[rd] || 'var(--silver)';
                            const via = ownerNameForRosterId(fromRid);
                            const isOwn = !via || (ownerId && (() => { const r = allRosters.find(x => x.owner_id === ownerId); return r && String(r.roster_id) === String(fromRid); })());
                            return (
                                <div key={pkId} className="tc-ta-player-row">
                                    <button className="tc-ta-remove" onClick={() => removePick(side, pkId)}>X</button>
                                    <span className="tc-ta-pos-dot" style={{ background: pickColor }} />
                                    <span style={{ flex:1, fontSize:'0.82rem', fontWeight:600 }}>{pickLabel(yr, rd, fromRid, slot)}{!isOwn && via && <span style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.6, marginLeft:'0.3rem' }}>via {via}</span>}</span>
                                    <div className="tc-ta-val-col" style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2 }}>
                                        <div className="tc-ta-val-bar-wrap"><div className="tc-ta-val-bar-fill" style={{ width:`${pct}%`, background: pickColor }} /></div>
                                        <span style={{ fontSize:'0.7rem', fontWeight:700, color: pickColor }}>{val.toLocaleString()}</span>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Roster picker */}
                        {tradeOwner[side] && rosterPlayers !== null ? (
                            <div>
                                <input className="tc-ta-roster-filter" placeholder={`Filter ${rosterPlayers.length} players & ${ownerPicksList.length} picks...`} value={searchText[side]} onChange={e => setSearchText(prev => ({ ...prev, [side]: e.target.value }))} />
                                <div className="tc-ta-roster-list-tall">
                                    {rosterPlayers.length > 0 && (() => {
                                        const grouped = {};
                                        rosterPlayers.forEach(r => { if (!grouped[r.pos]) grouped[r.pos] = []; grouped[r.pos].push(r); });
                                        return Object.entries(grouped).sort((a,b) => (TC_POS_ORDER[a[0]]??9)-(TC_POS_ORDER[b[0]]??9)).map(([pos, posPlayers]) => (
                                            <div key={pos}>
                                                <div className="tc-ta-pos-group-hdr" style={{ color: posColor(pos) }}>{pos}</div>
                                                {posPlayers.map(r => {
                                                    const added = ids.includes(r.id);
                                                    return (
                                                        <div key={r.id} className={`tc-ta-roster-item${added?' tc-added':''}`} onClick={() => !added && addPlayer(side, r.id)}>
                                                            <span className="tc-ta-pos-dot" style={{ background: posColor(r.pos) }} />
                                                            <span style={{ flex:1, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.name}</span>
                                                            <span className="tc-ta-player-meta">{r.team}</span>
                                                            <span className="tc-ta-player-val">{r.value > 0 ? r.value.toLocaleString() : '--'}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ));
                                    })()}
                                    {filteredPicks.length > 0 && (
                                        <div style={{ marginTop:'0.5rem', borderTop:'1px solid var(--acc-line1, rgba(212,175,55,0.2))', paddingTop:'0.4rem' }}>
                                            <div className="tc-ta-pos-group-hdr" style={{ color:'var(--gold)' }}>DRAFT PICKS{pickQuery && ownerPicksList.length !== filteredPicks.length ? ` (${filteredPicks.length}/${ownerPicksList.length})` : ''}</div>
                                            {filteredPicks.map(({ year, round, fromRosterId, slot }) => {
                                                const pkId = makePickId(year, round, fromRosterId) + (slot != null ? '-s' + slot : '');
                                                const added = pickIds.includes(pkId);
                                                const val = pickValueForParts(year, round, fromRosterId, slot);
                                                const pickColor = PICK_COLORS[round] || 'var(--silver)';
                                                const via = ownerNameForRosterId(fromRosterId);
                                                const r2 = allRosters.find(x => x.owner_id === ownerId);
                                                const isOwn2 = r2 && String(r2.roster_id) === String(fromRosterId);
                                                return (
                                                    <div key={pkId} className={`tc-ta-roster-item${added?' tc-added':''}`} onClick={() => !added && addPick(side, pkId)}>
                                                        <span className="tc-ta-pos-dot" style={{ background: pickColor }} />
                                                        <span className="tc-ta-pick-name" style={{ flex:1, fontWeight:600 }}>{pickLabel(year, round, fromRosterId, slot)}{!isOwn2 && via && <span style={{ fontSize:'0.74rem', color:'var(--silver)', opacity:0.6, marginLeft:'0.3rem' }}>via {via}</span>}</span>
                                                        <span className="tc-ta-player-val" style={{ color: pickColor }}>{val.toLocaleString()}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {rosterPlayers.length === 0 && filteredPicks.length === 0 && (
                                        <div className="tc-ta-roster-empty">No players or picks match{pickQuery ? ` "${searchText[side]}"` : ''}</div>
                                    )}
                                </div>
                            </div>
                        ) : <div style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.6, textAlign:'center', padding:'0.5rem' }}>Select an owner above to view their roster</div>}

                        {/* FAAB */}
                        <div style={{ borderTop:'1px solid var(--ov-4, rgba(255,255,255,0.06))', paddingTop:'0.4rem', marginTop:'0.2rem' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                                <span style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--win-green)', letterSpacing:'0.05em' }}>FAAB $</span>
                                <input type="number" min={0} value={faab || ''} onChange={e => setTradeFaab(prev => ({ ...prev, [side]: Math.max(0, Number(e.target.value)) }))} placeholder="0"
                                    style={{ width:70, background:'rgba(0,0,0,0.3)', border:'1px solid rgba(46,204,113,0.35)', color:'var(--win-green)', padding:'0.2rem 0.4rem', borderRadius:4, fontSize:'0.75rem', fontWeight:700, minHeight:'44px' }} />
                                {faab > 0 && <button className="tc-ta-remove" onClick={() => setTradeFaab(prev => ({ ...prev, [side]: 0 }))}>X</button>}
                            </div>
                            {faab > 0 && <div style={{ fontSize:'0.7rem', color:'var(--silver)', opacity:0.6, marginTop:'0.2rem' }}>= {Math.round(faab * FAAB_RATE).toLocaleString()} dynasty pts</div>}
                        </div>

                        {/* Total */}
                        <div className="tc-ta-total-row" style={{ background:`${color}12`, border:`1px solid ${color}30` }}>
                            <span className="tc-ta-total-label">Total Value</span>
                            <span className="tc-ta-total-val" style={{ color }}>{tot > 0 ? tot.toLocaleString() : '--'}</span>
                        </div>
                    </div>
                );
    }

    function TradeCalcTab({ playersData, statsData, myRoster, standings, currentLeague, leagueSkin, sleeperUserId, timeRecomputeTs, viewMode, initialSubTab, onSubTabConsumed }) {
        // ── Constants ──
        const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
        // Redraft → build rest-of-season values so deal pricing uses ROS instead
        // of dynasty DHQ. No-op (falls back to DHQ) for dynasty/keeper leagues.
        React.useMemo(() => {
            try {
                window.App?.PlayerValue?.ensureRos?.({
                    leagueId: currentLeague?.league_id || currentLeague?.id,
                    league: currentLeague, playersData, statsData, skin: resolvedLeagueSkin,
                });
            } catch (e) { if (window.wrLog) window.wrLog('trade.ensureRos', e); }
            return null;
        }, [currentLeague, playersData, statsData, timeRecomputeTs]);
        const skinVocabulary = resolvedLeagueSkin?.vocabulary || {};
        const valueSourceLabel = resolvedLeagueSkin?.features?.showDynastyValue === false ? 'format-adjusted values' : 'dynasty valuations';
        let WEEKLY_TARGET = 243;
        // Shared roster-construction constants from window.App.PlayerValue
        const { IDEAL_ROSTER, DRAFT_ROUNDS, PICK_HORIZON,
                LINEUP_STARTERS, MIN_STARTER_QUALITY, NFL_STARTER_POOL,
                POS_PT_TARGETS, POS_WEIGHTS, TOTAL_WEIGHT,
                PICK_VALUES, PICK_VALUES_BY_SLOT, PICK_COLORS, resolvePickValue: _resolvePickValue } = window.App.PlayerValue;
        const TC_POS_ORDER = { QB:0, RB:1, WR:2, TE:3, K:4, DL:5, LB:6, DB:7 };
        const MAX_VALUE = 10000;
        const FAAB_RATE = 2.0;

        const FLEX_ALLOWED = {
            REC_FLEX:['WR','TE'], FLEX:['RB','WR','TE'], WRTQ:['QB','RB','WR','TE'],
            SUPER_FLEX:['QB','RB','WR','TE'], IDP_FLEX:['DL','LB','DB'],
            WILDCARD:['QB','RB','WR','TE','K','DEF','DL','LB','DB'],
        };

        const DNA_TYPES = {
            NONE: { label: '— Not Set —', color: 'var(--silver)', desc: '', taxes: [] },
            FLEECER: { label: 'The Fleecer', color: 'var(--k-e74c3c, #e74c3c)', desc: 'High activity, always hunting asymmetric value. Sends lowball offers constantly. Sharp but impatient — will counter-offer if you decline.', strategy: 'Lead with clean surplus. They respect boldness, but the math still moves linearly.', taxes: ['Endowment -5%', 'Surplus hunter'] },
            DOMINATOR: { label: 'The Dominator', color: 'var(--k-e67e22, #e67e22)', desc: 'High ego, requires visible surplus to pull the trigger. Motivated by status and bragging rights above all else.', strategy: 'Frame your offer as giving them the "better" side. Let them feel like they won.', taxes: ['Status Tax -18%', 'Endowment -14%', 'Loss Aversion -8%'] },
            STALWART: { label: 'The Stalwart', color: 'var(--k-5dade2, #5dade2)', desc: 'High stability, emotionally attached to their roster. Slow to move but reliable when they engage.', strategy: 'Lead with clear value. Never low-ball. Highlight how the trade improves both sides.', taxes: ['Endowment -10%', 'Loss Aversion -8%'] },
            ACCEPTOR: { label: 'The Acceptor', color: 'var(--k-2ecc71, #2ecc71)', desc: 'Low attachment, willing to sell current assets for future picks and young players. Rebuilding or just indifferent.', strategy: 'Offer future assets (picks, young upside). They discount current stars through the tax layer.', taxes: ['Rebuilding Discount +10%', 'Endowment -3%'] },
            DESPERATE: { label: 'The Desperate', color: 'var(--k-bb8fce, #bb8fce)', desc: 'High urgency triggered by injuries, bye-weeks, or playoff push. Will overpay for an immediate starter.', strategy: 'Identify their empty slot or injury. Strike fast — desperation fades after their bye.', taxes: ['Panic Premium +14% to +26%', 'Endowment -8%'] },
        };

        const GRUDGE_TYPES = window.App?.TradeEngine?.GRUDGE_TYPES || {
            ACCEPTED_FAIR: { label:'Accepted — Fair Trade', impact:+5, color:'var(--k-2ecc71, #2ecc71)', icon:'OK', cat:'accepted', dnaSignal:{ STALWART:3 } },
            ACCEPTED_WON:  { label:'Accepted — Fleeced Them', impact:-8, color:'var(--k-e67e22, #e67e22)', icon:'UP', cat:'accepted', dnaSignal:{ FLEECER:3, DOMINATOR:1 } },
            ACCEPTED_LOST: { label:'Accepted — Got Fleeced', impact:+10, color:'var(--k-bb8fce, #bb8fce)', icon:'DN', cat:'accepted', dnaSignal:{ ACCEPTOR:3, DESPERATE:2 } },
            REJECTED:      { label:'Rejected', impact:-15, color:'var(--k-e74c3c, #e74c3c)', icon:'X', cat:'rejected', dnaSignal:{ DOMINATOR:3, FLEECER:1 } },
            COUNTER_FAIR:  { label:'Counter — Fair', impact:+3, color:'var(--k-5dade2, #5dade2)', icon:'<>', cat:'counter', dnaSignal:{ STALWART:2, FLEECER:1 } },
            COUNTER_LOWBALL:{ label:'Counter — Lowball', impact:-10, color:'var(--k-e67e22, #e67e22)', icon:'v', cat:'counter', dnaSignal:{ FLEECER:3, DOMINATOR:2 } },
        };

        const POSTURES = window.App?.TradeEngine?.POSTURES || {
            DESPERATE: { key:'DESPERATE', label:'Desperate', color:'var(--k-bb8fce, #bb8fce)', desc:'Panic-mode — will overpay for immediate help.' },
            BUYER:     { key:'BUYER',     label:'Active Buyer', color:'var(--k-f0a500, #f0a500)', desc:'Contender upgrading — open to deals.' },
            NEUTRAL:   { key:'NEUTRAL',   label:'Neutral', color:'var(--k-95a5a6, #95a5a6)', desc:'No strong push. Fair offers only.' },
            SELLER:    { key:'SELLER',    label:'Active Seller', color:'var(--k-5dade2, #5dade2)', desc:'Moving assets for futures.' },
            LOCKED:    { key:'LOCKED',    label:'Locked In', color:'var(--k-7f8c8d, #7f8c8d)', desc:'Satisfied roster, high attachment.' },
        };

        // ── Helper functions ──
        const normPos = window.App.normPos;
        function posColor(pos) {
            const c = { QB:'var(--k-ff6b6b, #ff6b6b)', RB:'var(--k-4ecdc4, #4ecdc4)', WR:'var(--k-45b7d1, #45b7d1)', TE:'var(--k-f7dc6f, #f7dc6f)', K:'var(--k-bb8fce, #bb8fce)', DL:'var(--k-e67e22, #e67e22)', LB:'var(--warn)', DB:'var(--info)' };
            return c[pos] || 'var(--silver)';
        }
        function avatarUrl(id) { return id ? `https://sleepercdn.com/avatars/thumbs/${id}` : null; }
        // Memoized: buildLeagueProfile returns a fresh object, and this value feeds
        // teamContextByRosterId → finderDataEpoch. Computing it inline every render
        // churned the epoch on every render, which cancelled-and-restarted the
        // league scan effect before a single partner could be scanned (stuck 0/N).
        const leagueProfile = useMemo(() => (
            typeof window.App?.Intelligence?.buildLeagueProfile === 'function'
                ? window.App.Intelligence.buildLeagueProfile({ league: currentLeague, rosters: currentLeague?.rosters || [], platform: currentLeague?._platform })
                : null
        ), [currentLeague, currentLeague?.rosters, currentLeague?._platform, timeRecomputeTs]);
        const leagueFormatBadges = leagueProfile && typeof window.App?.Intelligence?.buildFormatBadges === 'function'
            ? window.App.Intelligence.buildFormatBadges(leagueProfile)
            : [];

        const calcPPG = (pid, scoring) => window.App.calcPPG(statsData[pid], scoring);
        function calcSeasonPts(pid, scoring) {
            const s = statsData[pid]; if (!s) return 0;
            const total = window.App.calcRawPts(s, scoring);
            return total !== null ? Math.max(0, total) : 0;
        }
        function parseStarterSlots(rosterPositions) {
            const slots = {};
            for (const s of (rosterPositions || [])) { if (s === 'BN' || s === 'TAXI') continue; slots[s] = (slots[s] || 0) + 1; }
            return slots;
        }
        function calcOptimalLineup(playerIds, reserve, taxi, scoring, rosterPositions) {
            const resSet = new Set(reserve || []); const taxiSet = new Set(taxi || []);
            const active = playerIds.filter(id => !resSet.has(id) && !taxiSet.has(id)).map(id => {
                const p = playersData[id]; if (!p) return null;
                return { id, np: normPos(p.position), ppg: calcPPG(id, scoring) };
            }).filter(Boolean).sort((a,b) => b.ppg - a.ppg);
            const slots = parseStarterSlots(rosterPositions);
            let total = 0; const used = new Set();
            for (const slot of ['QB','RB','WR','TE','K','DL','LB','DB','DEF']) {
                const count = slots[slot] || 0; let filled = 0;
                for (const p of active) { if (filled >= count) break; if (!used.has(p.id) && p.np === slot) { total += p.ppg; used.add(p.id); filled++; } }
            }
            for (const [slot, allowed] of Object.entries(FLEX_ALLOWED)) {
                const count = slots[slot] || 0;
                for (let i = 0; i < count; i++) { for (const p of active) { if (!used.has(p.id) && allowed.includes(p.np)) { total += p.ppg; used.add(p.id); break; } } }
            }
            return Math.round(total * 10) / 10;
        }

        function computeWeeklyTarget(rosters) {
            const scoring = currentLeague.scoring_settings;
            const rosterPositions = currentLeague.roster_positions;
            const ppgs = rosters.map(r => calcOptimalLineup(r.players || [], r.reserve || [], r.taxi || [], scoring, rosterPositions)).filter(v => v > 0).sort((a,b) => a - b);
            if (!ppgs.length) return 150;
            return Math.round(ppgs[Math.floor(ppgs.length / 2)] * 1.05);
        }

        function calcNflStarterSet() {
            const scoring = currentLeague.scoring_settings;
            const byPos = {};
            for (const [id, p] of Object.entries(playersData)) {
                const pos = normPos(p.position);
                if (!pos || !(pos in NFL_STARTER_POOL)) continue;
                if (!p.team) continue;
                if (!byPos[pos]) byPos[pos] = [];
                const score = calcSeasonPts(id, scoring);
                if (score > 0) byPos[pos].push({ id, score });
            }
            const result = {};
            for (const [pos, players] of Object.entries(byPos)) {
                const poolSize = NFL_STARTER_POOL[pos];
                result[pos] = new Set(players.sort((a,b) => b.score - a.score).slice(0, poolSize).map(p => p.id));
            }
            return result;
        }

        function getPlayerValue(pid) {
            if (window.App?.PlayerValue?.getValue) {
                const v = window.App.PlayerValue.getValue(pid, { skin: resolvedLeagueSkin });
                if (v > 0) {
                    const isRos = resolvedLeagueSkin?.type === 'redraft' && window.App.PlayerValue.rosState && window.App.PlayerValue.rosState();
                    return { value: v, source: isRos ? 'ros' : 'dhq' };
                }
            }
            const dhqScore = window.App?.LI?.playerScores?.[pid];
            if (dhqScore != null && dhqScore > 0) return { value: dhqScore, source: 'dhq' };
            return { value: 0, source: 'none' };
        }
        const getPickValue = window.App.PlayerValue.getPickValue;

        // ── Trade liquidity — the market-reality layer (owner ruling, Jul 20) ──
        // DHQ scores measure LINEUP value; the trade market pays for scarcity.
        // IDP and K production is streamable, so mid-tier IDP/K trades far below
        // its points value — only the elite tier (the Parsons/Garrett class)
        // holds full price. The FINDER matches packages and prices acceptance on
        // liquidity-adjusted ("market") totals; every displayed number stays raw
        // DHQ, and the manual builder is untouched (the user controls both sides).
        const LOW_LIQUIDITY_POS = ['DL', 'LB', 'DB'];
        const idpRankByPid = useMemo(() => {
            const scores = window.App?.LI?.playerScores || {};
            const byPos = { DL: [], LB: [], DB: [] };
            Object.keys(scores).forEach(pid => {
                const p = playersData[pid];
                if (!p) return;
                const pos = normPos(p.position) || p.position;
                if (byPos[pos]) byPos[pos].push([String(pid), scores[pid] || 0]);
            });
            const rank = new Map();
            Object.values(byPos).forEach(list => {
                list.sort((a, b) => b[1] - a[1]);
                list.forEach(([pid], i) => rank.set(pid, i + 1));
            });
            return rank;
        }, [playersData, timeRecomputeTs]);
        function tradeLiquidity(asset) {
            if (!asset || asset.type === 'pick') return 1; // draft capital is fully liquid
            const pos = asset.pos;
            if (pos === 'K') return 0.3;
            if (pos === 'DEF') return 0.35;
            if (!LOW_LIQUIDITY_POS.includes(pos)) return 1;
            const rank = idpRankByPid.get(String(asset.pid)) || 999;
            if (rank <= 5) return 0.95;  // Parsons/Garrett tier — trades near face value
            if (rank <= 20) return 0.6;  // solid IDP starter
            return 0.45;                 // streamable depth
        }
        function assetMarketValue(asset) { return Math.round((asset?.value || 0) * tradeLiquidity(asset)); }
        function isLowLiquidAsset(asset) { return asset && asset.type !== 'pick' && tradeLiquidity(asset) < 0.9; }

        function formatReasonsForAssets(players = []) {
            if (!leagueProfile || typeof window.App?.Intelligence?.buildPlayerFormatReasons !== 'function') return [];
            const seen = new Set();
            const reasons = [];
            (players || []).forEach(asset => {
                if (!asset || asset.type === 'pick') return; // player-only reads — picks have no pos/format angle
                const p = playersData[asset.pid] || { position: asset.pos, full_name: asset.name };
                window.App.Intelligence.buildPlayerFormatReasons({ player: p, pos: asset.pos, profile: leagueProfile }).forEach(reason => {
                    if (seen.has(reason.code)) return;
                    seen.add(reason.code);
                    reasons.push(reason);
                });
            });
            return reasons;
        }

        function formatReadoutForDeal(givePlayers = [], receivePlayers = []) {
            const playerReasons = formatReasonsForAssets(receivePlayers).concat(formatReasonsForAssets(givePlayers));
            const firstPlayerReasons = [];
            const seen = new Set();
            playerReasons.forEach(reason => {
                if (seen.has(reason.code)) return;
                seen.add(reason.code);
                firstPlayerReasons.push(reason);
            });
            if (firstPlayerReasons.length) return firstPlayerReasons.slice(0, 2).map(r => r.detail || r.label).join(' ');
            const marketFit = leagueProfile?.market?.fantasyCalcCompatibility;
            if (marketFit?.custom) {
                return 'This league uses custom scoring, so generic market values should be checked against league-specific DHQ context.';
            }
            const badge = leagueFormatBadges.find(b => b.impact === 'major' || b.impact === 'scoring');
            return badge ? badge.detail : '';
        }

        function detectPickIdMode(rosters, tradedPicks) {
            const rosterIds = new Set(rosters.map(r => String(r.roster_id)));
            const userIds = new Set(rosters.map(r => String(r.owner_id)));
            let rosterHits = 0, userHits = 0;
            for (const tp of tradedPicks || []) {
                const oid = String(tp.owner_id ?? '');
                if (rosterIds.has(oid)) rosterHits++;
                if (userIds.has(oid)) userHits++;
            }
            return rosterHits >= userHits ? 'roster' : 'user';
        }

        // The tradeable pick window: the next PICK_HORIZON draft seasons. Once a
        // season's rookie draft is complete those picks are spent, so the window
        // rolls forward by a year (e.g. after the 2026 draft: 2027/2028/2029, not
        // 2026/2027/2028) — this is what pulls the just-drafted year off the
        // trade calculator.
        function pickWindowYears(leagueSeason, skipCurrentSeason) {
            const start = Number(leagueSeason) + (skipCurrentSeason ? 1 : 0);
            return Array.from({ length: PICK_HORIZON }, (_, i) => start + i);
        }

        function buildPicksByOwner(rosters, tradedPicks, leagueSeason, draftRounds, skipCurrentSeason) {
            // League-specific round count (falls back to the constant only if unknown).
            const rounds = Math.max(1, Number(draftRounds) || DRAFT_ROUNDS);
            const PICK_YEARS_INT = pickWindowYears(leagueSeason, skipCurrentSeason);
            const mode = detectPickIdMode(rosters, tradedPicks);
            const rosterById = {};
            for (const r of rosters) rosterById[String(r.roster_id)] = r;
            const ownerByKey = {};
            for (const r of rosters) {
                const originRosterId = String(r.roster_id);
                const ownerUserId = String(r.owner_id);
                for (const y of PICK_YEARS_INT) { for (let rd = 1; rd <= rounds; rd++) { ownerByKey[`${y}-${rd}-${originRosterId}`] = ownerUserId; } }
            }
            for (const tp of tradedPicks || []) {
                const y = Number(tp.season); if (!PICK_YEARS_INT.includes(y)) continue;
                const rd = Number(tp.round); if (!Number.isFinite(rd) || rd < 1 || rd > rounds) continue;
                const originRosterId = String(tp.roster_id);
                let newOwnerUserId;
                if (mode === 'user') { newOwnerUserId = String(tp.owner_id ?? ''); }
                else { const r = rosterById[String(tp.owner_id ?? '')]; newOwnerUserId = r?.owner_id ? String(r.owner_id) : null; }
                if (!newOwnerUserId) continue;
                const key = `${y}-${rd}-${originRosterId}`;
                if (key in ownerByKey) ownerByKey[key] = newOwnerUserId;
            }
            const picksByOwner = {};
            for (const [key, ownerUserId] of Object.entries(ownerByKey)) {
                const parts = key.split('-');
                const y = Number(parts[0]), rd = Number(parts[1]), fromRosterId = parts[2];
                if (!picksByOwner[ownerUserId]) picksByOwner[ownerUserId] = [];
                picksByOwner[ownerUserId].push({ year: y, round: rd, fromRosterId });
            }
            for (const oid of Object.keys(picksByOwner)) {
                picksByOwner[oid].sort((a, b) => a.year - b.year || a.round - b.round || Number(a.fromRosterId) - Number(b.fromRosterId));
            }
            return picksByOwner;
        }

        function assessTeamLocal(roster, nflStarterSet, ownerPicks, skipCurrentSeason) {
            // Try shared assessor first
            if (window.assessTeamFromGlobal) {
                const result = window.assessTeamFromGlobal(roster.roster_id);
                if (result) return result;
            }
            const scoring = currentLeague.scoring_settings;
            const rosterPos = currentLeague.roster_positions || [];
            const users = currentLeague.users || [];
            const user = users.find(u => u.user_id === roster.owner_id);
            const teamName = user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`;
            const ownerName = user?.display_name || `Owner ${roster.roster_id}`;
            const avatar = user?.avatar || null;
            const wins = roster.settings?.wins || 0;
            const losses = roster.settings?.losses || 0;
            const ties = roster.settings?.ties || 0;
            const pf = Number(roster.settings?.fpts || 0) + Number(roster.settings?.fpts_decimal || 0) / 100;
            const waiverBudget = Number(currentLeague.settings?.waiver_budget || 1000);
            const waiverUsed = Number(roster.settings?.waiver_budget_used || 0);
            const faabRemaining = Math.max(0, waiverBudget - waiverUsed);

            const posGroups = {};
            for (const id of (roster.players || [])) {
                const np = normPos(playersData[id]?.position); if (!np) continue;
                if (!posGroups[np]) posGroups[np] = [];
                posGroups[np].push(id);
            }

            const posAssessment = {};
            for (const [pos, ideal] of Object.entries(IDEAL_ROSTER)) {
                const playerIds = posGroups[pos] || [];
                const startingReq = MIN_STARTER_QUALITY[pos] ?? LINEUP_STARTERS[pos] ?? 1;
                const ptTarget = POS_PT_TARGETS[pos] || 8;
                const withPPG = playerIds.map(id => ({ id, ppg: calcPPG(id, scoring) })).sort((a,b) => b.ppg - a.ppg);
                const projectedPts = withPPG.slice(0, startingReq).reduce((s, p) => s + p.ppg, 0);
                const posStarters = nflStarterSet[pos] || new Set();
                const nflStarterIds = playerIds.filter(id => posStarters.has(id));
                const nflStarters = nflStarterIds.length;
                const actual = playerIds.length;
                const diff = actual - ideal;
                const minQuality = MIN_STARTER_QUALITY[pos] || startingReq;

                let status;
                if (nflStarters === 0) status = 'deficit';
                else if (nflStarters < minQuality) status = 'thin';
                else if (actual >= ideal) status = 'surplus';
                else status = 'ok';
                if ((status === 'ok' || status === 'surplus') && actual < ideal) status = 'thin';

                const sortedIds = [...playerIds].map(id => ({ id, score: calcSeasonPts(id, scoring) })).sort((a,b) => b.score - a.score).map(p => p.id);
                posAssessment[pos] = { actual, ideal, diff, nflStarters, nflStarterIds, sortedIds, startingReq, minQuality, ptTarget, projectedPts, status };
            }

            const leagueSeason = parseInt(currentLeague.season || new Date().getFullYear());
            const pickYears = pickWindowYears(leagueSeason, skipCurrentSeason).map(String);
            // League-specific rounds (not the hardcoded constant) so pick-capital
            // status reflects this league's actual draft size.
            const aRounds = Math.max(1, Number(tcDraftRounds) || DRAFT_ROUNDS);
            const aIdeal = aRounds * PICK_HORIZON;
            const pickCountByRound = {}; const pickCountByYear = {}; const pickCountByYearRound = {};
            for (let r = 1; r <= aRounds; r++) pickCountByRound[r] = 0;
            for (const year of pickYears) { pickCountByYear[year] = 0; pickCountByYearRound[year] = {}; for (let r = 1; r <= aRounds; r++) pickCountByYearRound[year][r] = 0; }
            for (const { year, round } of (ownerPicks || [])) {
                const y = String(year); if (!pickYears.includes(y)) continue;
                if (round < 1 || round > aRounds) continue;
                pickCountByRound[round]++; pickCountByYear[y]++; pickCountByYearRound[y][round]++;
            }
            const totalPicks = Object.values(pickCountByRound).reduce((a, b) => a + b, 0);
            let picksStatus;
            if (totalPicks === 0) picksStatus = 'deficit';
            else if (totalPicks < aIdeal) picksStatus = 'thin';
            else if (totalPicks === aIdeal) picksStatus = 'ok';
            else picksStatus = 'surplus';
            const picksAssessment = { pickCountByRound, pickCountByYear, pickCountByYearRound, totalPicks, draftRounds: aRounds, idealTotal: aIdeal, pickYears, status: picksStatus };

            const weeklyPts = calcOptimalLineup(roster.players || [], roster.reserve || [], roster.taxi || [], scoring, rosterPos);
            const scoringScore = Math.min(60, (weeklyPts / WEEKLY_TARGET) * 60);
            let coverageScore = 0;
            const hasValueData = Object.keys(nflStarterSet).length > 0;
            for (const [pos, data] of Object.entries(posAssessment)) {
                const ratio = hasValueData ? Math.min(1, data.nflStarters / (data.minQuality || data.startingReq || 1)) : Math.min(1, data.actual / data.ideal);
                coverageScore += ratio * ((POS_WEIGHTS[pos]||0) / TOTAL_WEIGHT) * 40;
            }
            const projBonus = weeklyPts > WEEKLY_TARGET + 10 ? 3 : weeklyPts >= WEEKLY_TARGET ? 1 : 0;
            const healthScore = Math.min(100, Math.round(scoringScore + coverageScore + projBonus));

            let tier, tierColor, tierBg;
            if (weeklyPts > 0) {
                if (weeklyPts > WEEKLY_TARGET + 10) { tier='ELITE'; tierColor='var(--gold)'; tierBg='var(--acc-fill3, rgba(212,175,55,0.15))'; }
                else if (weeklyPts >= WEEKLY_TARGET - 15) { tier='CONTENDER'; tierColor='var(--good)'; tierBg='rgba(46,204,113,0.12)'; }
                else if (weeklyPts >= WEEKLY_TARGET * 0.85) { tier='CROSSROADS'; tierColor='var(--warn)'; tierBg='rgba(240,165,0,0.12)'; }
                else { tier='REBUILDING'; tierColor='var(--bad)'; tierBg='rgba(231,76,60,0.12)'; }
            } else {
                if (coverageScore >= 36) { tier='CONTENDER'; tierColor='var(--good)'; tierBg='rgba(46,204,113,0.12)'; }
                else if (coverageScore >= 26) { tier='CROSSROADS'; tierColor='var(--warn)'; tierBg='rgba(240,165,0,0.12)'; }
                else { tier='REBUILDING'; tierColor='var(--bad)'; tierBg='rgba(231,76,60,0.12)'; }
            }

            let panic = 0;
            if (weeklyPts > 0 && weeklyPts < WEEKLY_TARGET * 0.85) panic += 2;
            else if (weeklyPts > 0 && weeklyPts < WEEKLY_TARGET) panic += 1;
            const criticals = Object.values(posAssessment).filter(p => p.status === 'deficit').length;
            if (criticals >= 3) panic += 2; else if (criticals >= 1) panic += 1;
            const played = wins + losses + ties;
            if (played > 0 && losses / played > 0.6) panic += 1;
            panic = Math.min(5, panic);

            let tradeWindow;
            if (tier === 'ELITE' || (tier === 'CONTENDER' && panic <= 1)) tradeWindow = 'CONTENDING';
            else if (tier === 'REBUILDING') tradeWindow = 'REBUILDING';
            else tradeWindow = 'TRANSITIONING';

            const needs = Object.entries(posAssessment).filter(([,v]) => v.status === 'deficit' || v.status === 'thin')
                .sort((a,b) => { const aGap = a[1].nflStarters - a[1].startingReq; const bGap = b[1].nflStarters - b[1].startingReq; return aGap !== bGap ? aGap - bGap : a[1].diff - b[1].diff; })
                .map(([pos,v]) => ({ pos, urgency: v.status }));
            const strengths = Object.entries(posAssessment).filter(([,v]) => v.status === 'surplus').map(([pos]) => pos);

            return { rosterId:roster.roster_id, ownerId:roster.owner_id, teamName, ownerName, avatar, wins, losses, ties, pf,
                     posGroups, posAssessment, picksAssessment, weeklyPts, healthScore, tier, tierColor, tierBg, panic, window: tradeWindow, needs, strengths,
                     faabRemaining, waiverBudget };
        }

        const calcComplementarity = window.App?.TradeEngine?.calcComplementarity || function(mine, theirs) { if (!mine || !theirs) return 0; let score = 0; for (const n of mine.needs) { const t = theirs.posAssessment[n.pos]; if (t?.status === 'surplus') score += n.urgency === 'deficit' ? 25 : 12; else if (t?.status === 'ok' && n.urgency === 'deficit') score += 6; } for (const n of theirs.needs) { const m = mine.posAssessment[n.pos]; if (m?.status === 'surplus') score += n.urgency === 'deficit' ? 25 : 12; else if (m?.status === 'ok' && n.urgency === 'deficit') score += 6; } if (mine.window !== theirs.window) score += 15; return Math.min(100, score); };
        const calcOwnerPosture = window.App?.TradeEngine?.calcOwnerPosture || function(assessment, dnaKey) { if (!assessment) return POSTURES.NEUTRAL; const { tier, panic } = assessment; if (panic >= 4) return POSTURES.DESPERATE; if (tier === 'REBUILDING' || dnaKey === 'ACCEPTOR') return POSTURES.SELLER; if (tier === 'ELITE' && panic <= 1) return POSTURES.LOCKED; if ((tier === 'CONTENDER' || tier === 'CROSSROADS') && panic >= 2) return POSTURES.BUYER; return POSTURES.NEUTRAL; };
        const calcPsychTaxes = window.App?.TradeEngine?.calcPsychTaxes || function(myAssess, theirAssess, theirDnaKey, theirPosture) { const taxes = []; const ePct = { FLEECER:10, DOMINATOR:28, STALWART:20, ACCEPTOR:5, DESPERATE:15, NONE:12 }[theirDnaKey] || 12; taxes.push({ name:'Endowment Effect', impact:-Math.round(ePct/2), type:'TAX', desc:`~${ePct}% mental inflation on their own players.` }); if (theirAssess?.panic >= 3) taxes.push({ name:'Panic Premium', impact:8+(theirAssess.panic-2)*6, type:'BONUS', desc:`Panic ${theirAssess.panic}/5 — urgency overrides caution.` }); if (theirDnaKey === 'DOMINATOR') taxes.push({ name:'Status Tax', impact:-18, type:'TAX', desc:'Must visibly win the trade for ego/status.' }); if (['STALWART','DOMINATOR'].includes(theirDnaKey)) taxes.push({ name:'Loss Aversion', impact:-8, type:'TAX', desc:'Losing a familiar player hurts more than gaining a new one.' }); if (theirDnaKey === 'ACCEPTOR') taxes.push({ name:'Rebuilding Discount', impact:+10, type:'BONUS', desc:'They mentally discount current starters.' }); const myStrengths = myAssess?.strengths || []; const theirNeedPos = theirAssess?.needs?.slice(0,3).map(n=>n.pos) || []; if (theirNeedPos.some(p => myStrengths.includes(p))) taxes.push({ name:'Need Fulfillment', impact:+12, type:'BONUS', desc:'Your surplus fills their critical gap.' }); if (myAssess && theirAssess) { if (myAssess.window !== theirAssess.window) taxes.push({ name:'Window Alignment', impact:+8, type:'BONUS', desc:'Opposite windows = natural asset exchange.' }); else taxes.push({ name:'Window Friction', impact:-5, type:'TAX', desc:'Same window reduces natural motivation.' }); } if (theirPosture?.key === 'LOCKED') taxes.push({ name:'Locked Roster Tax', impact:-12, type:'TAX', desc:'High satisfaction + attachment.' }); else if (theirPosture?.key === 'SELLER') taxes.push({ name:'Seller Momentum', impact:+10, type:'BONUS', desc:'Actively shopping. Trade conversations welcomed.' }); return taxes; };
        const calcAcceptanceLikelihood = window.App?.TradeEngine?.calcAcceptanceLikelihood || window.App?.calcAcceptanceLikelihood || function(myValue, theirValue, _dnaKey, psychTaxes, _myAssess, _theirAssess, opts) { const totalA = Number(myValue) || 0; const totalB = Number(theirValue) || 0; if (totalA <= 0 && totalB <= 0) return 50; const maxSide = Math.max(totalA, totalB, 1); const diff = totalA - totalB; const rawTax = (psychTaxes || []).reduce((sum, t) => sum + (Number(t.impact) || 0), 0); const complexityTax = Math.max(0, ((opts?.totalPieces) || 0) - 4) * 5; const taxValueAdjust = ((rawTax - complexityTax) / 200) * maxSide; const normalizedSurplus = (diff + taxValueAdjust) / maxSide; return Math.round(Math.max(5, Math.min(95, 50 + Math.round(normalizedSurplus * 200)))); };

        const grudgeDecay = d => d < 30 ? 1.0 : d < 60 ? 0.6 : d < 90 ? 0.3 : 0.1;
        const GRUDGE_KEY = lid => `od_grudges_v1_${lid}`;
        function loadGrudges(lid) { try { return JSON.parse(localStorage.getItem(GRUDGE_KEY(lid)) || '[]'); } catch(e) { return []; } }
        function saveGrudges(lid, data) { localStorage.setItem(GRUDGE_KEY(lid), JSON.stringify(data)); }

        const calcGrudgeTax = window.App?.TradeEngine?.calcGrudgeTax || function(myOwnerId, theirOwnerId, grudgesList, theirDnaKey) {
            if (!myOwnerId || !theirOwnerId) return { total:0, entries:[] };
            const relevant = grudgesList.filter(g => g.myOwnerId === myOwnerId && g.theirOwnerId === theirOwnerId);
            const dnaMult = { FLEECER:0.7, DOMINATOR:1.6, STALWART:1.2, ACCEPTOR:0.8, DESPERATE:0.5, NONE:1.0 }[theirDnaKey] || 1.0;
            const now = Date.now();
            let total = 0;
            for (const g of relevant) {
                const ageDays = (now - new Date(g.date).getTime()) / 86400000;
                total += (GRUDGE_TYPES[g.type]?.impact || 0) * grudgeDecay(ageDays) * dnaMult;
            }
            return { total:Math.round(total), entries:relevant.sort((a,b) => new Date(b.date)-new Date(a.date)) };
        };

        function deriveDNAFromHistory(theirOwnerId, allGrudges) {
            const entries = allGrudges.filter(g => g.theirOwnerId === theirOwnerId);
            if (entries.length < 3) return null;
            const scores = { FLEECER:0, DOMINATOR:0, STALWART:0, ACCEPTOR:0, DESPERATE:0 };
            for (const g of entries) { const sig = GRUDGE_TYPES[g.type]?.dnaSignal || {}; for (const [dna, w] of Object.entries(sig)) scores[dna] = (scores[dna]||0) + w; }
            const ranked = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
            const [top, second] = ranked;
            if (top[1] < 3) return null;
            if (second && top[1] < second[1] * 1.5) return null;
            return top[0];
        }

        function computeWeightedDNA(rosterId) {
            const allTrades = window.App?.LI?.tradeHistory || [];
            const profile = window.App?.LI?.ownerProfiles?.[rosterId] || {};
            const trades = allTrades.filter(t => t.roster_ids?.includes(rosterId));
            if (trades.length < 2) return null;

            const scores = { FLEECER:0, DOMINATOR:0, STALWART:0, ACCEPTOR:0, DESPERATE:0 };
            const signals = [];

            // Trade frequency vs league average
            const leagueSize = Math.max(1, window.App?.LI?.rosters?.length || allRosters.length || 10);
            const avgTrades = allTrades.length / leagueSize;
            if (avgTrades > 0) {
                const ratio = trades.length / avgTrades;
                if (ratio < 0.5) { scores.STALWART += 4; signals.push('Low trade activity'); }
                else if (ratio > 1.75) { scores.FLEECER += 3; signals.push('High trade volume'); }
            }

            // Win rate from owner profile
            const totalGraded = (profile.tradesWon||0) + (profile.tradesLost||0) + (profile.tradesFair||0);
            if (totalGraded >= 2) {
                const winRate = (profile.tradesWon||0) / totalGraded;
                const lossRate = (profile.tradesLost||0) / totalGraded;
                const fairRate = (profile.tradesFair||0) / totalGraded;
                if (winRate > 0.55) { scores.FLEECER += Math.round(winRate*6); signals.push(`Wins ${Math.round(winRate*100)}% of trades`); }
                if (lossRate > 0.45) { scores.ACCEPTOR += 2; scores.DESPERATE += 2; signals.push(`Loses ${Math.round(lossRate*100)}% of trades`); }
                if (fairRate > 0.55) { scores.STALWART += 2; signals.push('Prefers balanced deals'); }
            }

            // Average DHQ per trade
            const avgDiff = profile.avgValueDiff || 0;
            if (avgDiff > 400) { scores.FLEECER += 4; signals.push(`Avg +${Math.round(avgDiff)} DHQ/trade`); }
            else if (avgDiff > 100) { scores.DOMINATOR += 2; signals.push(`Avg +${Math.round(avgDiff)} DHQ/trade`); }
            else if (avgDiff < -300) { scores.DESPERATE += 3; scores.ACCEPTOR += 1; signals.push(`Avg ${Math.round(avgDiff)} DHQ/trade`); }
            else if (Math.abs(avgDiff) <= 150) { scores.STALWART += 2; signals.push('Balanced trade value'); }

            // Trade composition: picks vs players, elite asset flow
            let picksReceived = 0, picksSent = 0, elitePlayersSent = 0, elitePlayersReceived = 0, lateSeasonLosses = 0;
            const eliteThreshold = 5000;
            for (const t of trades) {
                const mySide = t.sides?.[rosterId] || { players:[], picks:[] };
                const otherRid = t.roster_ids.find(r => r !== rosterId);
                const theirSide = t.sides?.[otherRid] || { players:[], picks:[] };
                const myValue = mySide.totalValue || 0;
                const theirValue = theirSide.totalValue || 0;
                picksReceived += (mySide.picks||[]).length;
                picksSent += (theirSide.picks||[]).length;
                for (const pid of (theirSide.players||[])) { if ((window.App?.LI?.playerScores?.[pid]||0) > eliteThreshold) elitePlayersSent++; }
                for (const pid of (mySide.players||[])) { if ((window.App?.LI?.playerScores?.[pid]||0) > eliteThreshold) elitePlayersReceived++; }
                if ((t.week||0) >= 10 && theirValue > myValue * 1.15) lateSeasonLosses++;
            }

            // DOMINATOR: gives picks to acquire proven players (win-now aggression)
            if (picksSent > 1 && picksReceived < picksSent * 0.7) { scores.DOMINATOR += 3; signals.push('Trades picks for players (win-now)'); }
            // ACCEPTOR: gives players for picks (rebuilding mode)
            if (picksReceived > 1 && picksSent < picksReceived * 0.7) { scores.ACCEPTOR += 3; signals.push('Trades players for picks'); }
            // DESPERATE: sells elite talent away
            if (elitePlayersSent >= 2 && elitePlayersSent > elitePlayersReceived) { scores.DESPERATE += 4; signals.push(`Sold ${elitePlayersSent} elite players`); }
            // FLEECER: acquires elite assets in favorable deals
            if (elitePlayersReceived >= 2 && elitePlayersReceived > elitePlayersSent) { scores.FLEECER += 3; signals.push(`Acquired ${elitePlayersReceived} elite players`); }
            // Late-season panic: lost trades in weeks 10+
            if (lateSeasonLosses >= 2) { scores.DESPERATE += 3; signals.push(`${lateSeasonLosses} late-season panic trades`); }

            const ranked = Object.entries(scores).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
            if (!ranked.length || ranked[0][1] < 3) return null;
            const [topEntry, secondEntry] = ranked;
            const totalScore = ranked.reduce((s,[,v])=>s+v, 0);
            const dominance = secondEntry ? (topEntry[1]-secondEntry[1])/topEntry[1] : 1;
            const proportion = topEntry[1] / totalScore;
            const confidence = Math.min(92, Math.round((proportion*0.6 + dominance*0.4) * 100));
            if (confidence < 22) return null;
            return { key:topEntry[0], confidence, reasoning:signals.slice(0,4).join(' · ') || 'Based on trade patterns' };
        }

        // ── State ──
        // Canonical surfaces: 'desk' | 'dna' | 'log'. setTcTab is the single alias-safe
        // seam: legacy values from ANY producer land correctly (dealhq→desk,
        // finder→desk+find-seed, analyzer→desk+builder-expanded, profiles→dna, inbox→log).
        // Phone tier (plan D1/D7): shared viewport seam — js/shared/viewport.js
        // loads before the babel chain, so the hook always exists here.
        const _vp = window.WR.useViewport();
        const [tcTab, _setTcTabRaw] = useState('desk');
        const [builderExpanded, setBuilderExpanded] = useState(false); // persistent builder panel open/closed
        // ── Typed finder query (Phase 4a) — the single finder input, replacing the
        // legacy mode/focus-pid/partner trio of states ──
        // { intent: 'best'|'help'|'shop'|'picks',
        //   focus: null | { kind:'player'|'pick'|'owner', id, label, pos?, ownerId?, rosterId? },
        //   partnerFilter: null | ownerId }
        // Player/pick focus ownership + label resolve at RENDER time (resolveFinderFocus),
        // so event handlers can seed a minimal { kind, id } without stale closures.
        // The query drives the generator through deriveFinderMode (legacy modes
        // fillNeed/sellSurplus/shop/acquire/picks); pick-kind focuses route through the
        // dedicated pick paths in generateDealsForPartner (receivePicks/givePicks).
        const [finderQuery, setFinderQuery] = useState({ intent: 'best', focus: null, partnerFilter: null });
        const setTcTab = useCallback((v) => {
            if (v === 'finder') {
                setFinderQuery(qr => ({ ...qr, intent: 'shop' }));
            } else if (v === 'analyzer') {
                setBuilderExpanded(true);
            }
            _setTcTabRaw(normalizeTcTab(v));
        }, []);
        const [finderSearch, setFinderSearch] = useState('');
        const [finderTypeaheadIdx, setFinderTypeaheadIdx] = useState(0);
        const [assetBrowserOpen, setAssetBrowserOpen] = useState(false);
        const [dealHqNotice, setDealHqNotice] = useState(null);
        const [showAllDeals, setShowAllDeals] = useState(false);
        const [expandedDealId, setExpandedDealId] = useState(null);
        const [assetBrowserPos, setAssetBrowserPos] = useState('ALL');
        const [assetBrowserSort, setAssetBrowserSort] = useState('dhq');
        const [assetBrowserRookieOnly, setAssetBrowserRookieOnly] = useState(false);
        // Phone tier (iPhone program Phase 2) — Trade Center phone-branch sheet
        // state. Declared unconditionally (hook-order safety); inert off-phone.
        const [phPicksScope, setPhPicksScope] = useState('owned');   // 'owned' | 'league' — phone picks-board scope (Intent=Picks)
        const [phBuilderOpen, setPhBuilderOpen] = useState(false);   // WR.ActionBar → builder + verdict WR.Sheet
        const [phFinderPanel, setPhFinderPanel] = useState(null);    // inline finder-control disclosure: null|'intent'|'partner'|'pos'|'sort'
        const [phLogRowId, setPhLogRowId] = useState(null);          // Trade Log row → deal WR.Sheet
        // Rookie/prospect join — name→prospect index rebuilt when the rookie CSV lands
        // (timeRecomputeTs). getProspects/findProspect are defined eagerly at boot
        // (rookie-data.js) but return empty until the CSV cache loads, so the index can
        // be empty on first paint; RookieFields degrades gracefully and the empty-state
        // copy distinguishes "still loading" (index empty) from "no rookies match".
        const tcRookieFields = window.App?.RookieFields;
        const tcRookieIndex = useMemo(() => tcRookieFields ? tcRookieFields.buildIndex() : new Map(), [timeRecomputeTs]);
        const tcRookieInfoFor = useCallback((pid) => {
            if (!tcRookieFields || !pid) return null;
            const player = playersData[pid];
            if (!player) return null;
            return tcRookieFields.fields(tcRookieFields.lookup(tcRookieIndex, player, { posGuard: true }));
        }, [tcRookieFields, tcRookieIndex, playersData]);
        const [tradeContext, setTradeContext] = useState(() => window._wrTradeContext || null);
        useEffect(() => {
            if (!initialSubTab) return;
            // setTcTab is alias-safe: 'finder' seeds find mode, 'analyzer' expands the builder.
            setTcTab(initialSubTab);
            if (onSubTabConsumed) onSubTabConsumed();
        }, [initialSubTab]);
        useEffect(() => {
            const openFinder = (target) => {
                const next = target?.detail || target || window._wrTradeFinderTarget;
                if (!next?.pid) return;
                // Minimal typed focus — ownership/label resolve at render (resolveFinderFocus),
                // and 'shop' intent derives shop-vs-acquire from that ownership, so this
                // handler stays closure-safe with [] deps (setters only).
                setFinderQuery(qr => ({ ...qr, intent: 'shop', focus: { kind: 'player', id: next.pid }, partnerFilter: null }));
                setTcTab('desk');
                window._wrTradeFinderTarget = null;
            };
            window.addEventListener('wr:open-trade-finder', openFinder);
            openFinder(window._wrTradeFinderTarget);
            return () => window.removeEventListener('wr:open-trade-finder', openFinder);
        }, []);
        const [ownerDna, setOwnerDna] = useState({});
        const [grudges, setGrudges] = useState([]);
        // Sort/filter controls died with renderAudit; the fixed values still
        // shape the health-board memo until trade Phase 4 rebuilds this region.
        const sortMode = 'health';
        const tierFilter = 'ALL';

        // Trade Analyzer state
        const [tradeIds, setTradeIds] = useState({ A:[], B:[] });
        const [tradePickIds, setTradePickIds] = useState({ A:[], B:[] });
        const [tradeFaab, setTradeFaab] = useState({ A:0, B:0 });
        const [tradeOwner, setTradeOwner] = useState({ A:null, B:null });
        const [searchText, setSearchText] = useState({ A:'', B:'' });
        // Alex's AI second opinion on the manual builder's deal: { loading, error, text, dealKey, feedback }
        const [alexVerdict, setAlexVerdict] = useState(null);
        const lastTradeLogRef = useRef('');
        const tradeStartedRef = useRef(false);
        useEffect(() => {
            const hasA = tradeIds.A.length > 0 || tradePickIds.A.length > 0 || tradeFaab.A > 0;
            const hasB = tradeIds.B.length > 0 || tradePickIds.B.length > 0 || tradeFaab.B > 0;
            const sig = JSON.stringify([tradeIds, tradePickIds, tradeFaab]);
            if ((hasA || hasB) && !tradeStartedRef.current) {
                tradeStartedRef.current = true;
                window.OD?.trackTradeStarted?.({
                    platform: 'warroom',
                    module: 'trades',
                    leagueId: currentLeague?.league_id || currentLeague?.id || null,
                    metadata: { hasA, hasB },
                });
            }
            if (hasA && hasB) {
                if (sig !== lastTradeLogRef.current) {
                    lastTradeLogRef.current = sig;
                    window.wrLogAction?.('\uD83D\uDD04', 'Evaluated trade proposal', 'trade', { actionType: 'trade-builder' });
                    window.OD?.trackTradeEvaluated?.({
                        platform: 'warroom',
                        module: 'trades',
                        leagueId: currentLeague?.league_id || currentLeague?.id || null,
                        metadata: {
                            myPlayers: tradeIds.A.length,
                            theirPlayers: tradeIds.B.length,
                            myPicks: tradePickIds.A.length,
                            theirPicks: tradePickIds.B.length,
                            myFaab: tradeFaab.A || 0,
                            theirFaab: tradeFaab.B || 0,
                        },
                    });
                }
            }
        }, [tradeIds, tradePickIds, tradeFaab]);

        // DNA tab state
        const [ownerDraftDna, setOwnerDraftDna] = useState({});
        const [expandedDnaOwner, setExpandedDnaOwner] = useState(null);
        // Trade Log ledger state (Phase 5). ledgerRawTrades is the WrTxns raw-Sleeper
        // fallback used when the DHQ engine's analyzed history is empty: null until
        // the first fetch attempt resolves.
        const [ledgerTeamFilter, setLedgerTeamFilter] = useState('all');
        const [ledgerShown, setLedgerShown] = useState(20);
        const [ledgerRawTrades, setLedgerRawTrades] = useState(null);
        const [ledgerSyncing, setLedgerSyncing] = useState(false);

        const allRosters = currentLeague.rosters || [];
        const leagueUsers = currentLeague.users || [];
        const leagueId = currentLeague.id || currentLeague.league_id;
        const WR_KEYS = window.App?.WR_KEYS || window.WR_KEYS || {};
        const WrStorage = window.App?.WrStorage || window.WrStorage || null;
        const savedDealsKey = (WR_KEYS.SAVED_TRADES && leagueId)
            ? WR_KEYS.SAVED_TRADES(leagueId)
            : `wr_saved_trades_${leagueId || 'default'}`;
        const [savedDeals, setSavedDeals] = useState([]);
        useEffect(() => {
            if (!leagueId) return;
            const loaded = WrStorage?.get
                ? WrStorage.get(savedDealsKey, [])
                : (() => { try { return JSON.parse(localStorage.getItem(savedDealsKey) || '[]'); } catch(e) { return []; } })();
            // One-time migration: normalize legacy rows (pre-Phase-5 flat saveDeal rows +
            // Alex-chat {…tradeCard, savedAt} rows) to the pipeline schema, write back once.
            const { rows, changed } = window.WrTradePipeline.normalizeAll(loaded);
            setSavedDeals(rows);
            if (changed) {
                if (WrStorage?.set) WrStorage.set(savedDealsKey, rows);
                else localStorage.setItem(savedDealsKey, JSON.stringify(rows));
            }
        }, [leagueId, savedDealsKey, WrStorage]);
        // Trade Log ledger raw fallback: when the analyzed history is empty, pull raw
        // Sleeper trades (txn-store cache → network) so the ledger still renders.
        useEffect(() => {
            if (tcTab !== 'log' || !leagueId) return;
            if ((window.App?.LI?.tradeHistory || []).length) return;
            if (ledgerRawTrades !== null || ledgerSyncing) return;
            refreshLedger(false);
        }, [tcTab, leagueId, ledgerRawTrades, ledgerSyncing]);

        // Fetch draft slot maps for accurate pick ownership (slot_to_roster_id from Sleeper)
        const [draftSlotMaps, setDraftSlotMaps] = useState({});
        // League-specific rookie-draft round count — replaces the hardcoded DRAFT_ROUNDS
        // so EVERY league's future picks use its real round count, not a flat 7.
        const [leagueDraftRounds, setLeagueDraftRounds] = useState(null);
        // True once every draft for the league's current season has completed —
        // the signal that "the draft is over" and this season's picks should drop
        // out of the trade calculator. Defaults false so picks stay tradeable
        // until we positively confirm the draft finished (or for platforms with
        // no draft objects, e.g. ESPN/Yahoo).
        const [currentDraftComplete, setCurrentDraftComplete] = useState(false);
        useEffect(() => {
            if (!leagueId || !allRosters.length) return;
            let cancelled = false;
            (async () => {
                try {
                    const leagueSeason = parseInt(currentLeague.season || new Date().getFullYear());
                    const pickYears = Array.from({ length: PICK_HORIZON }, (_, i) => leagueSeason + i);
                    // MFL leagues 404 on the Sleeper drafts endpoint. Their draft objects
                    // (hydrated onto window.S / the league) already carry season +
                    // slot_to_roster_id + draft_order, so the pick-slot labels (1.13 etc.)
                    // resolve for the current draft the same way Sleeper's do.
                    const isMfl = !!(currentLeague?._mfl || String(leagueId).startsWith('mfl_'));
                    // Gather the league's drafts (used for BOTH the slot maps and the
                    // round count). Sleeper's drafts aren't in window.S, so fetch the
                    // list; MFL's are already hydrated; ESPN/Yahoo have none (→ []).
                    let draftsList;
                    if (isMfl) {
                        draftsList = (window.S?.drafts && window.S.drafts.length) ? window.S.drafts : (currentLeague?.drafts || []);
                    } else {
                        draftsList = await fetch('https://api.sleeper.app/v1/league/' + leagueId + '/drafts').then(r => r.ok ? r.json() : []).catch(() => []);
                    }
                    if (cancelled) return;
                    draftsList = Array.isArray(draftsList) ? draftsList : [];
                    // ── "Draft is over" detection ──────────────────────────────
                    // When every draft for the current season has completed, that
                    // season's rookie picks are spent and must come off the trade
                    // calculator. Require .length > 0 so "no drafts yet" is never
                    // read as complete, and .every so a rookie+supplemental pair
                    // doesn't drop the year while one is still pending (mirrors the
                    // free-agency rookie-lock logic).
                    const currentSeasonDrafts = draftsList.filter(d => Number(d.season) === leagueSeason);
                    const seasonDraftDone = currentSeasonDrafts.length > 0
                        && currentSeasonDrafts.every(d => String(d.status || '').toLowerCase() === 'complete');
                    if (!cancelled) setCurrentDraftComplete(seasonDraftDone);
                    // ── League-specific rookie-draft round count (ALL platforms) ──
                    // Resolve from the ROOKIE draft (player_type===1) so a startup draft
                    // can't inflate it; resolveDraftRounds falls back to the league's
                    // settings.draft_rounds (Sleeper field / ESPN+Yahoo bench-derived).
                    // Resolve the rookie draft (player_type===1) for the season — its
                    // settings.rounds is the authoritative dynasty rookie-round count.
                    // (Deliberately NOT using resolveDraftRounds here: its seasonal/
                    // redraft branch returns a roster-slot count, which would INFLATE
                    // redraft leagues past the old default.)
                    const rookieDrafts = draftsList.filter(d => Number(d?.settings?.player_type) === 1);
                    const rookieDraft =
                        rookieDrafts.find(d => Number(d.season) === leagueSeason && ['pre_draft', 'drafting'].includes(String(d.status || '').toLowerCase()))
                        || rookieDrafts.find(d => ['pre_draft', 'drafting'].includes(String(d.status || '').toLowerCase()))
                        || rookieDrafts.find(d => Number(d.season) === leagueSeason)
                        || rookieDrafts[0] || null;
                    const rookieRounds = Number(rookieDraft?.settings?.rounds) || 0;
                    // Rookie draft is trusted (sanity-capped at 12). Otherwise use the
                    // league's draft_rounds (ESPN/Yahoo bench-derived; Sleeper field),
                    // capped at the old default so a startup/roster count can't inflate.
                    const rr = rookieRounds > 0
                        ? Math.min(rookieRounds, 12)
                        : Math.min(Number(currentLeague?.settings?.draft_rounds) || DRAFT_ROUNDS, DRAFT_ROUNDS);
                    setLeagueDraftRounds(rr > 0 ? rr : null);
                    // ── Slot maps (current/upcoming draft order) ──
                    const relevantDrafts = draftsList.filter(d => pickYears.includes(Number(d.season)));
                    if (!relevantDrafts.length) return;
                    const details = isMfl
                        ? relevantDrafts // the MFL draft object IS its own detail
                        : await Promise.all(relevantDrafts.map(d =>
                            fetch('https://api.sleeper.app/v1/draft/' + d.draft_id).then(r => r.ok ? r.json() : null).catch(() => null)
                        ));
                    if (cancelled) return;
                    const maps = {};
                    const rosterIdByOwnerId = {};
                    allRosters.forEach(r => { if (r.owner_id != null) rosterIdByOwnerId[String(r.owner_id)] = String(r.roster_id); });
                    details.forEach((d, i) => {
                        if (!d?.slot_to_roster_id && !d?.draft_order && !relevantDrafts[i]?.draft_order) return;
                        const year = Number(relevantDrafts[i].season);
                        const rosterToSlot = {};
                        if (d.slot_to_roster_id) {
                            Object.entries(d.slot_to_roster_id).forEach(([slot, rosterId]) => {
                                rosterToSlot[String(rosterId)] = parseInt(slot);
                            });
                        } else {
                            Object.entries(d.draft_order || relevantDrafts[i].draft_order || {}).forEach(([ownerOrRosterId, slot]) => {
                                const rosterId = rosterIdByOwnerId[String(ownerOrRosterId)] || (allRosters.some(r => String(r.roster_id) === String(ownerOrRosterId)) ? String(ownerOrRosterId) : null);
                                if (rosterId) rosterToSlot[rosterId] = parseInt(slot);
                            });
                        }
                        maps[year] = rosterToSlot;
                    });
                    setDraftSlotMaps(maps);
                    console.log('[TradeCalc] Draft slot maps loaded:', Object.keys(maps).length, 'years');
                } catch (e) { console.warn('[TradeCalc] Draft slot maps failed:', e); }
            })();
            return () => { cancelled = true; };
        }, [leagueId, allRosters.length]);

        // League-specific rookie-draft rounds: resolved value → league setting →
        // constant (last resort only). Used everywhere instead of hardcoded 7.
        const tcDraftRounds = Math.max(1, Number(leagueDraftRounds) || Math.min(Number(currentLeague?.settings?.draft_rounds) || DRAFT_ROUNDS, DRAFT_ROUNDS));

        function ownerNameForRosterId(rid) { const r = allRosters.find(x => String(x.roster_id) === String(rid)); if (!r) return null; const u = leagueUsers.find(x => x.user_id === r.owner_id); return u?.display_name || null; }

        useEffect(() => {
            const openTradeContext = (event) => {
                const next = event?.detail || window._wrTradeContext || null;
                if (!next) return;
                setTradeContext(next);
                setTcTab('desk');
                const partnerRid = (next.rosterIds || []).find(rid => String(rid) !== String(myRoster?.roster_id));
                const partnerRoster = allRosters.find(r => String(r.roster_id) === String(partnerRid));
                // Preselect the ticker deal's partner as the finder's partner facet.
                // A focus pinning a DIFFERENT owner would out-rank the facet
                // (finderEffectivePartnerId precedence), so drop any focus that isn't
                // the user's own player — the deep link's partner intent must win.
                if (partnerRoster?.owner_id) setFinderQuery(qr => {
                    let keepFocus = null;
                    if (qr.focus?.kind === 'player') {
                        const owningRoster = allRosters.find(r => [...(r.players || []), ...(r.reserve || []), ...(r.taxi || [])].map(String).includes(String(qr.focus.id)));
                        if (owningRoster && String(owningRoster.roster_id) === String(myRoster?.roster_id)) keepFocus = qr.focus;
                    }
                    return { ...qr, partnerFilter: partnerRoster.owner_id, focus: keepFocus };
                });
            };
            window.addEventListener('wr:open-trade-context', openTradeContext);
            openTradeContext({ detail: window._wrTradeContext });
            return () => window.removeEventListener('wr:open-trade-context', openTradeContext);
        }, [allRosters.length, myRoster?.roster_id]);

        function clearTradeContext() {
            window._wrTradeContext = null;
            setTradeContext(null);
        }

        function formatTradeContextSummary(ctx) {
            if (!ctx) return '';
            if (ctx.summary) return ctx.summary;
            const ownerNames = (ctx.rosterIds || []).map(rid => ownerNameForRosterId(rid) || ('Team ' + rid)).join(' vs ');
            const addNames = Object.keys(ctx.transaction?.adds || {}).map(pid => '+' + (playersData[pid]?.full_name || pid)).slice(0, 3);
            const dropNames = Object.keys(ctx.transaction?.drops || {}).map(pid => '-' + (playersData[pid]?.full_name || pid)).slice(0, 3);
            const pickCount = ctx.transaction?.draft_picks?.length || ctx.pickCount || 0;
            const assets = [...addNames, ...dropNames, pickCount ? pickCount + ' pick' + (pickCount === 1 ? '' : 's') : null].filter(Boolean).join(', ');
            return ownerNames + (assets ? ': ' + assets : '');
        }

        // Compute WEEKLY_TARGET
        const wt = useMemo(() => {
            if (!allRosters.length || !Object.keys(playersData).length) return 243;
            return computeWeeklyTarget(allRosters);
        }, [allRosters, playersData, statsData]);
        WEEKLY_TARGET = wt;

        // Load DNA + grudges on mount
        useEffect(() => {
            if (!leagueId) return;
            if (window.OD?.loadDNA) {
                window.OD.loadDNA(leagueId).then(d => {
                    const dnaMap = d || {};
                    // Auto-apply AI DNA recommendations for owners without saved DNA
                    if (allRosters.length && typeof computeWeightedDNA === 'function') {
                        allRosters.forEach(r => {
                            const rid = r.roster_id;
                            if (!dnaMap[r.owner_id]) {
                                const aiDna = computeWeightedDNA(rid);
                                if (aiDna) dnaMap[r.owner_id] = aiDna.key;
                            }
                        });
                    }
                    setOwnerDna(dnaMap);
                }).catch(() => setOwnerDna({}));
            }
            setGrudges(loadGrudges(leagueId));
            if (window.DraftHistory?.loadDraftDNA) setOwnerDraftDna(window.DraftHistory.loadDraftDNA(leagueId) || {});
            if (window.DraftHistory?.syncDraftDNA) window.DraftHistory.syncDraftDNA(leagueId).then(map => setOwnerDraftDna(map || {})).catch(err => window.wrLog('tradecalc.syncDraftDNA', err));
        }, [leagueId]);

        // Compute assessments
        const nflStarterSet = useMemo(() => {
            if (!Object.keys(playersData).length || !Object.keys(statsData).length) return {};
            return calcNflStarterSet();
        }, [playersData, statsData]);

        const tradedPicks = useMemo(() => window.S?.tradedPicks || [], [currentLeague]);

        const picksByOwner = useMemo(() => {
            if (!allRosters.length) return {};
            const leagueSeason = parseInt(currentLeague.season || new Date().getFullYear());
            // MFL builds picks ENTIRELY from real MFL data (never the generic base
            // model, which invents a fixed 7 rounds × every team × N future years):
            //   • current draft year ← the live board (exact slots + ownership)
            //   • future years       ← TYPE=futureDraftPicks (the EXACT picks that
            //     exist — real years, real rounds, real ownership). No future picks
            //     defined ⇒ none shown. This fixes phantom 7-round future picks and
            //     makes the round/year count league-specific.
            const isMfl = !!(currentLeague?._mfl || String(currentLeague?.id || currentLeague?.league_id || '').startsWith('mfl_'));
            if (isMfl) {
                const out = {};
                // Current draft year from the live board (unmade = still tradeable).
                const draft = (window.S?.drafts || currentLeague?.drafts || []).find(d => Number(d.season) === leagueSeason);
                const slots = draft && Array.isArray(draft._slots) ? draft._slots : null;
                if (slots) {
                    slots.forEach(s => {
                        if (!s || s.player_id) return; // already drafted → now a player
                        const owner = String(s.roster_id || '');
                        if (!owner) return;
                        (out[owner] = out[owner] || []).push({
                            year: leagueSeason,
                            round: Number(s.round),
                            fromRosterId: owner,
                            slot: Number(s.draft_slot) || null,
                        });
                    });
                }
                // Future years from the authoritative future-pick ownership.
                const future = window.S?._mflFuturePicks || null;
                if (future) {
                    Object.entries(future).forEach(([owner, picks]) => {
                        (picks || []).forEach(p => {
                            if (Number(p.season) === leagueSeason) return; // current handled by the board
                            (out[owner] = out[owner] || []).push({
                                year: Number(p.season),
                                round: Number(p.round),
                                fromRosterId: String(p.roster_id),
                            });
                        });
                    });
                }
                return out;
            }
            return buildPicksByOwner(allRosters, tradedPicks, leagueSeason, tcDraftRounds, currentDraftComplete);
        }, [allRosters, tradedPicks, tcDraftRounds, currentDraftComplete]);

        const assessments = useMemo(() => {
            if (!allRosters.length || !Object.keys(playersData).length) return [];
            return allRosters.map(r => {
                const ownerPicks = picksByOwner[String(r.owner_id)] || [];
                return assessTeamLocal(r, nflStarterSet, ownerPicks, currentDraftComplete);
            });
        }, [allRosters, playersData, statsData, nflStarterSet, picksByOwner, timeRecomputeTs, leagueDraftRounds, currentDraftComplete]);

        const myRosterId = myRoster?.roster_id;
        const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: allRosters, leagueSkin: resolvedLeagueSkin }) || { isUsable: true };
        const myAssessment = useMemo(() => assessments.find(a => a.rosterId === myRosterId) || null, [assessments, myRosterId]);
        const behaviorBaselines = useMemo(() => {
            if (typeof window.App?.Intelligence?.buildLeagueBehaviorBaselines !== 'function') return null;
            return window.App.Intelligence.buildLeagueBehaviorBaselines({
                league: currentLeague,
                rosters: allRosters,
                ownerProfiles: window.App?.LI?.ownerProfiles || {},
                tradeHistory: window.App?.LI?.tradeHistory || [],
                draftOutcomes: window.App?.LI?.draftOutcomes || [],
            });
        }, [currentLeague?.league_id, allRosters.length, timeRecomputeTs]);
        const ownerBehaviorByRosterId = useMemo(() => {
            if (!behaviorBaselines || typeof window.App?.Intelligence?.buildOwnerBehaviorProfile !== 'function') return {};
            const profiles = {};
            assessments.forEach(a => {
                const dnaKey = ownerDna[a.ownerId] || null;
                profiles[String(a.rosterId)] = window.App.Intelligence.buildOwnerBehaviorProfile({
                    rosterId: a.rosterId,
                    ownerId: a.ownerId,
                    ownerName: a.ownerName,
                    assessment: a,
                    ownerProfile: window.App?.LI?.ownerProfiles?.[a.rosterId] || {},
                    tradeHistory: window.App?.LI?.tradeHistory || [],
                    draftOutcomes: window.App?.LI?.draftOutcomes || [],
                    baselines: behaviorBaselines,
                    dnaKey,
                    dnaLabel: dnaKey ? (DNA_TYPES[dnaKey]?.label || dnaKey) : undefined,
                    manualDna: !!dnaKey,
                });
            });
            window.App.LI = window.App.LI || {};
            window.App.LI.ownerBehaviorProfiles = profiles;
            window.App.LI.leagueBehaviorBaselines = behaviorBaselines;
            return profiles;
        }, [assessments, behaviorBaselines, ownerDna, timeRecomputeTs]);
        const teamContextByRosterId = useMemo(() => {
            if (typeof window.App?.Intelligence?.buildTeamContext !== 'function') return {};
            const contexts = {};
            assessments.forEach(a => {
                const roster = allRosters.find(r => String(r.roster_id) === String(a.rosterId)) || {};
                contexts[String(a.rosterId)] = window.App.Intelligence.buildTeamContext({
                    league: currentLeague,
                    profile: leagueProfile,
                    roster,
                    assessment: a,
                    playersData,
                    playerScores: window.App?.LI?.playerScores || {},
                    ownerName: a.ownerName,
                    teamName: a.teamName,
                    valueFreshness: 'live',
                });
            });
            window.App.LI = window.App.LI || {};
            window.App.LI.teamContexts = contexts;
            return contexts;
        }, [assessments, allRosters, currentLeague?.league_id, leagueProfile, playersData, timeRecomputeTs]);

        // Auto-set Side A to my team
        useEffect(() => {
            if (myAssessment?.ownerId) setTradeOwner(prev => ({ ...prev, A: myAssessment.ownerId }));
        }, [myAssessment?.ownerId]);

        const sortedAssessments = useMemo(() => {
            let list = [...assessments];
            if (tierFilter !== 'ALL') list = list.filter(a => a.tier === tierFilter);
            if (sortMode === 'health') list.sort((a,b) => b.healthScore - a.healthScore);
            else if (sortMode === 'panic') list.sort((a,b) => b.panic - a.panic);
            else if (sortMode === 'record') list.sort((a,b) => b.wins - a.wins || b.pf - a.pf);
            return list;
        }, [assessments, sortMode, tierFilter]);

        function updateDna(ownerId, dnaKey) {
            const updated = { ...ownerDna, [ownerId]: dnaKey };
            setOwnerDna(updated);
            if (window.OD?.saveDNA) window.OD.saveDNA(leagueId, updated);
        }

        function formatPickLabel(year, round, fromRosterId, explicitSlot) {
            // An explicit slot (carried on MFL board picks) wins over the per-roster
            // slot map, so multi-pick / traded-pick teams still label correctly.
            const slot = (explicitSlot != null ? explicitSlot : draftSlotMaps?.[Number(year)]?.[String(fromRosterId)]) || null;
            if (slot) return `${year} ${round}.${String(slot).padStart(2, '0')}`;
            return `${year} R${round}`;
        }

        function pickSlotForSort(year, fromRosterId) {
            const mapped = Number(draftSlotMaps?.[Number(year)]?.[String(fromRosterId)] || 0);
            if (mapped > 0) return mapped;
            const fallback = Number(fromRosterId);
            return Number.isFinite(fallback) && fallback > 0 ? fallback : 999;
        }

        function comparePicksByDraftOrder(a, b) {
            const ay = Number(a?.year || a?.season || 0);
            const by = Number(b?.year || b?.season || 0);
            const ar = Number(a?.round || 0);
            const br = Number(b?.round || 0);
            const as = a?.slot != null ? Number(a.slot) : pickSlotForSort(ay, a?.fromRosterId || a?.roster_id || a?.originalRosterId);
            const bs = b?.slot != null ? Number(b.slot) : pickSlotForSort(by, b?.fromRosterId || b?.roster_id || b?.originalRosterId);
            return ay - by || ar - br || as - bs || String(a?.fromRosterId || '').localeCompare(String(b?.fromRosterId || ''));
        }

        function makePickId(year, round, fromRosterId) {
            return `PICK-${year}-${round}-${fromRosterId}`;
        }

        function pickValueForParts(year, round, fromRosterId, explicitSlot) {
            // Explicit board slot (MFL) → value the exact slot directly.
            if (explicitSlot != null && typeof window.getPickValueBySlot === 'function') {
                const v = window.getPickValueBySlot(Number(round), Number(explicitSlot), allRosters.length || 12);
                if (v != null) return v;
            }
            const hasKnownSlot = draftSlotMaps?.[Number(year)]?.[String(fromRosterId)];
            if (hasKnownSlot && typeof _resolvePickValue === 'function') {
                const resolved = _resolvePickValue(year, Number(round), fromRosterId, allRosters, draftSlotMaps);
                if (resolved?.value != null) return resolved.value;
            }
            return getPickValue(year, Number(round), allRosters.length);
        }

        function playerAsset(pid) {
            const p = playersData[pid];
            if (!p) return null;
            const pos = normPos(p.position) || p.position || '?';
            const value = getPlayerValue(pid).value || 0;
            return {
                type: 'player',
                id: String(pid),
                pid,
                name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || String(pid),
                pos,
                team: p.team || 'FA',
                age: p.age || null,
                value,
            };
        }

        function pickAsset(pick) {
            if (!pick) return null;
            const year = pick.year || pick.season;
            const round = Number(pick.round);
            const fromRosterId = pick.fromRosterId || pick.roster_id || pick.originalRosterId;
            const slot = pick.slot != null ? Number(pick.slot) : null; // explicit board slot (MFL)
            const value = pick.val || pick.value || pickValueForParts(year, round, fromRosterId, slot);
            return {
                type: 'pick',
                // Slot makes the id unique when one team owns several picks in the
                // same round (concentrated traded picks) — without it React keys and
                // trade selection would collide.
                id: makePickId(year, round, fromRosterId) + (slot != null ? '-s' + slot : ''),
                year,
                round,
                fromRosterId,
                slot,
                label: formatPickLabel(year, round, fromRosterId, slot),
                via: ownerNameForRosterId(fromRosterId),
                value,
            };
        }

        function assetsForRoster(roster, opts = {}) {
            if (!roster) return [];
            const playerIds = [...new Set([...(roster.players || []), ...(roster.reserve || []), ...(roster.taxi || [])])];
            const exclude = new Set(opts.exclude || []);
            return playerIds
                .filter(pid => !exclude.has(pid))
                .map(playerAsset)
                .filter(a => a && a.value > 0 && (!opts.positions || opts.positions.includes(a.pos)))
                .sort((a, b) => b.value - a.value);
        }

        function playerAge(player) {
            if (!player) return null;
            if (player.age) return player.age;
            if (!player.birth_date) return null;
            const ts = new Date(player.birth_date).getTime();
            if (!Number.isFinite(ts)) return null;
            return Math.floor((Date.now() - ts) / 31557600000);
        }

        function primeYearsRemaining(pos, age) {
            if (!age) return null;
            const curve = typeof window.App?.getAgeCurve === 'function'
                ? window.App.getAgeCurve(pos)
                : { peak: (window.App?.peakWindows || {})[pos] || [24, 29] };
            const peakEnd = curve?.peak?.[1] || 29;
            return Math.max(0, peakEnd - age);
        }

        function tradeRosterIds(trade) {
            return (trade?.roster_ids || Object.keys(trade?.sides || {})).map(String).sort();
        }

        function tradePickLabel(pick) {
            if (!pick) return null;
            if (typeof pick === 'string') return pick.replace(/^PICK-/, '').replace(/-s\d+$/, '').replace(/-/g, ' ');
            if (pick.label) return pick.label;
            const year = pick.year || pick.season;
            const round = pick.round;
            const fromRosterId = pick.fromRosterId || pick.roster_id || pick.originalRosterId || pick.previous_owner_id || pick.owner_id;
            return year && round ? formatPickLabel(year, round, fromRosterId) : 'Pick';
        }

        function tradePickValue(pick) {
            if (!pick || typeof pick === 'string') return 0;
            if (pick.value || pick.val) return Number(pick.value || pick.val) || 0;
            const year = pick.year || pick.season;
            const round = pick.round;
            const fromRosterId = pick.fromRosterId || pick.roster_id || pick.originalRosterId || pick.previous_owner_id || pick.owner_id;
            return year && round ? pickValueForParts(year, Number(round), fromRosterId) : 0;
        }

        function tradeSideReceivedAssets(trade, rosterId) {
            const rid = String(rosterId);
            if (trade?.sides) {
                const side = trade.sides[rid] || {};
                const faab = Number(side.faab || side.faabDelta || side.waiverBudget || 0);
                return {
                    players: [...(side.players || [])].map(String),
                    picks: [...(side.picks || [])],
                    faab: Number.isFinite(faab) && faab > 0 ? faab : 0,
                    totalValue: Number(side.totalValue || 0) || 0,
                };
            }
            const pickMoved = pk => String(pk?.owner_id ?? '') !== String(pk?.previous_owner_id ?? '');
            const faabRows = Array.isArray(trade?.waiver_budget) ? trade.waiver_budget : [];
            return {
                players: Object.entries(trade?.adds || {}).filter(([, r]) => String(r) === rid).map(([pid]) => String(pid)),
                picks: (trade?.draft_picks || []).filter(pk => pickMoved(pk) && String(pk.owner_id) === rid),
                faab: faabRows
                    .filter(row => String(row.receiver ?? row.to ?? row.roster_id ?? '') === rid)
                    .reduce((sum, row) => sum + (Number(row.amount ?? row.value ?? 0) || 0), 0),
                totalValue: 0,
            };
        }

        function tradeSideSentAssets(trade, rosterId) {
            const rid = String(rosterId);
            if (trade?.sides) {
                return tradeRosterIds(trade).filter(otherRid => otherRid !== rid).reduce((acc, otherRid) => {
                    const received = tradeSideReceivedAssets(trade, otherRid);
                    acc.players.push(...received.players);
                    acc.picks.push(...received.picks);
                    acc.faab += received.faab || 0;
                    acc.totalValue += received.totalValue || 0;
                    return acc;
                }, { players: [], picks: [], faab: 0, totalValue: 0 });
            }
            const pickMoved = pk => String(pk?.owner_id ?? '') !== String(pk?.previous_owner_id ?? '');
            const faabRows = Array.isArray(trade?.waiver_budget) ? trade.waiver_budget : [];
            return {
                players: Object.entries(trade?.drops || {}).filter(([, r]) => String(r) === rid).map(([pid]) => String(pid)),
                picks: (trade?.draft_picks || []).filter(pk => pickMoved(pk) && String(pk.previous_owner_id) === rid),
                faab: faabRows
                    .filter(row => String(row.sender ?? row.from ?? '') === rid)
                    .reduce((sum, row) => sum + (Number(row.amount ?? row.value ?? 0) || 0), 0),
                totalValue: 0,
            };
        }

        function tradeAssetsValue(side) {
            if (!side) return 0;
            if (side.totalValue) return Number(side.totalValue) || 0;
            const playerValue = (side.players || []).reduce((sum, pid) => sum + (getPlayerValue(pid).value || 0), 0);
            const pickValue = (side.picks || []).reduce((sum, pk) => sum + tradePickValue(pk), 0);
            return playerValue + pickValue + Math.round((side.faab || 0) * FAAB_RATE);
        }

        function summarizeTradeAssets(side, limit = 3) {
            const playerNames = (side?.players || []).map(pid => playerAsset(pid)?.name || String(pid));
            const pickNames = (side?.picks || []).map(tradePickLabel).filter(Boolean);
            const faabName = side?.faab > 0 ? [`$${side.faab} FAAB`] : [];
            const assets = [...playerNames, ...pickNames, ...faabName].filter(Boolean);
            if (!assets.length) return 'No assets listed';
            const shown = assets.slice(0, limit);
            const extra = assets.length - shown.length;
            return shown.join(', ') + (extra > 0 ? ` +${extra}` : '');
        }

        function tradeTimestampMs(trade) {
            const raw = Number(trade?.created || trade?.ts || trade?.status_updated || 0);
            if (!Number.isFinite(raw) || raw <= 0) return 0;
            return raw < 10000000000 ? raw * 1000 : raw;
        }

        function pickAssetsForOwner(ownerId) {
            return (picksByOwner[String(ownerId)] || [])
                .map(pickAsset)
                .filter(Boolean)
                .sort((a, b) => b.value - a.value || comparePicksByDraftOrder(a, b));
        }

        function clampNum(value, min, max, fallback = min) {
            const n = Number(value);
            if (!Number.isFinite(n)) return fallback;
            return Math.max(min, Math.min(max, n));
        }

        // GM Strategy is the single source of truth for Deal HQ tuning. All
        // YOUR-side knobs (aggression, acceptance floor, overpay budget, target/
        // sell/untouchable positions) come from the shared WR.GmMode.effects
        // resolver. The Alex "Trade aggression" slider NO LONGER overrides
        // aggression or the floor — only tradePriority.positions survives, as an
        // additive shopping hint unioned into targetPositions. The opponent's
        // displayed acceptance % is computed elsewhere and is never touched here.
        function getDealHqTuning(alexSettings = {}) {
            const eff = window.WR?.GmMode?.effects?.(leagueId) || {};
            const aggression = clampNum(eff.aggression, 0.2, 0.92, 0.52);
            const targetPositions = new Set([
                ...(eff.targetPositions || []),
                ...Object.entries(alexSettings.tradePriority?.positions || {}).filter(([, v]) => v).map(([k]) => k),
            ]);
            return {
                strategy: eff.strategy || {},
                mode: eff.mode || 'compete',
                modeLabel: eff.modeLabel || 'Compete',
                aggression,
                minAcceptance: clampNum(eff.acceptanceFloor, 55, 90, 75),
                maxUserGainPct: Number.isFinite(eff.maxUserGainPct) ? eff.maxUserGainPct : 0.14 + aggression * 0.26,
                maxOverpayPct: Number.isFinite(eff.maxOverpayPct) ? eff.maxOverpayPct : 0.12,
                targetPositions,
                sellPositions: eff.sellPositions || new Set(),
                untouchable: eff.untouchable || new Set(),
            };
        }

        function dealActionableAcceptanceFloor(tuning = {}) {
            return clampNum(tuning.minAcceptance, 55, 90, 75);
        }

        function isUntouchableAsset(asset, tuning) {
            return !!asset?.pid && tuning?.untouchable?.has(String(asset.pid));
        }

        function scoreDealRecommendation(deal, tuning) {
            if (!deal) return 0;
            const maxSide = Math.max(deal.totals?.give?.total || 0, deal.totals?.receive?.total || 0, 1);
            const userGainPct = deal.userGain / maxSide;
            const lowAcceptancePenalty = Math.max(0, dealActionableAcceptanceFloor(tuning) - deal.likelihood) * 3.2;
            const greedPenalty = Math.max(0, userGainPct - (tuning.maxUserGainPct || 0.25)) * 170;
            const overpayPenalty = Math.max(0, Math.abs(Math.min(0, userGainPct)) - (tuning.maxOverpayPct || 0.12)) * 125;
            const cautionPenalty = (deal.caution || []).length * 3;
            const fairValueBonus = Math.max(0, 18 - Math.abs(userGainPct) * 55);
            return Math.round(
                deal.likelihood * 1.4
                + deal.fit * 0.42
                + deal.confidenceScore * 0.46
                + fairValueBonus
                - lowAcceptancePenalty
                - greedPenalty
                - overpayPenalty
                - cautionPenalty
            );
        }

        function dealViability(deal, tuning) {
            if (!deal) return 'unknown';
            const actionFloor = dealActionableAcceptanceFloor(tuning);
            if (deal.likelihood >= Math.min(90, actionFloor + 10)) return 'Playable';
            if (deal.likelihood >= actionFloor) return 'Negotiable';
            return 'Moonshot';
        }

        function sideBreakdown(players = [], picks = [], faab = 0) {
            const playerValue = players.reduce((s, a) => s + (a.value || 0), 0);
            const pickValue = picks.reduce((s, a) => s + (a.value || 0), 0);
            const faabValue = Math.round((faab || 0) * FAAB_RATE);
            // market: liquidity-adjusted total (IDP/K haircut) — what the finder
            // matches and prices acceptance on. total stays raw DHQ for display.
            const marketPlayerValue = players.reduce((s, a) => s + assetMarketValue(a), 0);
            return {
                playerValue,
                pickValue,
                pickCount: picks.length,
                faab: faab || 0,
                faabValue,
                total: playerValue + pickValue + faabValue,
                market: marketPlayerValue + pickValue + faabValue,
            };
        }

        function dealWindowImpact(givePlayers, receivePlayers) {
            // Player-only read: a pick asset has no pos/age and would be scored as a
            // 25-year-old — filter picks defensively even though callers pass player arrays.
            const playersOnly = list => (list || []).filter(a => a && a.type !== 'pick');
            const yearsFor = asset => {
                const end = typeof window.App?.getValueWindowEnd === 'function'
                    ? window.App.getValueWindowEnd(asset.pos)
                    : ((window.App?.peakWindows || {})[asset.pos] || [24, 29])[1];
                return Math.max(0, end - (asset.age || 25));
            };
            const give = playersOnly(givePlayers).reduce((s, p) => s + yearsFor(p), 0);
            const receive = playersOnly(receivePlayers).reduce((s, p) => s + yearsFor(p), 0);
            const delta = receive - give;
            if (delta >= 3) return { label: 'Extends window', color: 'var(--good)' };
            if (delta <= -3) return { label: 'Shortens window', color: 'var(--bad)' };
            return { label: 'Window neutral', color: 'var(--silver)' };
        }

        function explainRosterSwing(partner, givePlayers, receivePlayers) {
            // Player-only read — pick assets carry no pos; keep them out of the position sets.
            const receivePos = [...new Set((receivePlayers || []).filter(p => p && p.type !== 'pick').map(p => p.pos))];
            const givePos = [...new Set((givePlayers || []).filter(p => p && p.type !== 'pick').map(p => p.pos))];
            const myNeeds = (myAssessment?.needs || []).map(n => n.pos);
            const theirNeeds = (partner?.needs || []).map(n => n.pos);
            const fixesMine = receivePos.find(pos => myNeeds.includes(pos));
            const fixesTheirs = givePos.find(pos => theirNeeds.includes(pos));
            if (fixesMine && fixesTheirs) return `Mutual need fit: you add ${fixesMine}, they add ${fixesTheirs}.`;
            if (fixesMine) return `Addresses your ${fixesMine} gap.`;
            if (fixesTheirs) return `Fills their ${fixesTheirs} need.`;
            if (receivePos.length || givePos.length) return `Asset swap centered on ${[...receivePos, ...givePos].slice(0, 2).join('/')}.`;
            return 'Draft capital and FAAB shape the deal more than roster fit.';
        }

        function buildDeal(partner, input) {
            if (!partner || !myAssessment) return null;
            const dnaKey = ownerDna[partner.ownerId] || 'NONE';
            const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
            const posture = calcOwnerPosture(partner, dnaKey);
            const taxes = calcPsychTaxes(myAssessment, partner, dnaKey, posture);
            const grudge = calcGrudgeTax(myAssessment.ownerId, partner.ownerId, grudges, dnaKey);
            const acceptanceTaxes = grudge.total
                ? [...taxes, { name:'Grudge Tax', impact:grudge.total, type: grudge.total > 0 ? 'BONUS' : 'TAX' }]
                : taxes;
            const givePlayers = input.givePlayers || [];
            const receivePlayers = input.receivePlayers || [];
            const givePicks = input.givePicks || [];
            const receivePicks = input.receivePicks || [];
            const giveFaab = input.giveFaab || 0;
            const receiveFaab = input.receiveFaab || 0;
            const give = sideBreakdown(givePlayers, givePicks, giveFaab);
            const receive = sideBreakdown(receivePlayers, receivePicks, receiveFaab);
            if (give.total <= 0 || receive.total <= 0) return null;
            const pieceCount = givePlayers.length + receivePlayers.length + givePicks.length + receivePicks.length;
            // Acceptance is priced on MARKET totals (liquidity-adjusted): a side
            // stuffed with mid-tier IDP value doesn't buy what raw DHQ says it does.
            const baseLikelihood = calcAcceptanceLikelihood(give.market ?? give.total, receive.market ?? receive.total, dnaKey, acceptanceTaxes, myAssessment, partner, { totalPieces: pieceCount });
            const gradeRaw = window.App?.TradeEngine?.fairnessGrade
                ? window.App.TradeEngine.fairnessGrade(give.total, receive.total)
                : { grade: receive.total >= give.total ? 'B+' : 'C', label: receive.total >= give.total ? 'Win' : 'Overpay', color: receive.total >= give.total ? 'var(--good)' : 'var(--bad)' };
            const userGain = receive.total - give.total;
            const behaviorProfile = ownerBehaviorByRosterId?.[String(partner.rosterId)] || null;
            const behaviorFit = behaviorProfile && typeof window.App?.Intelligence?.evaluateBehaviorTradeFit === 'function'
                ? window.App.Intelligence.evaluateBehaviorTradeFit({
                    behaviorProfile,
                    givePlayers,
                    givePicks,
                    receivePlayers,
                    receivePicks,
                    userGain,
                })
                : null;
            const likelihood = Math.round(Math.max(5, Math.min(95, baseLikelihood + (behaviorFit?.acceptanceDelta || 0))));
            const fit = myAssessment ? calcComplementarity(myAssessment, partner) : 0;
            const valueScore = Math.max(0, Math.min(100, 50 + (userGain / Math.max(give.total, receive.total, 1)) * 120));
            const confidenceScore = Math.round(Math.max(0, Math.min(100, likelihood * 0.45 + fit * 0.25 + valueScore * 0.30 + (behaviorFit?.scoreDelta || 0))));
            const confidence = confidenceScore >= 72 ? 'High' : confidenceScore >= 50 ? 'Medium' : 'Low';
            const windowImpact = dealWindowImpact(givePlayers, receivePlayers);
            const swing = explainRosterSwing(partner, givePlayers, receivePlayers);
            const formatReadout = formatReadoutForDeal(givePlayers, receivePlayers);
            const behaviorReadout = behaviorFit?.framing || behaviorProfile?.observedFacts?.[0]?.detail || '';
            const caution = [];
            if (likelihood < 40) caution.push('Low acceptance odds');
            if (posture.key === 'LOCKED') caution.push('Locked roster');
            if (userGain < -Math.max(500, receive.total * 0.12)) caution.push('Meaningful overpay');
            if (!swing.includes('need') && !swing.includes('gap')) caution.push('Weak roster-fit signal');
            if (givePicks.length && receivePicks.length) caution.push('Pick timing matters');
            if (behaviorProfile?.inferences?.includes('low-liquidity')) caution.push('Low-liquidity partner');
            const mktGap = side => side.total > 0 ? (side.total - (side.market ?? side.total)) / side.total : 0;
            if (mktGap(give) > 0.15 || mktGap(receive) > 0.15) caution.push('IDP/K priced to market, not points');
            const whyAccept = input.whyAccept || (partner.needs?.length
                ? `They need ${partner.needs.slice(0, 2).map(n => n.pos).join('/')} and this gives them usable assets.`
                : `Their ${posture.label.toLowerCase()} posture keeps them open to a clean value offer.`);
            const whyYou = input.whyYou || (userGain >= 0
                ? `You gain ${Math.abs(Math.round(userGain)).toLocaleString()} DHQ while improving deal fit.`
                : `You pay ${Math.abs(Math.round(userGain)).toLocaleString()} DHQ for a roster or window upgrade.`);
            const dealId = input.id || `deal_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            const dealFormatReasons = formatReasonsForAssets(receivePlayers).concat(formatReasonsForAssets(givePlayers)).slice(0, 3);
            const userContext = teamContextByRosterId?.[String(myRosterId)] || null;
            const partnerContext = teamContextByRosterId?.[String(partner.rosterId)] || null;
            const intelligence = typeof window.App?.Intelligence?.buildTradeRecommendation === 'function'
                ? window.App.Intelligence.buildTradeRecommendation({
                    id: dealId,
                    partnerName: partner.ownerName,
                    partnerOwnerId: partner.ownerId,
                    partnerRosterId: partner.rosterId,
                    userGain,
                    likelihood,
                    fit,
                    confidence,
                    confidenceScore,
                    posture,
                    dnaLabel: (DNA_TYPES[dnaKey] || DNA_TYPES.NONE)?.label || dnaKey,
                    totals: { give, receive },
                    profile: leagueProfile,
                    formatReasons: dealFormatReasons,
                    behaviorProfile,
                    behaviorFit,
                    userContext,
                    partnerContext,
                    whyAccept,
                    whyYou,
                    detail: whyYou,
                })
                : null;
            return {
                id: dealId,
                mode: input.mode || finderQuery.intent,
                type: input.type || 'Deal',
                partnerOwnerId: partner.ownerId,
                partnerRosterId: partner.rosterId,
                partnerName: partner.ownerName,
                partnerTeam: partner.teamName,
                dnaKey,
                posture,
                givePlayers,
                receivePlayers,
                givePicks,
                receivePicks,
                giveFaab,
                receiveFaab,
                totals: { give, receive },
                userGain,
                likelihood,
                grade: gradeRaw.grade,
                gradeLabel: gradeRaw.label,
                gradeColor: gradeRaw.color || gradeRaw.col || 'var(--gold)',
                fit,
                confidence,
                confidenceScore,
                taxes,
                grudge,
                whyAccept,
                whyYou,
                intelligence,
                behaviorProfile,
                behaviorFit,
                userContext,
                partnerContext,
                swing,
                formatReadout,
                behaviorReadout,
                windowImpact,
                caution,
                rank: Math.round(likelihood * 1.2 + fit * 0.8 + valueScore + (confidenceScore / 2)),
                createdAt: input.createdAt || new Date().toISOString(),
                status: input.status || 'idea',
            };
        }

        function maybeBalanceFaab(partner, givePlayers, receivePlayers, givePicks = [], receivePicks = []) {
            const give = sideBreakdown(givePlayers, givePicks, 0).total;
            const receive = sideBreakdown(receivePlayers, receivePicks, 0).total;
            const gap = receive - give;
            const maxMyFaab = Math.max(0, Math.min(myAssessment?.faabRemaining || 0, 300));
            const maxTheirFaab = Math.max(0, Math.min(partner?.faabRemaining || 0, 300));
            if (gap > 100 && gap <= 600 && maxMyFaab > 0) return { giveFaab: Math.min(maxMyFaab, Math.ceil(gap / FAAB_RATE)), receiveFaab: 0 };
            if (gap < -100 && Math.abs(gap) <= 600 && maxTheirFaab > 0) return { giveFaab: 0, receiveFaab: Math.min(maxTheirFaab, Math.ceil(Math.abs(gap) / FAAB_RATE)) };
            return { giveFaab: 0, receiveFaab: 0 };
        }

        // Market-reality guard (owner ruling): a side whose value is mostly
        // NON-ELITE IDP/K players cannot pay for a side that is mostly offense —
        // nobody trades a starting TE for a mid LB, or George Pickens for a
        // rotational DL. Elite IDPs (top-5 at their position) are liquid and
        // pass; pick-heavy and FAAB-heavy sides pass (draft capital is liquid).
        // IDP-for-IDP and IDP-for-picks ideas remain fully allowed.
        function crossClassUnrealistic(input) {
            const OFFENSE = ['QB', 'RB', 'WR', 'TE'];
            const sideRead = (players = [], picks = [], faab = 0) => {
                const bd = sideBreakdown(players, picks, faab);
                if (bd.total <= 0) return { lowShare: 0, offShare: 0 };
                const lowVal = players.reduce((s, a) => s + (isLowLiquidAsset(a) ? (a.value || 0) : 0), 0);
                const offVal = players.reduce((s, a) => s + (OFFENSE.includes(a.pos) ? (a.value || 0) : 0), 0);
                return { lowShare: lowVal / bd.total, offShare: offVal / bd.total };
            };
            const give = sideRead(input.givePlayers, input.givePicks, input.giveFaab);
            const receive = sideRead(input.receivePlayers, input.receivePicks, input.receiveFaab);
            return (give.lowShare >= 0.5 && receive.offShare >= 0.5)
                || (receive.lowShare >= 0.5 && give.offShare >= 0.5);
        }

        function addCandidate(candidates, partner, input) {
            if (crossClassUnrealistic(input)) return;
            const deal = buildDeal(partner, input);
            if (!deal) return;
            // _core — the deal's IDEA identity (owner ruling: the board kept
            // showing the same trade over and over with only the payment
            // shuffled — "Oluokun → Hines-Allen" three times with R6/R7/FAAB
            // variants, Kyler Murray offered three ways). The idea a user reads
            // is WHO the deal lands (per partner): rows keyed on the receive-side
            // player set; sell-for-picks rows keyed on the give-side player set;
            // pure pick swaps keyed on the pick sets. Only the best-ranked
            // package per idea survives — alternates live in Load in Builder.
            const core = JSON.stringify([
                deal.partnerOwnerId,
                deal.receivePlayers.length ? ['get', deal.receivePlayers.map(p => String(p.pid)).sort()]
                    : deal.givePlayers.length ? ['sell', deal.givePlayers.map(p => String(p.pid)).sort()]
                        : ['picks', deal.givePicks.map(p => p.id).sort(), deal.receivePicks.map(p => p.id).sort()],
            ]);
            const sig = JSON.stringify([
                deal.partnerOwnerId,
                deal.givePlayers.map(p => p.pid).sort(),
                deal.receivePlayers.map(p => p.pid).sort(),
                deal.givePicks.map(p => p.id).sort(),
                deal.receivePicks.map(p => p.id).sort(),
                deal.giveFaab,
                deal.receiveFaab,
            ]);
            if (candidates.some(d => d._sig === sig)) return;
            let hash = 0;
            for (let i = 0; i < sig.length; i++) hash = ((hash << 5) - hash + sig.charCodeAt(i)) | 0;
            candidates.push({ ...deal, id: `deal_${Math.abs(hash).toString(36)}`, _sig: sig, _core: core });
        }

        // ── Finder-query resolution seam (Phase 4a) ──
        // resolveFinderFocus: player/pick focuses may be seeded minimally by event
        // handlers; enrich with label/pos/current ownership at render time so ownership
        // is always fresh (rosters and pick ownership change) and handlers avoid stale
        // closures. Pick focuses additionally attach the LIVE pickAsset (value/label/
        // slot) so generation never re-derives it from a stale seed.
        function resolveFinderFocus(focus) {
            if (!focus) return null;
            if (focus.kind === 'pick') {
                for (const a of assessments) {
                    const match = pickAssetsForOwner(a.ownerId).find(pk => pk.id === focus.id);
                    if (match) return { ...focus, label: match.label, ownerId: a.ownerId, rosterId: a.rosterId, pickAsset: match };
                }
                return { ...focus, pickAsset: null }; // pick left the pool (drafted/unknown) — keep seed for display
            }
            if (focus.kind !== 'player') return focus;
            const asset = playerAsset(focus.id);
            const roster = allRosters.find(r => [...(r.players || []), ...(r.reserve || []), ...(r.taxi || [])].map(String).includes(String(focus.id)));
            return {
                ...focus,
                label: focus.label || asset?.name || String(focus.id),
                pos: focus.pos || asset?.pos || null,
                ownerId: roster ? roster.owner_id : (focus.ownerId ?? null),
                rosterId: roster ? roster.roster_id : (focus.rosterId ?? null),
            };
        }

        // Effective partner: owner focus > league-side asset focus's owner > partner facet.
        function finderEffectivePartnerId(focusResolved) {
            const f = focusResolved === undefined ? resolveFinderFocus(finderQuery.focus) : focusResolved;
            if (f && f.kind === 'owner') return f.id;
            if (f && f.ownerId != null && f.rosterId != null && String(f.rosterId) !== String(myRosterId)) return f.ownerId;
            return finderQuery.partnerFilter;
        }

        // Map { intent, focus } onto the existing generator's legacy modes. Focus
        // ownership wins inside an intent: my asset → shop it, their asset → acquire it.
        // Pick focuses route by ownership too — generation places them in the correct
        // pick slots via addAcquirePickTarget/addShopPickAsset (never the player slots).
        // One deliberate exception: MY player + 'picks' intent keeps mode 'picks'
        // (shop him for pick-only returns — the picks filter is the point).
        function deriveFinderMode(query, focusResolved) {
            const f = focusResolved;
            const isAsset = f?.kind === 'player' || f?.kind === 'pick';
            const mine = isAsset && f.rosterId != null && String(f.rosterId) === String(myRosterId);
            const theirs = isAsset && f.rosterId != null && !mine;
            if (f?.kind === 'pick') return mine ? 'shop' : theirs ? 'acquire' : (query.intent === 'picks' ? 'picks' : 'fillNeed');
            if (theirs) return 'acquire';
            if (query.intent === 'picks') return 'picks';
            if (mine) return 'shop';
            if (query.intent === 'shop') return 'sellSurplus';
            return 'fillNeed'; // 'best' (league-wide dual scan when unpinned) and 'help'
        }

        function generateDealsForPartner(partner, mode, focusPid, opts = {}) {
            const myRosterObj = allRosters.find(r => r.roster_id === myRosterId);
            const theirRosterObj = allRosters.find(r => r.roster_id === partner?.rosterId);
            if (!partner || !myRosterObj || !theirRosterObj) return [];

            const alexSettings = window.WR?.AlexSettings?.get?.() || {};
            const tuning = getDealHqTuning(alexSettings);
            const aggression = tuning.aggression;
            const lowRatio = 0.90 - aggression * 0.18;
            const highRatio = 1.08 + aggression * 0.24;

            const tp = alexSettings.tradePriority || {};
            const priPos = Object.entries(tp.positions || {}).filter(([, v]) => v).map(([k]) => k);
            const priPickYears = Object.entries(tp.picks || {}).filter(([, v]) => v).map(([k]) => k);
            const priFaab = tp.faab !== false;

            const myNeedPos = (myAssessment?.needs || []).map(n => n.pos);
            const effectiveNeedPos = [...new Set([...myNeedPos, ...priPos, ...tuning.targetPositions])];
            const mySurplusPos = myAssessment?.strengths || [];
            const theirNeedPos = (partner.needs || []).map(n => n.pos);
            const myPlayers = assetsForRoster(myRosterObj).filter(p => !isUntouchableAsset(p, tuning));
            const theirPlayers = assetsForRoster(theirRosterObj);
            const myChips = myPlayers.filter(p =>
                tuning.sellPositions.has(p.pos)
                || mySurplusPos.includes(p.pos)
                || !myNeedPos.includes(p.pos)
            );
            const allTheirPicks = pickAssetsForOwner(partner.ownerId);
            const allMyPicks = pickAssetsForOwner(myAssessment?.ownerId);
            const theirPicks = priPickYears.length ? allTheirPicks.filter(pk => priPickYears.some(yr => pk.label?.includes(yr))) : allTheirPicks;
            const myPicks = priPickYears.length ? allMyPicks.filter(pk => priPickYears.some(yr => pk.label?.includes(yr))) : allMyPicks;
            const candidates = [];

            const focusAsset = focusPid ? playerAsset(focusPid) : null;
            const theirPlayerIds = new Set([...(theirRosterObj.players || []), ...(theirRosterObj.reserve || []), ...(theirRosterObj.taxi || [])].map(String));
            const myPlayerIds = new Set([...(myRosterObj.players || []), ...(myRosterObj.reserve || []), ...(myRosterObj.taxi || [])].map(String));
            const targetPool = focusAsset && theirPlayerIds.has(String(focusPid))
                ? [focusAsset]
                : theirPlayers.filter(p => {
                    if (mode === 'fillNeed') return effectiveNeedPos.length ? effectiveNeedPos.includes(p.pos) : true;
                    if (mode === 'acquire') return priPos.length || tuning.targetPositions.size ? effectiveNeedPos.includes(p.pos) : true;
                    return true;
                }).slice(0, 12);
            const shopPool = focusAsset && myPlayerIds.has(String(focusPid)) && !isUntouchableAsset(focusAsset, tuning)
                ? [focusAsset]
                : myPlayers.filter(p => {
                    if (mode === 'sellSurplus' || mode === 'shop' || mode === 'picks') {
                        return tuning.sellPositions.has(p.pos) || mySurplusPos.includes(p.pos) || theirNeedPos.includes(p.pos);
                    }
                    return true;
                }).slice(0, 12);
            const balanceFaab = (...args) => priFaab ? maybeBalanceFaab(...args) : { giveFaab: 0, receiveFaab: 0 };

            // targetValue here is a MARKET value (liquidity-adjusted); combos are
            // matched and banded on their own market totals so an IDP-stuffed
            // package can't "afford" an offensive starter at face DHQ.
            function sideCombos(players, picks, targetValue, opts = {}) {
                const playerPool = (players || []).filter(Boolean).slice(0, opts.playerLimit || 12);
                const pickPool = (picks || []).filter(Boolean).slice(0, opts.pickLimit || 7);
                const combos = [];
                const seen = new Set();
                const push = (comboPlayers = [], comboPicks = []) => {
                    if (!comboPlayers.length && !comboPicks.length) return;
                    const bd = sideBreakdown(comboPlayers, comboPicks, 0);
                    if (bd.total <= 0) return;
                    const sig = JSON.stringify([
                        comboPlayers.map(p => p.id || p.pid).sort(),
                        comboPicks.map(p => p.id).sort(),
                    ]);
                    if (seen.has(sig)) return;
                    seen.add(sig);
                    combos.push({ players: comboPlayers, picks: comboPicks, total: bd.total, market: bd.market, pieces: comboPlayers.length + comboPicks.length });
                };
                playerPool.forEach(p => push([p], []));
                for (let i = 0; i < Math.min(playerPool.length, 10); i++) {
                    for (let j = i + 1; j < Math.min(playerPool.length, 10); j++) {
                        push([playerPool[i], playerPool[j]], []);
                    }
                }
                playerPool.slice(0, 9).forEach(p => pickPool.slice(0, 6).forEach(pk => push([p], [pk])));
                if (opts.allowPickOnly) {
                    pickPool.forEach(pk => push([], [pk]));
                    for (let i = 0; i < Math.min(pickPool.length, 5); i++) {
                        for (let j = i + 1; j < Math.min(pickPool.length, 5); j++) push([], [pickPool[i], pickPool[j]]);
                    }
                }
                return combos.sort((a, b) => Math.abs(a.market - targetValue) - Math.abs(b.market - targetValue) || a.pieces - b.pieces || b.market - a.market);
            }

            function addAcquireTarget(target, playerPool, pickPool, reasonPrefix = '') {
                const targetMkt = assetMarketValue(target);
                const packages = sideCombos(playerPool, pickPool, targetMkt, { allowPickOnly: true });
                packages
                    .filter(pkg => pkg.market >= targetMkt * lowRatio && pkg.market <= targetMkt * highRatio)
                    .slice(0, 4)
                    .forEach(pkg => {
                        const faab = balanceFaab(partner, pkg.players, [target], pkg.picks, []);
                        const givePos = [...new Set(pkg.players.map(p => p.pos))];
                        addCandidate(candidates, partner, {
                            mode,
                            type: !pkg.players.length ? 'Pick package' : pkg.players.length > 1 ? 'Consolidation' : pkg.picks.length ? 'Player + pick' : (pkg.players[0]?.pos === target.pos ? 'Lateral upgrade' : 'Need fill'),
                            givePlayers: pkg.players,
                            givePicks: pkg.picks,
                            receivePlayers: [target],
                            ...faab,
                            whyAccept: theirNeedPos.some(pos => givePos.includes(pos))
                                ? `${reasonPrefix}They get ${givePos.filter(pos => theirNeedPos.includes(pos)).join('/')} help in a value-balanced package.`
                                : `${reasonPrefix}The value band is close enough to start a real negotiation.`,
                            whyYou: myNeedPos.includes(target.pos)
                                ? `You address ${target.pos} while keeping the offer inside your GM Office risk band.`
                                : `You consolidate assets into a preferred ${target.pos} target without making it a pure lowball.`,
                        });
                    });
            }

            // ── Pick-focus paths (Phase 4c) — a focused pick goes in the PICK slots.
            // addAcquireTarget/addShopAsset hardcode receivePlayers/givePlayers, so a
            // pickAsset (no pid/pos/age) must never route through them: it would vanish
            // from builder totals, print "undefined" in copy, and invert the
            // pick-collector/spender acceptance deltas in evaluateBehaviorTradeFit.
            function addAcquirePickTarget(pick, playerPool, pickPool, reasonPrefix = '') {
                const packages = sideCombos(playerPool, pickPool, pick.value, { allowPickOnly: true });
                packages
                    .filter(pkg => pkg.market >= pick.value * lowRatio && pkg.market <= pick.value * highRatio)
                    .slice(0, 4)
                    .forEach(pkg => {
                        const faab = balanceFaab(partner, pkg.players, [], pkg.picks, [pick]);
                        const givePos = [...new Set(pkg.players.map(p => p.pos))];
                        const needHit = givePos.filter(pos => theirNeedPos.includes(pos));
                        addCandidate(candidates, partner, {
                            mode,
                            type: !pkg.players.length ? 'Pick swap' : 'Buy draft capital',
                            givePlayers: pkg.players,
                            givePicks: pkg.picks,
                            receivePicks: [pick],
                            ...faab,
                            whyAccept: needHit.length
                                ? `${reasonPrefix}They turn the ${pick.label} into ${needHit.join('/')} help they can line up now.`
                                : `${reasonPrefix}They cash a future pick for value they can use immediately.`,
                            whyYou: pkg.players.length
                                ? `You land the ${pick.label} without touching your core — the package stays inside your GM Office bands.`
                                : `You reshape draft capital toward the ${pick.label} at a fair exchange rate.`,
                        });
                    });
            }

            function addShopPickAsset(pick, returnPlayers, returnPicks, reasonPrefix = '') {
                const returns = sideCombos(returnPlayers, returnPicks, pick.value, { allowPickOnly: true });
                const returnLow = 0.72 - aggression * 0.08;
                const returnHigh = 1.04 + aggression * 0.18;
                returns
                    .filter(pkg => pkg.market >= pick.value * returnLow && pkg.market <= pick.value * returnHigh)
                    .slice(0, 4)
                    .forEach(pkg => {
                        const faab = balanceFaab(partner, [], pkg.players, [pick], pkg.picks);
                        addCandidate(candidates, partner, {
                            mode,
                            type: pkg.picks.length && !pkg.players.length ? 'Pick swap' : 'Sell draft capital',
                            givePicks: [pick],
                            receivePlayers: pkg.players,
                            receivePicks: pkg.picks,
                            ...faab,
                            whyAccept: `${reasonPrefix}They bank the ${pick.label} — future capital at zero roster cost.`,
                            whyYou: pkg.players.length
                                ? `You convert the ${pick.label} into roster help you can start this week.`
                                : `You trade the ${pick.label} for picks that fit your window better.`,
                        });
                    });
            }

            function addShopAsset(asset, returnPlayers, returnPicks, reasonPrefix = '') {
                const assetMkt = assetMarketValue(asset);
                const returns = sideCombos(returnPlayers, returnPicks, assetMkt, { allowPickOnly: true });
                const returnLow = mode === 'picks' ? 0.50 : 0.72 - aggression * 0.08;
                const returnHigh = 1.04 + aggression * 0.18;
                returns
                    .filter(pkg => pkg.market >= assetMkt * returnLow && pkg.market <= assetMkt * returnHigh)
                    .filter(pkg => mode !== 'picks' || pkg.picks.length)
                    .slice(0, 4)
                    .forEach(pkg => {
                        const partnerFit = theirNeedPos.includes(asset.pos);
                        const faab = balanceFaab(partner, [asset], pkg.players, [], pkg.picks);
                        addCandidate(candidates, partner, {
                            mode,
                            type: pkg.picks.length && !pkg.players.length ? 'Pick capital' : pkg.picks.length ? 'Rebalance package' : 'Value swap',
                            givePlayers: [asset],
                            receivePlayers: pkg.players,
                            receivePicks: pkg.picks,
                            ...faab,
                            whyAccept: partnerFit
                                ? `${reasonPrefix}They need ${asset.pos}, and this uses your surplus against their roster gap.`
                                : `${reasonPrefix}They get the cleaner player while sending back a balanced return.`,
                            whyYou: pkg.picks.length
                                ? `You convert ${asset.pos} value into draft flexibility aligned with GM Office priorities.`
                                : `You reset value into a roster fit without forcing a lopsided ask.`,
                        });
                    });
            }

            // Pick focus dominates the mode branches: the focused pick is the deal's
            // anchor (my pick → shop it to this partner; their pick → bid on it).
            const focusPick = opts.focusPick && opts.focusPick.pickAsset ? opts.focusPick : null;
            if (focusPick) {
                const pickIsMine = String(focusPick.ownerId ?? '') === String(myAssessment?.ownerId ?? '');
                if (pickIsMine) {
                    addShopPickAsset(focusPick.pickAsset, theirPlayers, theirPicks);
                    if (candidates.length < 3) {
                        addShopPickAsset(focusPick.pickAsset, theirPlayers, allTheirPicks, 'Fallback board: ');
                    }
                } else if (String(focusPick.ownerId ?? '') === String(partner.ownerId ?? '')) {
                    const givePool = myChips.length ? myChips : myPlayers;
                    addAcquirePickTarget(focusPick.pickAsset, givePool, myPicks);
                    if (candidates.length < 3) {
                        addAcquirePickTarget(focusPick.pickAsset, myPlayers, myPicks.length ? myPicks : allMyPicks, 'Fallback board: ');
                    }
                }
                // Third-party pick vs a different pinned partner can't happen —
                // finderEffectivePartnerId pins the pick's owner; guard stays silent.
            } else if (mode === 'acquire' || mode === 'fillNeed') {
                const givePool = myChips.length ? myChips : myPlayers;
                targetPool.slice(0, 8).forEach(target => addAcquireTarget(target, givePool, myPicks));
                if (candidates.length < 3) {
                    theirPlayers.slice(0, 14).forEach(target => addAcquireTarget(target, myPlayers, myPicks.length ? myPicks : allMyPicks, 'Fallback board: '));
                }
            } else if (mode === 'shop' || mode === 'sellSurplus' || mode === 'picks') {
                shopPool.slice(0, 8).forEach(asset => addShopAsset(asset, theirPlayers, theirPicks));
                if (candidates.length < 3) {
                    myPlayers.slice(0, 12).forEach(asset => addShopAsset(asset, theirPlayers, allTheirPicks, 'Fallback board: '));
                }
            }

            // Core-dedupe AFTER rank sorting: one row per trade idea (player core),
            // and it's the best-ranked variant of that idea that survives.
            const seenCore = new Set();
            const ranked = candidates
                .map(deal => {
                    const rank = scoreDealRecommendation(deal, tuning);
                    return { ...deal, rank, recommendationScore: rank, viability: dealViability(deal, tuning) };
                })
                .sort((a, b) => b.rank - a.rank || b.likelihood - a.likelihood || b.fit - a.fit)
                .filter(deal => {
                    if (seenCore.has(deal._core)) return false;
                    seenCore.add(deal._core);
                    return true;
                })
                .slice(0, 8);
            // keepSig: the league-wide pool (Phase 4b) dedupes across modes/partners by
            // _sig and collapses idea-duplicates by _core; the pooling layer strips
            // both before deals leave the finder.
            return opts.keepSig ? ranked : ranked.map(({ _sig, _core, ...deal }) => deal);
        }

        // Merge-on-write (post-review lost-update fix): league-detail's Alex-chat Save
        // appends to the SAME storage key via WrTradePipeline.append, so blind-writing
        // this component's in-memory savedDeals array would clobber rows saved since
        // our last read. Every mutation re-reads the store fresh (normalizeAll over
        // the raw read), applies the caller's mutator against those fresh rows, writes
        // the merged result, and syncs component state from what was actually written.
        // localStorage is synchronous, so the read→mutate→write window is race-narrow.
        function persistSavedDeals(mutate) {
            const raw = WrStorage?.get
                ? (WrStorage.get(savedDealsKey, []) || [])
                : (() => { try { return JSON.parse(localStorage.getItem(savedDealsKey) || '[]'); } catch(e) { return []; } })();
            const fresh = window.WrTradePipeline.normalizeAll(raw).rows;
            const next = mutate(fresh);
            setSavedDeals(next);
            if (WrStorage?.set) WrStorage.set(savedDealsKey, next);
            else localStorage.setItem(savedDealsKey, JSON.stringify(next));
        }

        function saveDeal(deal) {
            if (!deal) return;
            const row = window.WrTradePipeline.fromDeal(deal, { status: 'saved', source: 'trade-desk' });
            persistSavedDeals(rows => [row, ...rows.filter(d => d.id !== row.id)].slice(0, window.WrTradePipeline.CAP));
            setDealHqNotice('Saved to Trade Log');
        }

        function removeSavedDeal(id) {
            persistSavedDeals(rows => rows.filter(d => d.id !== id));
        }

        function updatePipelineRow(id, patch) {
            persistSavedDeals(rows => rows.map(r => r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r));
        }

        // Log the real-world outcome of a pipeline deal. Writes BOTH the pipeline
        // status (via the shared GRUDGE_TYPES vocabulary's cat) AND a grudge entry —
        // { myOwnerId, theirOwnerId, type, date } is exactly what calcGrudgeTax and
        // deriveDNAFromHistory consume, and Empire's buildEmpireGrudges aggregates
        // the same od_grudges_v1_<lid> key. This is the DNA-learning write path.
        function logDealOutcome(row, grudgeType) {
            const gt = GRUDGE_TYPES[grudgeType];
            if (!row || !gt) return;
            const status = gt.cat === 'rejected' ? 'rejected' : gt.cat === 'counter' ? 'countered' : 'accepted';
            const date = new Date().toISOString();
            updatePipelineRow(row.id, { status, outcome: { grudgeType, note: '', date } });
            if (myAssessment?.ownerId && row.partnerOwnerId) {
                const next = [...grudges, { myOwnerId: myAssessment.ownerId, theirOwnerId: row.partnerOwnerId, type: grudgeType, date }];
                saveGrudges(leagueId, next);
                setGrudges(next);
            }
        }

        // Fetch/refresh the ledger's raw-trade fallback. force=true bypasses the 6h TTL.
        async function refreshLedger(force) {
            if (!leagueId || !window.WrTxns?.fetchLeagueTxns) { setLedgerRawTrades([]); return; }
            setLedgerSyncing(true);
            try {
                const txns = await window.WrTxns.fetchLeagueTxns(leagueId, force ? { force: true } : undefined);
                const trades = (txns || [])
                    .filter(t => t?.type === 'trade' && t.status !== 'failed')
                    .sort((a, b) => tradeTimestampMs(b) - tradeTimestampMs(a));
                setLedgerRawTrades(trades);
            } catch (e) {
                if (window.wrLog) window.wrLog('tradecalc.ledgerRefresh', e);
                setLedgerRawTrades(prev => prev || []);
            }
            setLedgerSyncing(false);
        }

        function loadDealIntoBuilder(deal) {
            if (!deal) return;
            setTradeOwner({ A: myAssessment?.ownerId || null, B: deal.partnerOwnerId || null });
            setTradeIds({
                A: (deal.givePlayers || []).map(p => p.pid || p.id),
                B: (deal.receivePlayers || []).map(p => p.pid || p.id),
            });
            setTradePickIds({
                A: (deal.givePicks || []).map(p => p.id),
                B: (deal.receivePicks || []).map(p => p.id),
            });
            setTradeFaab({ A: deal.giveFaab || 0, B: deal.receiveFaab || 0 });
            setSearchText({ A: '', B: '' });
            // Edit the generated deal IN PLACE via the Desk's persistent builder strip
            // (the only builder). The rail's fixed Verdict card tracks builder state,
            // so no rail writes are needed here.
            setTcTab('desk');
            setBuilderExpanded(true);
        }

        // ── renderOwnerDna ──
        function renderOwnerDna() {
            if (!assessments.length) return <div style={{ color:'var(--silver)', textAlign:'center', padding:'2rem' }}>No roster data.</div>;
            // Phase 5: Two-pane layout — left pane is the Power-Ranking-sorted owner
            // list, right pane renders renderOwnerDetailCard for the selected owner
            // (defaults to my team, else the top-ranked owner). The legacy grid-of-cards
            // was deleted in the foundation pass; this split is the only DNA layout.
            // Phone (≤767, plan D10): single pane — the full-width owner LIST until a
            // row is tapped, then the detail card with a back affordance. Deep links
            // (rail "Full profile ▸") set expandedDnaOwner and land on the detail.
            const phone = _vp.isPhone;
            const selectedRid = expandedDnaOwner != null ? expandedDnaOwner : (phone ? null : (myRosterId || sortedAssessments[0]?.rosterId));
            const selectedAssessment = selectedRid == null ? null : (sortedAssessments.find(a => a.rosterId === selectedRid) || sortedAssessments[0]);
            const showList = !phone || !selectedAssessment;
            const showDetail = !phone || !!selectedAssessment;
            return (
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {/* Left pane: PR-sorted owner list (phone: the whole surface until a pick) */}
                    {showList && <div style={{ flex: phone ? '1 1 100%' : '0 0 240px', minWidth: phone ? 0 : '200px', maxHeight: phone ? 'none' : '78vh', overflowY: phone ? 'visible' : 'auto', background: 'var(--off-black)', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', borderRadius: '10px', padding: '6px' }}>
                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 8px' }}>Owners · sorted by power</div>
                        {sortedAssessments.map((a, idx) => {
                            const rid = a.rosterId;
                            const dnaKey = ownerDna[a.ownerId] || 'NONE';
                            const isMe = a.rosterId === myRosterId;
                            const isSel = rid === selectedRid;
                            const avatarSrc = avatarUrl(a.avatar);
                            const aiDna = typeof computeWeightedDNA === 'function' ? computeWeightedDNA(rid) : null;
                            const shownDnaKey = (dnaKey && dnaKey !== 'NONE') ? dnaKey : (aiDna?.key || 'NONE');
                            const shownDna = DNA_TYPES[shownDnaKey] || DNA_TYPES.NONE;
                            return (
                                <div key={rid} onClick={() => setExpandedDnaOwner(rid)} style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    padding: '7px 8px', minHeight: phone ? '44px' : undefined, borderRadius: '6px', cursor: 'pointer',
                                    background: isSel ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'transparent',
                                    border: '1px solid ' + (isSel ? 'var(--acc-line2, rgba(212,175,55,0.35))' : 'transparent'),
                                    marginBottom: '2px', transition: 'background 0.15s'
                                }}>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: idx < 3 ? 'var(--gold)' : 'var(--silver)', width: '18px', textAlign: 'center', fontFamily: 'var(--font-mono)', opacity: 0.7 }}>{idx + 1}</span>
                                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--charcoal)', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {avatarSrc ? <img src={avatarSrc} alt={a.ownerName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} /> : <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontWeight: 700 }}>{a.ownerName.charAt(0).toUpperCase()}</span>}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: '0.78rem', fontWeight: isSel ? 700 : 500, color: isSel ? 'var(--gold)' : 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {a.ownerName}{isMe && <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontWeight: 700, marginLeft: '4px' }}>ME</span>}
                                        </div>
                                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: shownDna.color || 'var(--silver)', opacity: 0.85 }}>{shownDna.label || '—'}</div>
                                    </div>
                                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: a.tierColor, fontFamily: 'var(--font-mono)' }}>{a.healthScore}</span>
                                </div>
                            );
                        })}
                    </div>}

                    {/* Right pane: selected owner detail (phone: single pane + back) */}
                    {showDetail && <div style={{ flex: phone ? '1 1 100%' : '1 1 480px', minWidth: phone ? 0 : '320px' }}>
                        {phone && (
                            <button type="button" onClick={() => setExpandedDnaOwner(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: '44px', marginBottom: '8px', padding: '6px 14px 6px 10px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: '6px', color: 'var(--gold)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>‹ All owners</button>
                        )}
                        <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.6, marginBottom: '10px', lineHeight: 1.5 }}>
                            Profile each owner's behavioral DNA. {React.createElement(Tip, null, 'Owner DNA classifies each league member\'s trading personality. DNA now affects acceptance through psychological tax drivers, not separate multiplier curves.')}
                            {' '}
                            {React.createElement(function DnaGuideInline() {
                                const [guideOpen, setGuideOpen] = React.useState(false);
                                return React.createElement(React.Fragment, null,
                                    React.createElement('button', { onClick:()=>setGuideOpen(!guideOpen), style:{fontSize:'0.7rem',color:'var(--gold)',background:'var(--acc-fill2, rgba(212,175,55,0.08))',border:'1px solid var(--acc-line1, rgba(212,175,55,0.25))',borderRadius:'4px',padding:'2px 8px',cursor:'pointer',fontFamily: 'var(--font-body)',textTransform:'uppercase',letterSpacing:'0.05em',marginLeft:'6px',minHeight:'44px',display:'inline-flex',alignItems:'center'} }, guideOpen ? 'Hide DNA Guide' : 'Show DNA Guide'),
                                    guideOpen ? React.createElement('div', { style:{marginTop:'8px', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:'8px'} },
                                        ...Object.entries(DNA_TYPES).filter(function(e){return e[0]!=='NONE'}).map(function(entry) {
                                            var key=entry[0], d=entry[1];
                                            return React.createElement('div', { key:key, style:{background:wrAlpha(d.color, '08'),border:'1px solid '+wrAlpha(d.color, '44'),borderLeft:'3px solid '+d.color,borderRadius:'6px',padding:'8px 10px'} },
                                                React.createElement('div', { style:{display:'flex', alignItems:'center', gap:'6px', marginBottom:'4px'} },
                                                    React.createElement('span', { style:{fontFamily:'var(--font-title)',fontSize:'0.9rem',color:d.color,fontWeight:700,letterSpacing:'0.03em'} }, d.label)
                                                ),
                                                React.createElement('div', { style:{fontSize:'0.7rem',color:'var(--silver)',lineHeight:1.45,marginBottom:'4px'} }, d.desc),
                                                d.strategy ? React.createElement('div', { style:{fontSize:'var(--text-micro, 0.6875rem)',color:'var(--silver)',fontStyle:'italic',lineHeight:1.4,paddingTop:'4px',borderTop:'1px dashed '+wrAlpha(d.color, '33'),marginTop:'4px'} }, '→ ' + d.strategy) : null,
                                                d.taxes && d.taxes.length ? React.createElement('div', { style:{display:'flex',flexWrap:'wrap',gap:'3px',marginTop:'5px'} },
                                                    ...d.taxes.slice(0, 3).map(function(t,i){ return React.createElement('span', { key:i, style:{fontSize:'var(--text-micro, 0.6875rem)',padding:'1px 4px',borderRadius:'3px',border:'1px solid '+wrAlpha(d.color, '40'),color:d.color,background:wrAlpha(d.color, '08')} }, t); })
                                                ) : null
                                            );
                                        })
                                    ) : null
                                );
                            })}
                        </div>
                        {selectedAssessment ? renderOwnerDetailCard(selectedAssessment) : <div style={{ padding: '40px', textAlign: 'center', color: 'var(--silver)', opacity: 0.6, fontSize: '0.82rem' }}>Select an owner on the left to view their full profile.</div>}
                    </div>}
                </div>
            );
        }

        // ── Big detail card rendered in the right pane (Phase 5 redesign) ──
        function renderOwnerDetailCard(a) {
            const rid = a.rosterId;
            const dnaKey = ownerDna[a.ownerId] || 'NONE';
            const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
            const isMyTeam = a.rosterId === myRosterId;
            const avatarSrc = avatarUrl(a.avatar);
            const draftDna = ownerDraftDna[a.ownerId] || null;
            const posture = calcOwnerPosture(a, dnaKey);
            const ownerTrades = (window.App?.LI?.tradeHistory || []).filter(t => t.roster_ids?.includes(rid));
            const tradeCount = ownerTrades.length;
            const aiDna = typeof computeWeightedDNA === 'function' ? computeWeightedDNA(rid) : null;
            const currentDna = ownerDna[a.ownerId] || aiDna?.key || 'NONE';
            const isOverridden = ownerDna[a.ownerId] && aiDna && ownerDna[a.ownerId] !== aiDna.key;
            const derivedDnaKey = deriveDNAFromHistory(a.ownerId, grudges);
            const derivedDna = derivedDnaKey ? DNA_TYPES[derivedDnaKey] : null;
            const profile = window.App?.LI?.ownerProfiles?.[rid] || {};
            const behaviorProfile = ownerBehaviorByRosterId?.[String(rid)] || null;
            const behaviorFacts = behaviorProfile?.observedFacts || [];
            const behaviorTags = behaviorProfile?.inferences || [];
            // Partner-intel blocks ported from the retired Deal HQ dossier (Phase 3):
            // why-this-partner, acceptance drivers, head-to-head vs me. The board
            // excludes my own roster, so these render only for other owners.
            const boardItem = isMyTeam ? null : partnerBoard.find(p => String(p.assessment.rosterId) === String(rid)) || null;
            const headToHeadTrades = isMyTeam ? [] : (window.App?.LI?.tradeHistory || [])
                .filter(t => {
                    const ids = tradeRosterIds(t);
                    return ids.includes(String(myRosterId)) && ids.includes(String(rid));
                })
                .sort((ta, tb) => tradeTimestampMs(tb) - tradeTimestampMs(ta) || (Number(tb.season || 0) - Number(ta.season || 0)) || (Number(tb.week || 0) - Number(ta.week || 0)))
                .slice(0, 5);
            const headToHeadRow = (trade, idx) => {
                const received = tradeSideReceivedAssets(trade, myRosterId);
                const sent = tradeSideSentAssets(trade, myRosterId);
                const net = tradeAssetsValue(received) - tradeAssetsValue(sent);
                const dateLabel = trade.season ? `${trade.season} W${trade.week || '-'}` : tradeTimestampMs(trade) ? new Date(tradeTimestampMs(trade)).toLocaleDateString() : 'Past trade';
                return <div key={trade.transaction_id || trade.id || idx} className="tc-dhq-history-row">
                    <div>
                        <span>{dateLabel}</span>
                        <strong>{a.ownerName || 'Partner'}</strong>
                    </div>
                    <p><b>You got</b> {summarizeTradeAssets(received)}</p>
                    <p><b>You sent</b> {summarizeTradeAssets(sent)}</p>
                    <em style={{ color:net >= 0 ? 'var(--good)' : 'var(--bad)' }}>{net >= 0 ? '+' : ''}{Math.round(net).toLocaleString()} DHQ</em>
                </div>;
            };
            const ownerRoster = allRosters.find(r => String(r.roster_id) === String(rid));
            const ownerPickAssets = pickAssetsForOwner(a.ownerId);
            const pickCapital = ownerPickAssets.reduce((s, p) => s + (p.value || 0), 0);
            const earlyPickCount = ownerPickAssets.filter(p => p.round <= 2).length;
            const rosterAssets = assetsForRoster(ownerRoster).slice(0, 8);
            const posRows = Object.entries(a.posAssessment || {}).sort((pa, pb) => (TC_POS_ORDER[pa[0]] ?? 9) - (TC_POS_ORDER[pb[0]] ?? 9)).map(([pos, data]) => {
                const leaders = (data.sortedIds || []).slice(0, 3).map(pid => {
                    const p = playersData[pid] || {};
                    return {
                        pid,
                        name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || pid,
                        team: p.team || 'FA',
                        value: getPlayerValue(pid).value || 0,
                    };
                });
                const needGap = Math.max(0, (data.startingReq || 1) - (data.nflStarters || 0));
                const surplus = Math.max(0, (data.actual || 0) - (data.ideal || 0));
                const qualityPct = Math.round(Math.min(1, (data.nflStarters || 0) / Math.max(1, data.startingReq || 1)) * 100);
                const statusLabel = data.status === 'deficit' ? `Need ${needGap || 1} starter${needGap === 1 ? '' : 's'}`
                    : data.status === 'thin' ? 'Thin depth'
                    : data.status === 'surplus' ? `Surplus ${surplus || '+'}`
                    : 'Stable';
                return { pos, data, leaders, needGap, surplus, qualityPct, statusLabel };
            });
            const starterNeed = posRows.find(r => r.data.status === 'deficit') || posRows.find(r => r.data.status === 'thin') || null;
            const cleanSurplus = posRows.find(r => r.data.status === 'surplus') || null;
            const starterCoverage = (() => {
                const req = posRows.reduce((s, r) => s + Math.max(1, r.data.startingReq || 1), 0);
                const filled = posRows.reduce((s, r) => s + Math.min(r.data.nflStarters || 0, Math.max(1, r.data.startingReq || 1)), 0);
                return req ? Math.round((filled / req) * 100) : 0;
            })();
            const favoritePartner = Object.entries(profile.partners || {}).sort((a, b) => b[1] - a[1])[0] || null;
            const favoritePartnerName = favoritePartner ? ownerNameForRosterId(favoritePartner[0]) || `Team ${favoritePartner[0]}` : 'No pattern';
            const timing = profile.weekTiming || {};
            const timingRead = (timing.late || 0) >= Math.max(timing.early || 0, timing.mid || 0) ? 'Late-season mover'
                : (timing.early || 0) >= Math.max(timing.mid || 0, timing.late || 0) ? 'Early-season mover'
                : 'Mid-season mover';
            const tradeBias = (profile.picksAcquired || 0) > (profile.picksSold || 0) + 2 ? 'Collects picks'
                : (profile.picksSold || 0) > (profile.picksAcquired || 0) + 2 ? 'Spends picks'
                : 'Balanced assets';
            const marketRead = starterNeed
                ? `${a.ownerName} is most exposed at ${starterNeed.pos}; offers that solve that room should rate better.`
                : cleanSurplus
                    ? `${a.ownerName} has tradeable depth at ${cleanSurplus.pos}; use that room as the package entry point.`
                    : `${a.ownerName} is balanced enough that value and psychology matter more than a single roster hole.`;
            const sortedOwnerTrades = ownerTrades.slice().sort((ta, tb) => {
                const aSeason = parseInt(ta.season) || 0;
                const bSeason = parseInt(tb.season) || 0;
                if (bSeason !== aSeason) return bSeason - aSeason;
                return (tb.week || 0) - (ta.week || 0);
            });
            const shortPlayerName = pid => {
                const p = playersData[pid] || {};
                return p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || String(pid);
            };
            const summarizeTradeSide = side => {
                const players = (side?.players || []).slice(0, 2).map(shortPlayerName);
                const picks = (side?.picks || []).slice(0, 2).map(pk => `${pk.season || pk.year || ''} R${pk.round || '?'}`.trim());
                const totalAssets = (side?.players || []).length + (side?.picks || []).length;
                const parts = [...players, ...picks].filter(Boolean);
                if (!parts.length) return 'No assets listed';
                const extra = Math.max(0, totalAssets - parts.length);
                return parts.join(', ') + (extra ? ` +${extra}` : '');
            };
            const renderTradeSpot = (label, trade, tone) => {
                if (!trade) return null;
                const otherRid = (trade.roster_ids || []).find(r => String(r) !== String(rid));
                const mySide = trade.sides?.[rid] || trade.sides?.[String(rid)] || {};
                const theirSide = otherRid != null ? (trade.sides?.[otherRid] || trade.sides?.[String(otherRid)] || {}) : {};
                const net = (mySide.totalValue || 0) - (theirSide.totalValue || 0);
                const color = tone === 'win' ? 'var(--good)' : 'var(--bad)';
                return <div className="tc-owner-trade-spot">
                    <span>{label}</span>
                    <strong style={{ color }}>{net >= 0 ? '+' : ''}{Math.round(net).toLocaleString()}</strong>
                    <em>{trade.season} W{trade.week || '-'} vs {ownerNameForRosterId(otherRid) || 'Unknown'}</em>
                </div>;
            };
            return (
                <div style={{ background: 'var(--off-black)', border: 'var(--card-border)', borderRadius: 'var(--card-radius)', padding: '18px 20px' }}>
                    {/* Hero strip */}
                    <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                        <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--charcoal)', overflow: 'hidden', flexShrink: 0, border: '2px solid var(--acc-line2, rgba(212,175,55,0.35))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {avatarSrc ? <img src={avatarSrc} alt={a.ownerName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} /> : <span style={{ fontSize: '1.1rem', color: 'var(--gold)', fontWeight: 700 }}>{a.ownerName.charAt(0).toUpperCase()}</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.35rem', color: 'var(--white)', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {a.ownerName}{isMyTeam && <span className="tc-my-team-badge">ME</span>}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--silver)', opacity: 0.75 }}>{a.teamName}</div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                                <span className="tc-tier-badge" style={{ color: a.tierColor, borderColor: a.tierColor, background: a.tierBg }}>{a.tier}</span>
                                <span className="tc-posture-badge" style={{ color: posture.color, borderColor: posture.color, background: wrAlpha(posture.color, '18') }}>{posture.label}</span>
                                {tradeCount > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.6 }}>{tradeCount} trades on file</span>}
                            </div>
                        </div>
                        {typeof MiniDonut !== 'undefined' && React.createElement(MiniDonut, { value: a.healthScore, size: 64, label: 'HEALTH' })}
                    </div>

                    {/* Cross-link to the Desk finder (spec): pin this owner as the partner
                        facet and reset to a clean best-moves query — a lingering focus or
                        stale intent from an earlier hunt would misdirect the scan. */}
                    {!isMyTeam && (
                        <button type="button" className="tc-rail-dna-link" style={{ marginBottom: '14px' }} onClick={() => {
                            setFinderQuery({ intent: 'best', focus: null, partnerFilter: a.ownerId });
                            setShowAllDeals(false);
                            setTcTab('desk');
                        }}>Find trades with this owner ▸</button>
                    )}

                    {/* KPI row */}
                    <div className="tc-owner-kpi-grid">
                        {[
                            { label: 'RECORD', value: a.wins + '-' + a.losses + (a.ties > 0 ? '-' + a.ties : ''), color: 'var(--white)' },
                            { label: 'PANIC', value: a.panic + '/5', color: a.panic >= 3 ? 'var(--loss-red)' : 'var(--silver)' },
                            { label: 'WINDOW', value: a.window || '—', color: a.tierColor },
                            { label: 'PF', value: a.pf > 0 ? Math.round(a.pf) : '—', color: 'var(--silver)' },
                        ].map((k, i) => <div key={i} style={{ padding: '8px', background: 'var(--black)', border: '1px solid var(--ov-3, rgba(255,255,255,0.05))', borderRadius: '6px', textAlign: 'center' }}>
                            <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.1rem', fontWeight: 700, color: k.color }}>{k.value}</div>
                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>{k.label}</div>
                        </div>)}
                    </div>

                    {/* Owner DNA block */}
                    <div style={{ marginBottom: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Owner DNA</span>
                            {derivedDna && <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '1px 6px', borderRadius: '3px', border: `1px solid ${derivedDna.color}55`, color: derivedDna.color, background: `${derivedDna.color}10` }}>AUTO: {derivedDna.label}</span>}
                        </div>
                        {aiDna ? (
                            <div style={{ fontSize: '0.76rem', marginBottom: '6px' }}>
                                <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Scout suggests: </span>
                                <span style={{ color: DNA_TYPES[aiDna.key]?.color || 'var(--silver)', fontWeight: 700 }}>{DNA_TYPES[aiDna.key]?.label || aiDna.key}</span>
                                <span style={{ color: 'var(--silver)', marginLeft: '4px', opacity: 0.65 }}>({aiDna.confidence}% confidence)</span>
                                <div style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.7, marginTop: '2px' }}>{aiDna.reasoning}</div>
                            </div>
                        ) : (
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.55, marginBottom: '6px', fontStyle: 'italic' }}>
                                {tradeCount > 0 ? 'Insufficient signal — tag manually' : 'Not enough data — tag manually'}
                            </div>
                        )}
                        <select className="tc-dna-select" value={currentDna} onChange={e => updateDna(a.ownerId, e.target.value)}>
                            {aiDna && <option value={aiDna.key}>AI: {DNA_TYPES[aiDna.key]?.label} (recommended)</option>}
                            {Object.entries(DNA_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        {isOverridden && <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--warn)', marginTop: '4px' }}>Overridden from AI suggestion</div>}
                        {dnaKey && dnaKey !== 'NONE' && dna.desc && (
                            <div style={{ marginTop: '8px', padding: '8px 10px', background: wrAlpha(dna.color, '08'), borderLeft: '3px solid ' + dna.color, borderRadius: '0 6px 6px 0' }}>
                                <div style={{ fontSize: '0.74rem', color: 'var(--silver)', lineHeight: 1.5 }}>{dna.desc}</div>
                                {dna.strategy && <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--silver)', fontStyle: 'italic', lineHeight: 1.4 }}>→ {dna.strategy}</div>}
                            </div>
                        )}
                    </div>

                    {/* Observed behavior: facts first, inference second */}
                    {behaviorProfile && (
                        <div style={{ marginBottom: '14px', display: 'grid', gridTemplateColumns: _vp.isPhone ? '1fr' : 'minmax(0, 1.15fr) minmax(0, 0.85fr)', gap: '10px' }}>
                            <div style={{ border: '1px solid rgba(125,183,232,0.16)', borderRadius: '7px', background: 'rgba(125,183,232,0.04)', padding: '9px 10px' }}>
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--k-7db7e8, #7db7e8)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '6px' }}>Observed Behavior</div>
                                <div style={{ display: 'grid', gap: '5px' }}>
                                    {behaviorFacts.slice(0, 4).map(fact => (
                                        <div key={fact.code} style={{ fontSize: '0.72rem', color: 'var(--silver)', lineHeight: 1.35 }}>
                                            <b style={{ color: 'var(--k-d0e7fa, #d0e7fa)', fontWeight: 800 }}>{fact.label}:</b> {fact.detail}
                                        </div>
                                    ))}
                                    {!behaviorFacts.length && <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.6 }}>No behavioral sample yet.</div>}
                                </div>
                            </div>
                            <div style={{ border: '1px solid var(--acc-fill3, rgba(212,175,55,0.16))', borderRadius: '7px', background: 'var(--acc-fill1, rgba(212,175,55,0.04))', padding: '9px 10px' }}>
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '6px' }}>Inference</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '7px' }}>
                                    {behaviorTags.length
                                        ? behaviorTags.slice(0, 5).map(tag => <span key={tag} style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', background: 'var(--acc-fill1, rgba(212,175,55,0.07))', borderRadius: '4px', padding: '2px 5px' }}>{tag.replace(/-/g, ' ')}</span>)
                                        : <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6 }}>Sample too thin</span>}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.82, lineHeight: 1.42 }}>{behaviorProfile.strategy?.offerFrame}</div>
                            </div>
                        </div>
                    )}

                    {/* Draft DNA (if present) */}
                    {draftDna && (
                        <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '6px', padding: '8px 10px', marginBottom: '14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Draft DNA</span>
                                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--k-a5b4fc, #a5b4fc)' }}>{draftDna.label}</span>
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.55, marginLeft: 'auto' }}>{draftDna.seasons} · {draftDna.picksAnalyzed} picks</span>
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.75, fontStyle: 'italic' }}>{draftDna.tendency}</div>
                        </div>
                    )}

                    <div className="tc-owner-market-read">
                        <span>Market Read</span>
                        <strong>{marketRead}</strong>
                    </div>

                    {boardItem && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                            <div className="tc-dhq-dossier-block">
                                <b>Why this partner</b>
                                <p>{boardItem.scoreReasons.slice(0, 3).join(' · ')}.</p>
                            </div>
                            <div className="tc-dhq-dossier-block">
                                <b>Acceptance drivers</b>
                                <ul>
                                    <li>{boardItem.posture.desc}</li>
                                    {a.panic >= 3 && <li>Panic level {a.panic}/5 creates urgency.</li>}
                                    {boardItem.mutualNeedFit > 0 && <li>Your surplus matches {boardItem.mutualNeedFit} of their needs.</li>}
                                    {boardItem.dnaKey !== 'NONE' && <li>{boardItem.dna.label}: {boardItem.dna.desc}</li>}
                                    {(boardItem.behaviorProfile?.observedFacts || []).slice(0, 2).map(fact => <li key={fact.code}>{fact.detail}</li>)}
                                </ul>
                            </div>
                        </div>
                    )}

                    <div className="tc-owner-signal-grid">
                        <div><span>Starter Coverage</span><strong>{starterCoverage}%</strong><em>{starterNeed ? `Watch ${starterNeed.pos}` : 'No urgent room'}</em></div>
                        <div><span>Pick Capital</span><strong>{Math.round(pickCapital).toLocaleString()}</strong><em>{ownerPickAssets.length} picks · {earlyPickCount} early</em></div>
                        <div><span>Trade Bias</span><strong>{tradeBias}</strong><em>{profile.picksAcquired || 0} picks in / {profile.picksSold || 0} out</em></div>
                        <div><span>Timing</span><strong>{timingRead}</strong><em>{favoritePartnerName}{favoritePartner ? ` (${favoritePartner[1]})` : ''}</em></div>
                    </div>

                    <div className="tc-owner-profile-grid">
                        <section className="tc-owner-panel">
                            <div className="tc-owner-panel-head">
                                <span>Roster Audit</span>
                                <em>{a.strengths?.length ? `Surplus ${a.strengths.join(', ')}` : 'No clean surplus'}{a.needs?.length ? ` · Needs ${a.needs.slice(0, 4).map(n => n.pos).join(', ')}` : ''}</em>
                            </div>
                            <div className="tc-owner-pos-table">
                                {posRows.map(row => {
                                    const statusColor = { surplus:'var(--gold)', ok:'var(--win-green)', thin:'var(--warn)', deficit:'var(--bad)' }[row.data.status] || 'var(--silver)';
                                    return <div key={row.pos} className="tc-owner-pos-row">
                                        <div className="tc-owner-pos-main">
                                            <strong style={{ color: posColor(row.pos) }}>{row.pos}</strong>
                                            <span style={{ color: statusColor }}>{row.statusLabel}</span>
                                        </div>
                                        <div className="tc-owner-pos-meter">
                                            <i style={{ width: `${row.qualityPct}%`, background: statusColor }} />
                                        </div>
                                        <div className="tc-owner-pos-count">{row.data.nflStarters}/{row.data.startingReq} starters · {row.data.actual}/{row.data.ideal} total</div>
                                        <div className="tc-owner-pos-leaders">
                                            {row.leaders.length ? row.leaders.map(p => <span key={p.pid}>{p.name} <em>{p.value ? p.value.toLocaleString() : '--'}</em></span>) : <span>No assets</span>}
                                        </div>
                                    </div>;
                                })}
                            </div>
                        </section>

                        <section className="tc-owner-panel">
                            <div className="tc-owner-panel-head">
                                <span>Moveable Assets</span>
                                <em>{a.faabRemaining || 0} FAAB · {ownerPickAssets.length} picks</em>
                            </div>
                            <div className="tc-owner-asset-cloud">
                                {rosterAssets.map(asset => <span key={asset.pid} style={{ borderColor: posColor(asset.pos) + '66' }}>{asset.name}<em>{asset.pos} · {asset.value.toLocaleString()}</em></span>)}
                                {ownerPickAssets.slice(0, 5).map(pick => <span key={pick.id} style={{ borderColor: (PICK_COLORS[pick.round] || 'var(--gold)') + '66' }}>{pick.label}<em>{pick.value.toLocaleString()}</em></span>)}
                            </div>
                        </section>
                    </div>

                    <section className="tc-owner-panel tc-owner-history-panel">
                        <div className="tc-owner-panel-head">
                            <span>Trade History</span>
                            <em>{profile.tradesWon || 0} won · {profile.tradesLost || 0} lost · {profile.tradesFair || 0} fair · Avg {(profile.avgValueDiff || 0) >= 0 ? '+' : ''}{Math.round(profile.avgValueDiff || 0).toLocaleString()} DHQ</em>
                        </div>
                        <div className="tc-owner-trade-spots">
                            {renderTradeSpot('Best win', profile.biggestWin, 'win')}
                            {renderTradeSpot('Biggest loss', profile.biggestLoss, 'loss')}
                        </div>
                        {headToHeadTrades.length > 0 && (
                            <div className="tc-dhq-dossier-block" style={{ marginBottom: '8px' }}>
                                <b>Head-to-head vs me</b>
                                <div className="tc-dhq-history">{headToHeadTrades.map(headToHeadRow)}</div>
                            </div>
                        )}
                        {sortedOwnerTrades.length > 0 ? (
                            <div className="tc-owner-trade-list">
                                {sortedOwnerTrades.slice(0, 8).map((t, ti) => {
                                    const otherRid = (t.roster_ids || []).find(r => String(r) !== String(rid));
                                    const otherUser = ownerNameForRosterId(otherRid) || ('Owner ' + otherRid);
                                    const mySide = t.sides?.[rid] || t.sides?.[String(rid)] || { players: [], picks: [] };
                                    const theirSide = otherRid != null ? (t.sides?.[otherRid] || t.sides?.[String(otherRid)] || { players: [], picks: [] }) : { players: [], picks: [] };
                                    const myValue = mySide.totalValue || 0;
                                    const theirValue = theirSide.totalValue || 0;
                                    const won = myValue > theirValue * 1.15;
                                    const lost = theirValue > myValue * 1.15;
                                    const verdict = won ? 'Won' : lost ? 'Lost' : 'Fair';
                                    const verdictCol = won ? 'var(--good)' : lost ? 'var(--bad)' : 'var(--silver)';
                                    return (
                                        <div key={ti} className="tc-owner-trade-row">
                                            <div>
                                                <span>{t.season} W{t.week || '-'}</span>
                                                <strong style={{ color: verdictCol }}>{verdict}</strong>
                                                <em>vs {otherUser}</em>
                                            </div>
                                            <p><b>Got</b> {summarizeTradeSide(mySide)}</p>
                                            <p><b>Sent</b> {summarizeTradeSide(theirSide)}</p>
                                            <strong style={{ color: verdictCol }}>{myValue >= theirValue ? '+' : ''}{Math.round(myValue - theirValue).toLocaleString()}</strong>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : <div className="tc-owner-empty">No trade history found for this owner.</div>}
                    </section>

                </div>
            );
        }

        // ── computePartnerBoard — the single partner ranking consumed by Deal HQ, the
        // best-move hero, and the Context Rail. Extracted from renderDealHQ (the hero used
        // to carry a mirrored copy with a KEEP-IN-SYNC warning — now there is one copy).
        function computePartnerBoard() {
            if (!assessments.length || !myAssessment) return [];
            const myStrengths = myAssessment.strengths || [];
            const myNeeds = myAssessment.needs || [];
            return assessments
                .filter(a => a.rosterId !== myRosterId)
                .map(a => {
                    const dnaKey = ownerDna[a.ownerId] || 'NONE';
                    const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
                    const posture = calcOwnerPosture(a, dnaKey);
                    const compat = calcComplementarity(myAssessment, a);
                    const theirNeeds = a.needs || [];
                    const mutualNeedFit = theirNeeds.filter(n => myStrengths.includes(n.pos)).length;
                    const theyHaveNeed = myNeeds.filter(n => (a.strengths || []).includes(n.pos)).length;
                    const pickAssets = pickAssetsForOwner(a.ownerId);
                    const pickCapital = pickAssets.reduce((s, p) => s + p.value, 0);
                    const profile = window.App?.LI?.ownerProfiles?.[a.rosterId] || {};
                    const behaviorProfile = ownerBehaviorByRosterId?.[String(a.rosterId)] || null;
                    const behaviorTags = new Set(behaviorProfile?.inferences || []);
                    const tradeVol = profile.trades || 0;
                    const behaviorScore = behaviorProfile
                        ? Math.round(((behaviorProfile.scores?.liquidity ?? 50) - 50) / 4)
                            + (behaviorTags.has('active-trader') ? 8 : 0)
                            + (behaviorTags.has('fair-dealer') ? 5 : 0)
                            + (behaviorTags.has('low-liquidity') ? -12 : 0)
                            + (behaviorTags.has('value-hunter') ? -5 : 0)
                        : 0;
                    const panicScore = Math.min(8, (a.panic || 0) * 2);
                    const pickCapitalScore = Math.min(5, Math.round(pickCapital / 4200));
                    const rawScore = compat * 0.62 + mutualNeedFit * 13 + theyHaveNeed * 10 + panicScore + pickCapitalScore + Math.min(7, tradeVol) + behaviorScore + (posture.key === 'LOCKED' ? -18 : 0);
                    const fitCap = compat >= 80 ? 99 : compat >= 65 ? 94 : compat >= 50 ? 88 : compat >= 35 ? 78 : 68;
                    const score = Math.round(clampNum(rawScore, 0, fitCap, 0));
                    const tag = score >= 85 ? 'Attack' : score >= 68 ? 'Prime' : score >= 48 ? 'Possible' : a.panic >= 3 ? 'Monitor' : 'Long shot';
                    const tagColor = tag === 'Attack' || tag === 'Prime' ? 'var(--good)' : tag === 'Possible' ? 'var(--warn)' : tag === 'Monitor' ? 'var(--k-bb8fce, #bb8fce)' : 'var(--silver)';
                    const scoreReasons = [];
                    if (mutualNeedFit > 0) scoreReasons.push(`your surplus matches ${mutualNeedFit} need${mutualNeedFit === 1 ? '' : 's'}`);
                    if (compat >= 60) scoreReasons.push(`${compat}% roster fit`);
                    if (behaviorTags.has('active-trader')) scoreReasons.push('active trader');
                    if (posture.key === 'LOCKED') scoreReasons.push('locked roster drag');
                    if (!scoreReasons.length) scoreReasons.push('limited roster-fit signal');
                    return { assessment:a, dnaKey, dna, posture, compat, mutualNeedFit, theyHaveNeed, pickAssets, pickCapital, profile, behaviorProfile, behaviorScore, score, tag, tagColor, scoreReasons };
                })
                .sort((a, b) => b.score - a.score || b.compat - a.compat);
        }

        // ── Finder results (Phase 4b) — memoized per-partner eval + league-wide loop ──
        // Deal generation moved OUT of renderDealHQ so that (a) results are cached per
        // (partner, mode, focus, tuning, data-epoch) instead of recomputed on every
        // keystroke/render, (b) an unpinned query pools candidate deals across the whole
        // scored partner board in idle-time chunks with progressive row reveal, and
        // (c) publishRecommendations fires from a result-keyed effect, not as a render
        // side effect. Generation math (buildDeal/fairnessGrade/likelihood) is untouched.
        const finderAlexSettings = window.WR?.AlexSettings?.get?.() || {};
        const finderTuning = getDealHqTuning(finderAlexSettings);
        const finderTuningHash = JSON.stringify([
            finderTuning.mode, finderTuning.aggression, finderTuning.minAcceptance,
            finderTuning.maxUserGainPct, finderTuning.maxOverpayPct,
            [...finderTuning.targetPositions].sort(), [...finderTuning.sellPositions].sort(),
            [...finderTuning.untouchable].sort(),
            finderAlexSettings.tradePriority || null,
        ]);
        // Data epoch — bumps when any generation input changes; keys the deal cache,
        // the pooled-scan effect, and the partner-board memo.
        const finderEpochRef = useRef(0);
        const finderDataEpoch = useMemo(
            () => ++finderEpochRef.current,
            [assessments, ownerDna, grudges, ownerBehaviorByRosterId, teamContextByRosterId, picksByOwner, draftSlotMaps, leagueDraftRounds]
        );
        const partnerBoard = useMemo(() => computePartnerBoard(), [finderDataEpoch]);
        // Per-(partner, mode, focus) deal cache, invalidated wholesale on tuning/data
        // change. Deals are kept WITH _sig for cross-partner/mode dedupe in the pool.
        const finderDealsCacheRef = useRef({ version: '', map: new Map() });
        function evalPartnerDeals(partner, mode, focusPid, focusPick) {
            const cache = finderDealsCacheRef.current;
            const version = `${finderDataEpoch}|${finderTuningHash}`;
            if (cache.version !== version) { cache.version = version; cache.map.clear(); }
            const key = `${partner.ownerId}|${mode}|${focusPid ?? ''}|${focusPick?.id ?? ''}`;
            if (!cache.map.has(key)) cache.map.set(key, generateDealsForPartner(partner, mode, focusPid, { keepSig: true, focusPick: focusPick || null }));
            return cache.map.get(key);
        }

        // Typed finder query → generation inputs (moved from renderDealHQ).
        const focusR = resolveFinderFocus(finderQuery.focus);
        const focusPlayerPid = focusR?.kind === 'player' ? focusR.id : null;
        // Resolved pick focus (carries .pickAsset) — only routed when the pick still
        // exists in the pool; a stale seed degrades to the plain mode branches.
        const focusPickR = focusR?.kind === 'pick' && focusR.pickAsset ? focusR : null;
        const effPartnerId = finderEffectivePartnerId(focusR);
        const effMode = deriveFinderMode(finderQuery, focusR);
        const selectedItem = partnerBoard.find(p => String(p.assessment.ownerId) === String(effPartnerId)) || partnerBoard[0] || null;
        const selectedPartner = selectedItem?.assessment || null;
        const finderActive = viewMode !== 'command'
            && tcTab === 'desk'
            && (typeof window.wrIsPro === 'function' ? window.wrIsPro() : true)
            && rosterState.isUsable
            && !!myAssessment
            && assessments.length > 0;
        // League-wide pooled scan whenever NO partner is pinned (owner focus /
        // league-asset focus / facet chip all pin). Unfocused 'best' runs BOTH deal
        // directions per partner and early-stops once the top-6 board partners are
        // scanned AND 8+ actionable rows exist; other unpinned intents run their
        // derived mode across the whole board (Shop/Get Help/Picks league-wide).
        const finderDualBest = finderQuery.intent === 'best' && !focusR;
        const finderFocusKey = finderQuery.focus ? `${finderQuery.focus.kind}:${finderQuery.focus.id}` : null;
        const finderLoopKey = finderActive && effPartnerId == null && partnerBoard.length
            ? JSON.stringify([finderQuery.intent, effMode, finderFocusKey, finderDataEpoch, finderTuningHash])
            : null;
        const finderActionFloor = dealActionableAcceptanceFloor(finderTuning);
        const [finderPool, setFinderPool] = useState({ key: null, deals: [], scanned: 0, total: 0, done: false });
        useEffect(() => {
            if (!finderLoopKey) {
                setFinderPool(p => (p.key === null ? p : { key: null, deals: [], scanned: 0, total: 0, done: false }));
                return undefined;
            }
            // Chunked league scan: one partner per idle slice (requestIdleCallback,
            // setTimeout fallback) so a 14-team league never blocks the main thread;
            // each slice re-publishes the pool for progressive row reveal.
            let cancelled = false;
            const partners = partnerBoard;
            const modes = finderDualBest ? ['fillNeed', 'sellSurplus'] : [effMode];
            const minPartners = finderDualBest ? Math.min(6, partners.length) : partners.length;
            const pooled = [];
            const seen = new Set();
            let idx = 0;
            setFinderPool({ key: finderLoopKey, deals: [], scanned: 0, total: partners.length, done: false });
            const schedule = fn => (typeof window.requestIdleCallback === 'function'
                ? window.requestIdleCallback(fn, { timeout: 150 })
                : setTimeout(fn, 0));
            const step = () => {
                if (cancelled) return;
                const item = partners[idx];
                if (item) {
                    // A bad partner (malformed assessment, missing roster) must not
                    // silently kill the whole scan — that's how it hangs at 0/N. Log
                    // and skip; idx still advances so the league scan keeps moving.
                    try {
                        for (const mode of modes) {
                            for (const deal of evalPartnerDeals(item.assessment, mode, focusPlayerPid, focusPickR)) {
                                if (deal._sig) {
                                    if (seen.has(deal._sig)) continue;
                                    seen.add(deal._sig);
                                }
                                pooled.push({ ...deal, partnerScore: item.score });
                            }
                        }
                    } catch (err) {
                        if (window.wrLog) window.wrLog('trade.finderScan', err);
                    }
                }
                idx += 1;
                const enough = idx >= minPartners && pooled.filter(d => d.likelihood >= finderActionFloor).length >= 8;
                const done = idx >= partners.length || (finderDualBest && enough);
                setFinderPool({ key: finderLoopKey, deals: pooled.slice(), scanned: idx, total: partners.length, done });
                if (!done) schedule(step);
            };
            schedule(step);
            return () => { cancelled = true; };
        }, [finderLoopKey]);
        const finderPoolOn = finderLoopKey != null;
        // Pooled ranking: per-deal recommendation score (likelihood/fit/value, GM-band
        // penalized) + a small partner-board term, grade letter then accept % as ties.
        const FINDER_GRADE_RANK = { 'A+': 7, 'A': 6, 'B+': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1 };
        const finderDeals = useMemo(() => {
            if (!finderActive) return [];
            if (finderPoolOn) {
                // Sort first, THEN core-dedupe: dual-mode scans (fillNeed +
                // sellSurplus) can produce the same trade idea for one partner;
                // the best-ranked variant is the one that survives.
                const seenCore = new Set();
                return finderPool.deals
                    .slice()
                    .sort((a, b) => (b.rank + (b.partnerScore || 0) * 0.2) - (a.rank + (a.partnerScore || 0) * 0.2)
                        || (FINDER_GRADE_RANK[b.grade] || 0) - (FINDER_GRADE_RANK[a.grade] || 0)
                        || b.likelihood - a.likelihood)
                    .filter(deal => {
                        if (!deal._core) return true;
                        if (seenCore.has(deal._core)) return false;
                        seenCore.add(deal._core);
                        return true;
                    })
                    .map(({ _sig, _core, ...deal }) => deal)
                    .slice(0, 24);
            }
            if (!selectedPartner) return [];
            return evalPartnerDeals(selectedPartner, effMode, focusPlayerPid, focusPickR).map(({ _sig, _core, ...deal }) => deal);
        }, [finderActive, finderPoolOn, finderPool, selectedPartner, effMode, focusPlayerPid, focusPickR?.id, finderDataEpoch, finderTuningHash]);
        const finderActionable = finderDeals.filter(deal => deal.likelihood >= finderActionFloor);
        const finderMoonshotCount = Math.max(0, finderDeals.length - finderActionable.length);
        const finderVisibleDeals = showAllDeals ? finderDeals : finderActionable.slice(0, finderPoolOn ? 8 : 6);
        // Alex rec feed — once per finder-result change (pooled scans publish on
        // completion with partner:null), never as a render side effect.
        const finderPublishKey = finderActive && (!finderPoolOn || finderPool.done)
            ? JSON.stringify([finderPoolOn ? null : (selectedPartner?.ownerName || null), finderActionable.map(d => d.id), finderMoonshotCount])
            : null;
        useEffect(() => {
            if (!finderPublishKey) return;
            if (typeof window.App?.Intelligence?.publishRecommendations === 'function') {
                window.App.Intelligence.publishRecommendations('trade', finderActionable.map(deal => deal.intelligence).filter(Boolean), {
                    surface: 'trade-desk',
                    partner: finderPoolOn ? null : (selectedPartner?.ownerName || null),
                    hiddenMoonshots: finderMoonshotCount,
                });
            }
        }, [finderPublishKey]);

        // ── Phone board→builder helpers (iPhone program Phase 2) — component scope
        // so the phone workspace's gold "+" affordances and picks board run the
        // builder's canonical add recipes.
        // Hide picks whose rookie draft has already been held: any PAST season, plus
        // the CURRENT NFL season once its draft is done — proxied by the regular
        // season / playoffs having started, since rookie drafts run pre-season.
        // Future picks always show. (MFL already drops made current-year slots
        // per-slot at build time; this is the backstop and the Sleeper fix — its
        // synthetic picks include the current season.)
        function pickUndrafted(pk) {
            const nfl = (typeof window !== 'undefined' && window.S && window.S.nflState) || {};
            const nflSeason = Number(nfl.season) || parseInt(currentLeague.season) || new Date().getFullYear();
            const draftHeld = ['regular', 'post'].includes(String(nfl.season_type || '').toLowerCase());
            const y = Number(pk.year);
            return !Number.isFinite(y) || y > nflSeason || (y === nflSeason && !draftHeld);
        }
        // Gold "+" add affordance → the EXISTING builder add handler
        // (buildTradeSideDeps().addPlayer — a cheap prop bag of closures over
        // component state) plus the owner-select seam for side B (mirrors
        // TcTradeSide's owner <select>, which keeps any already-added assets —
        // same semantics). Returns false on a dup so callers can skip success
        // follow-ups.
        function addAssetToBuilder(row) {
            const mine = String(row.rosterId) === String(myRosterId);
            const side = mine ? 'A' : 'B';
            if (tradeIds[side].includes(row.pid)) { setDealHqNotice('Already in the live deal'); return false; }
            if (!mine && tradeOwner.B !== row.ownerId) setTradeOwner(prev => ({ ...prev, B: row.ownerId }));
            buildTradeSideDeps().addPlayer(side, row.pid);
            setDealHqNotice(mine ? 'Added to YOU SEND' : 'Added to YOU GET');
            return true;
        }
        // Pick "+" → the builder's addPick (mirrors addAssetToBuilder for players):
        // your pick → YOU SEND (side A), any other owner's pick → YOU GET (side B),
        // pinning that partner on B.
        function addPickRowToBuilder(row) {
            const mine = String(row.rosterId) === String(myRosterId);
            const side = mine ? 'A' : 'B';
            if (tradePickIds[side].includes(row.id)) { setDealHqNotice('Already in the live deal'); return false; }
            if (!mine && tradeOwner.B !== row.ownerId) setTradeOwner(prev => ({ ...prev, B: row.ownerId }));
            buildTradeSideDeps().addPick(side, row.id);
            setDealHqNotice(mine ? 'Added to YOU SEND' : 'Added to YOU GET');
            return true;
        }

        function renderDealHQ() {
            if (!rosterState.isUsable) {
                return <div className="tc-dhq-shell wr-fade-in">
                    <div className="tc-dhq-hero">
                        <div>
                            <div className="tc-dhq-kicker">Trade Desk</div>
                            <h2>Trade recommendations paused</h2>
                            <p>Partner scores and generated packages are hidden until complete roster IDs are available.</p>
                        </div>
                    </div>
                    {window.App?.renderRosterDataBlocker?.(rosterState, {
                        title: rosterState.isPreDraftRosterEmpty ? null : 'Roster sync incomplete',
                        message: rosterState.isPreDraftRosterEmpty ? rosterState.message : 'Trade partner scores need your current roster before they can be trusted.',
                        detail: rosterState.detail,
                        actionLabel: rosterState.isPreDraftRosterEmpty ? null : 'Refresh Data',
                        style: { minHeight: '220px' },
                    })}
                </div>;
            }
            if (!assessments.length || !myAssessment) {
                return <div style={{ color:'var(--silver)', textAlign:'center', padding:'2rem' }}>No trade data loaded yet.</div>;
            }

            // Deal generation, ranking, floors, and the rec publish live at component
            // scope now (Phase 4b block above renderDealHQ); these are read aliases.
            const focusTuning = finderTuning;
            const deals = finderDeals;
            const actionFloor = finderActionFloor;
            const actionableDeals = finderActionable;
            const moonshotCount = finderMoonshotCount;
            const visibleDeals = finderVisibleDeals;
            const finderIntents = [
                { key: 'best', label: 'Best Moves' },
                { key: 'help', label: 'Get Help' },
                { key: 'shop', label: 'Shop Target' },
                { key: 'picks', label: 'Picks' },
            ];
            const intentLabel = (finderIntents.find(i => i.key === finderQuery.intent) || finderIntents[0]).label;
            const modeDescriptor = (finderDualBest && finderPoolOn) ? 'best moves league-wide (buy + sell)'
                : (finderPoolOn ? 'league-wide · ' : '') + (effMode === 'acquire' ? `targeting ${focusR?.label || 'their asset'}`
                : effMode === 'shop' ? `shopping ${focusR?.label || 'your asset'}`
                : effMode === 'picks' ? 'hunting pick capital'
                : effMode === 'sellSurplus' ? 'shopping your surplus'
                : 'filling roster needs');
            const finderScopeLabel = finderPoolOn
                ? (finderPool.done ? 'league-wide scan' : `scanning ${finderPool.scanned}/${finderPool.total}…`)
                : selectedPartner ? `vs ${selectedPartner.ownerName}` : 'no partner scored yet';
            const assetBrowserSorts = [
                { key:'dhq', label:'DHQ' },
                { key:'age', label:'Age' },
                { key:'owner', label:'Owned Team' },
                { key:'points', label:'Last FP' },
                { key:'prime', label:'Prime Years' },
            ];
            const browsingMyRoster = effMode === 'shop' || effMode === 'sellSurplus' || effMode === 'picks';
            // Partner pinned + acquire-side browse → only that partner's roster
            // (c73cc40); no pin keeps the full league board.
            const assetBrowserRosters = browsingMyRoster
                ? allRosters.filter(r => String(r.roster_id) === String(myRosterId))
                : allRosters.filter(r => String(r.roster_id) !== String(myRosterId)
                    && (effPartnerId == null || String(r.owner_id) === String(effPartnerId)));
            const rosterLabel = roster => {
                const assessment = assessments.find(a => String(a.rosterId) === String(roster?.roster_id));
                return assessment?.teamName || ownerNameForRosterId(roster?.roster_id) || `Team ${roster?.roster_id || '?'}`;
            };
            const assetBrowserRows = (assetBrowserOpen ? assetBrowserRosters : []).flatMap(roster => assetsForRoster(roster)
                .filter(p => !browsingMyRoster || !isUntouchableAsset(p, focusTuning))
                .map(asset => {
                    const player = playersData[asset.pid] || {};
                    const age = playerAge(player) || asset.age || null;
                    const lastPoints = Math.round(calcSeasonPts(asset.pid, currentLeague.scoring_settings) || 0);
                    return {
                        ...asset,
                        age,
                        lastPoints,
                        primeYears: primeYearsRemaining(asset.pos, age),
                        ownerId: roster.owner_id,
                        rosterId: roster.roster_id,
                        ownerLabel: rosterLabel(roster),
                    };
                }));
            // Flex-group chips (league-derived) + group-aware predicate (c73cc40) —
            // optional-chained so the browser degrades to plain positions until the
            // window.App flex-group helpers land.
            const dtFlexGroups = (window.App?.getLeagueFlexGroups?.({ league: currentLeague }) || [])
                .filter(g => (window.App?.FLEX_GROUP_POSITIONS?.[g] || []).some(pos => assetBrowserRows.some(row => row.pos === pos)));
            const browserPositions = ['ALL', ...Object.keys(TC_POS_ORDER).filter(pos => assetBrowserRows.some(row => row.pos === pos)), ...dtFlexGroups];
            const _dtPosMatch = window.App?.posMatchesFilter || ((pos, f) => !f || f === 'ALL' || pos === f);
            const visibleAssetRows = assetBrowserRows
                .filter(row => _dtPosMatch(row.pos, assetBrowserPos))
                .filter(row => !assetBrowserRookieOnly || !!tcRookieInfoFor(row.pid))
                .sort((a, b) => {
                    if (assetBrowserSort === 'age') return (a.age || 99) - (b.age || 99) || b.value - a.value;
                    if (assetBrowserSort === 'owner') return a.ownerLabel.localeCompare(b.ownerLabel) || b.value - a.value;
                    if (assetBrowserSort === 'points') return b.lastPoints - a.lastPoints || b.value - a.value;
                    if (assetBrowserSort === 'prime') return (b.primeYears || 0) - (a.primeYears || 0) || b.value - a.value;
                    return b.value - a.value;
                })
                .slice(0, 28);

            // ── Focus typeahead sources — players (mine AND league-wide), picks, owners ──
            // Built inline per keystroke (only when 2+ chars typed); no memo needed at
            // this scale (~300 assets). Groups cap so the dropdown stays one glance.
            const typeQ = finderSearch.trim().toLowerCase();
            const typeaheadGroups = [];
            if (typeQ.length >= 2) {
                const matches = s => String(s || '').toLowerCase().includes(typeQ);
                const ownerRows = assessments
                    .filter(a => String(a.rosterId) !== String(myRosterId) && (matches(a.ownerName) || matches(a.teamName)))
                    .slice(0, 3)
                    .map(a => ({ kind: 'owner', key: `own-${a.ownerId}`, id: a.ownerId, label: a.ownerName || a.teamName || `Team ${a.rosterId}`, sub: a.teamName || 'League owner', value: null, ownerId: a.ownerId, rosterId: a.rosterId }));
                const myPlayerRows = [];
                const leaguePlayerRows = [];
                for (const roster of allRosters) {
                    const mine = String(roster.roster_id) === String(myRosterId);
                    for (const asset of assetsForRoster(roster)) {
                        if (!matches(asset.name)) continue;
                        (mine ? myPlayerRows : leaguePlayerRows).push({
                            kind: 'player', key: `pl-${roster.roster_id}-${asset.pid}`, id: asset.pid,
                            label: asset.name, pos: asset.pos,
                            sub: `${asset.pos} ${asset.team} · ${mine ? 'your roster' : rosterLabel(roster)}`,
                            value: asset.value, ownerId: roster.owner_id, rosterId: roster.roster_id,
                        });
                    }
                }
                myPlayerRows.sort((a, b) => b.value - a.value);
                leaguePlayerRows.sort((a, b) => b.value - a.value);
                const ordinal = r => ['', '1st', '2nd', '3rd'][r] || `${r}th`;
                const pickRows = [];
                for (const a of assessments) {
                    const mine = String(a.rosterId) === String(myRosterId);
                    for (const pk of pickAssetsForOwner(a.ownerId)) {
                        const haystack = `${pk.label} ${pk.year} round ${pk.round} ${ordinal(pk.round)} ${pk.via || ''} ${a.ownerName || ''} pick`;
                        if (!matches(haystack)) continue;
                        pickRows.push({
                            kind: 'pick', key: `pk-${a.rosterId}-${pk.id}`, id: pk.id,
                            label: pk.label, sub: `${mine ? 'your pick' : a.ownerName}${pk.via ? ` · via ${pk.via}` : ''}`,
                            value: pk.value, ownerId: a.ownerId, rosterId: a.rosterId,
                        });
                    }
                }
                pickRows.sort((a, b) => b.value - a.value);
                if (ownerRows.length) typeaheadGroups.push({ label: 'Owners', rows: ownerRows });
                if (myPlayerRows.length) typeaheadGroups.push({ label: 'My players', rows: myPlayerRows.slice(0, 5) });
                if (leaguePlayerRows.length) typeaheadGroups.push({ label: 'League players', rows: leaguePlayerRows.slice(0, 6) });
                if (pickRows.length) typeaheadGroups.push({ label: 'Picks', rows: pickRows.slice(0, 5) });
            }
            const typeaheadFlat = typeaheadGroups.flatMap(g => g.rows);

            function selectFinderFocus(item) {
                if (!item) return;
                setFinderQuery(qr => item.kind === 'owner'
                    ? { ...qr, focus: { kind: 'owner', id: item.ownerId, label: item.label }, partnerFilter: item.ownerId }
                    : { ...qr, focus: { kind: item.kind, id: item.id, label: item.label, pos: item.pos || null, ownerId: item.ownerId, rosterId: item.rosterId } });
                setFinderSearch('');
                setFinderTypeaheadIdx(0);
                setShowAllDeals(false);
            }

            function clearFinderFocus() {
                // An owner focus and its partnerFilter were set together — clear both.
                setFinderQuery(qr => ({ ...qr, focus: null, partnerFilter: qr.focus?.kind === 'owner' ? null : qr.partnerFilter }));
                setShowAllDeals(false);
            }

            function setPartnerFacet(ownerId) {
                // A focus that pins a DIFFERENT owner would override the facet
                // (finderEffectivePartnerId precedence) — drop it so the click wins.
                const pinsOtherOwner = focusR && (
                    focusR.kind === 'owner'
                    || (focusR.ownerId != null && String(focusR.rosterId) !== String(myRosterId) && (ownerId == null || String(focusR.ownerId) !== String(ownerId)))
                );
                setFinderQuery(qr => ({ ...qr, partnerFilter: ownerId, focus: pinsOtherOwner ? null : qr.focus }));
                setShowAllDeals(false);
            }

            function selectAssetFocus(row) {
                if (!row) return;
                setFinderQuery(qr => ({ ...qr, focus: { kind: 'player', id: row.pid, label: row.name, pos: row.pos, ownerId: row.ownerId, rosterId: row.rosterId } }));
                setShowAllDeals(false);
            }

            function assetLine(asset) {
                if (!asset) return null;
                if (asset.type === 'pick') {
                    return <div key={asset.id} className="tc-dhq-asset">
                        <span className="tc-dhq-asset-dot" style={{ background:PICK_COLORS[asset.round] || 'var(--gold)' }} />
                        <span>{asset.label}{asset.via ? <em> via {asset.via}</em> : null}</span>
                        <strong>{asset.value.toLocaleString()}</strong>
                    </div>;
                }
                return <div key={asset.pid || asset.id} className="tc-dhq-asset">
                    <span className="tc-dhq-asset-dot" style={{ background:posColor(asset.pos) }} />
                    <span>{asset.name} <em>{asset.pos} {asset.team}</em></span>
                    <strong>{asset.value.toLocaleString()}</strong>
                </div>;
            }

            function sideSummary(label, deal, side) {
                const players = side === 'give' ? deal.givePlayers : deal.receivePlayers;
                const picks = side === 'give' ? deal.givePicks : deal.receivePicks;
                const faab = side === 'give' ? deal.giveFaab : deal.receiveFaab;
                const totals = deal.totals[side];
                return <div className="tc-dhq-side">
                    <div className="tc-dhq-side-head">
                        <span>{label}</span>
                        <strong>{totals.total.toLocaleString()}</strong>
                    </div>
                    <div className="tc-dhq-breakdown">
                        <span>Players {totals.playerValue.toLocaleString()}</span>
                        <span>Picks {totals.pickValue.toLocaleString()} / {totals.pickCount}</span>
                        <span>FAAB ${faab || 0}</span>
                    </div>
                    <div className="tc-dhq-assets">
                        {players.map(assetLine)}
                        {picks.map(assetLine)}
                        {faab > 0 && <div className="tc-dhq-asset">
                            <span className="tc-dhq-asset-dot" style={{ background:'var(--win-green)' }} />
                            <span>FAAB</span>
                            <strong>${faab}</strong>
                        </div>}
                    </div>
                </div>;
            }

            return <div className="tc-dhq-shell wr-fade-in">
                {dealHqNotice && <div className="tc-dhq-notice" onAnimationEnd={() => setDealHqNotice(null)}>{dealHqNotice}</div>}

                {/* ── TRADE FINDER (the star) — intent chips · focus typeahead · GM lens ·
                    partner facet chips · optional asset-browser expander (Phase 4a).
                    Inline overflow overrides: the panel/body CSS clamps for the old
                    fixed-height grid and would clip the typeahead dropdown. */}
                <section className="tc-dhq-panel" style={{ overflow: 'visible' }}>
                    {/* Compact header: title + intent chips share the "Trade Finder"
                        line (chips pulled up out of the body), scanning status stays
                        pinned far-right. Everything below rises by one row. */}
                    <div className="tc-dhq-panel-head" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', minWidth: 0 }}>
                            <span>Trade Finder</span>
                            <div className="tc-dhq-modebar" role="group" aria-label="Finder intent">
                                {finderIntents.map(i => <button key={i.key} type="button" className={finderQuery.intent === i.key ? 'is-active' : ''} onClick={() => { setFinderQuery(qr => ({ ...qr, intent: i.key })); setAssetBrowserPos('ALL'); setShowAllDeals(false); }}>{i.label}</button>)}
                            </div>
                        </div>
                        <em>{intentLabel} · {finderScopeLabel}</em>
                    </div>
                    <div className="tc-dhq-panel-body" style={{ overflow: 'visible', paddingRight: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ position: 'relative', minWidth: 0 }}>
                            <input
                                type="text"
                                value={finderSearch}
                                onChange={e => { setFinderSearch(e.target.value); setFinderTypeaheadIdx(0); }}
                                onBlur={() => setFinderSearch('')}
                                onKeyDown={e => {
                                    if (e.key === 'Escape') { setFinderSearch(''); return; }
                                    if (!typeaheadFlat.length) return;
                                    if (e.key === 'ArrowDown') { e.preventDefault(); setFinderTypeaheadIdx(i => Math.min(i + 1, typeaheadFlat.length - 1)); }
                                    else if (e.key === 'ArrowUp') { e.preventDefault(); setFinderTypeaheadIdx(i => Math.max(i - 1, 0)); }
                                    else if (e.key === 'Enter') { e.preventDefault(); selectFinderFocus(typeaheadFlat[finderTypeaheadIdx] || typeaheadFlat[0]); }
                                }}
                                placeholder="Focus: search players, picks, owners — yours and the league's"
                                aria-label="Finder focus search"
                                role="combobox"
                                aria-expanded={typeaheadFlat.length > 0}
                                aria-autocomplete="list"
                                style={{ width: '100%', minHeight: _vp.isPhone ? '44px' : '38px', border: '1px solid rgba(212,175,55,0.22)', borderRadius: '5px', background: 'rgba(255,255,255,0.045)', color: 'var(--white)', fontFamily: 'var(--font-body)', fontSize: '0.8rem', padding: '8px 10px' }}
                            />
                            {typeaheadFlat.length > 0 && (
                                <div role="listbox" aria-label="Focus matches" ref={node => {
                                    // Phone (D5): fit the dropdown to the VISIBLE viewport — the iOS
                                    // keyboard eats ~300px of a 667px screen and env(safe-area) can't
                                    // see it. kbHeight already includes the visual-viewport pan, so
                                    // visible bottom in layout coords = innerHeight − kbHeight. With
                                    // the keyboard closed (hardware kb edge case) reserve 64px so the
                                    // list also never runs under the bottom dock (z 40 < dock 100).
                                    // Callback ref re-runs every render, so kbOpen/kbHeight changes
                                    // (viewport store re-render) re-measure automatically.
                                    if (!node || !_vp.isPhone) return;
                                    // Keyboard closed: measure the REAL dock extent (PhoneDock bar
                                    // + home-indicator inset on notched phones) instead of a fixed
                                    // 64px so the last rows never render under the dock.
                                    const _bar = document.querySelector('.wr-phone-dock');
                                    const bottomGuard = _vp.kbOpen ? _vp.kbHeight
                                        : (_bar ? Math.max(0, window.innerHeight - _bar.getBoundingClientRect().top) + 8 : 64);
                                    const visibleBottom = window.innerHeight - bottomGuard;
                                    const maxH = Math.max(140, Math.min(320, visibleBottom - node.getBoundingClientRect().top - 8));
                                    node.style.maxHeight = maxH + 'px';
                                }} style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, marginTop: '4px', background: 'var(--off-black, #10141b)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '6px', maxHeight: '320px', overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', boxShadow: '0 12px 26px rgba(0,0,0,0.6)' }}>
                                    {typeaheadGroups.map(group => (
                                        <div key={group.label}>
                                            <div style={{ padding: '6px 10px 3px', fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--silver)', opacity: 0.6 }}>{group.label}</div>
                                            {group.rows.map(row => {
                                                const active = typeaheadFlat.indexOf(row) === finderTypeaheadIdx;
                                                return <button key={row.key} type="button" role="option" aria-selected={active} onMouseDown={e => e.preventDefault()} onClick={() => selectFinderFocus(row)} style={{ width: '100%', display: 'flex', alignItems: _vp.isPhone ? 'center' : 'baseline', gap: '8px', minHeight: _vp.isPhone ? '44px' : undefined, border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', background: active ? 'rgba(212,175,55,0.12)' : 'transparent', color: active ? 'var(--white)' : 'var(--silver)', textAlign: 'left', padding: '7px 10px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.78rem' }}>
                                                    <strong style={{ color: 'var(--white)', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.label}</strong>
                                                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.68rem', opacity: 0.7 }}>{row.sub}</span>
                                                    {row.value != null && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{row.value.toLocaleString()}</span>}
                                                </button>;
                                            })}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {focusR && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', border: '1px solid rgba(212,175,55,0.35)', borderRadius: '5px', background: 'rgba(212,175,55,0.08)', padding: '4px 8px', fontSize: '0.74rem', color: 'var(--white)' }}>
                                    <em style={{ fontStyle: 'normal', fontSize: '0.6rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)' }}>{focusR.kind === 'pick' ? 'Pick' : focusR.kind === 'owner' ? 'Owner' : (focusR.pos || 'Player')}</em>
                                    <strong style={{ fontWeight: 600 }}>{focusR.label}</strong>
                                    {focusR.kind !== 'owner' && <span style={{ fontSize: '0.68rem', color: 'var(--silver)' }}>{String(focusR.rosterId) === String(myRosterId) ? 'yours' : (ownerNameForRosterId(focusR.rosterId) || 'league')}</span>}
                                    {/* Phone: hit-padding only (negative margin cancels the layout
                                        shift) so the chip row's height doesn't change — plan D7. */}
                                    <button type="button" onClick={clearFinderFocus} aria-label="Clear focus" style={{ border: 'none', background: 'transparent', color: 'var(--silver)', cursor: 'pointer', fontSize: '0.8rem', padding: _vp.isPhone ? '12px 10px' : '0 2px', margin: _vp.isPhone ? '-12px -8px' : 0, lineHeight: 1 }}>✕</button>
                                </span>
                                {focusR.kind === 'pick' && <span style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.65 }}>{String(focusR.rosterId) === String(myRosterId) ? 'Shopping this pick league-wide for value back.' : 'Packages are built to pry this pick from its owner.'}</span>}
                            </div>
                        )}

                        <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.75 }}>
                            GM lens: <strong style={{ color: 'var(--gold)', fontWeight: 700 }}>{focusTuning.modeLabel}</strong> · acceptance bar {actionFloor}% · {focusTuning.untouchable.size} untouchable{focusTuning.untouchable.size === 1 ? '' : 's'} · {modeDescriptor}
                        </div>

                        <div className="tc-dhq-modebar" role="group" aria-label="Partner filter">
                            <button type="button" className={effPartnerId == null ? 'is-active' : ''} onClick={() => setPartnerFacet(null)}>Auto</button>
                            {partnerBoard.slice(0, 6).map(item => {
                                const a = item.assessment;
                                const active = effPartnerId != null && String(a.ownerId) === String(effPartnerId);
                                return <button key={a.rosterId} type="button" className={active ? 'is-active' : ''} title={`${item.score} fit · ${item.tag} · ${item.scoreReasons.slice(0, 2).join(' · ')}`} onClick={() => setPartnerFacet(active ? null : a.ownerId)}>{a.ownerName} {item.score}</button>;
                            })}
                        </div>

                        <div>
                            <button type="button" className="tc-dhq-detail-toggle" onClick={() => setAssetBrowserOpen(v => !v)}>{assetBrowserOpen ? 'Hide asset browser ▴' : 'Browse assets ▾'}</button>
                        </div>
                        {assetBrowserOpen && (assetBrowserRows.length > 0 ? (
                            <div className="tc-dhq-asset-browser">
                                <div className="tc-dhq-browser-head">
                                    <div>
                                        <span>{browsingMyRoster ? 'Focus asset' : 'Target asset'}</span>
                                        <strong>{browsingMyRoster ? 'Your roster' : 'League player board'}</strong>
                                    </div>
                                    <div className="tc-dhq-browser-controls">
                                        <label>Pos
                                            <select value={assetBrowserPos} onChange={e => setAssetBrowserPos(e.target.value)}>
                                                {browserPositions.map(pos => <option key={pos} value={pos}>{pos === 'ALL' ? 'All' : pos}</option>)}
                                            </select>
                                        </label>
                                        <label>Sort
                                            <select value={assetBrowserSort} onChange={e => setAssetBrowserSort(e.target.value)}>
                                                {assetBrowserSorts.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
                                            </select>
                                        </label>
                                        {tcRookieFields && <button type="button" className={assetBrowserRookieOnly ? 'is-active' : ''} title="Show only rookies — college, draft slot, and tier appear under each name" onClick={() => setAssetBrowserRookieOnly(v => !v)}>Rookies</button>}
                                    </div>
                                </div>
                                <div className="tc-dhq-asset-table" role="table" aria-label="Trade Finder asset browser">
                                    <div className="tc-dhq-asset-row tc-dhq-asset-head" role="row">
                                        <span>Player</span>
                                        <span>Pos</span>
                                        <span>DHQ</span>
                                        <span>Age</span>
                                        <span>Current owned team</span>
                                        <span>Last FP</span>
                                        <span>Prime</span>
                                    </div>
                                    {visibleAssetRows.length ? visibleAssetRows.map(row => (
                                        <button key={`${row.rosterId}-${row.pid}`} type="button" role="row" className={`tc-dhq-asset-row${focusPlayerPid != null && String(focusPlayerPid) === String(row.pid) ? ' is-active' : ''}`} onClick={() => selectAssetFocus(row)}>
                                            <span title={row.name}>{row.name}{(() => {
                                                const rf = tcRookieInfoFor(row.pid);
                                                if (!rf) return null;
                                                const bits = [rf.college, rf.draftSlot || (rf.isUDFA ? 'UDFA' : ''), rf.tierLabel].filter(Boolean);
                                                if (!bits.length) return null;
                                                return <em style={{ display:'block', fontStyle:'normal', fontSize:'0.64rem', color:'var(--gold)', opacity:0.85, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{bits.join(' · ')}</em>;
                                            })()}</span>
                                            <span style={{ color:posColor(row.pos) }}>{row.pos}</span>
                                            <span>{row.value.toLocaleString()}</span>
                                            <span>{row.age || '--'}</span>
                                            <span title={row.ownerLabel}>{row.ownerLabel}</span>
                                            <span>{row.lastPoints ? row.lastPoints.toLocaleString() : '--'}</span>
                                            <span>{row.primeYears != null ? row.primeYears : '--'}</span>
                                        </button>
                                    )) : <div className="tc-dhq-empty">{assetBrowserRookieOnly ? (tcRookieIndex.size === 0 ? 'Rookie data still loading…' : 'No tradeable rookies match this filter (rookies with no trade value yet are hidden).') : 'No assets match this position filter.'}</div>}
                                </div>
                            </div>
                        ) : <div className="tc-dhq-empty">No tradeable assets to browse for this scope.</div>)}

                        {deals.length
                            ? <div className="tc-dhq-package-note"><b>{actionableDeals.length ? 'Ready' : 'Moonshots only'}</b> {actionableDeals.length || 0} actionable package{actionableDeals.length === 1 ? '' : 's'}{moonshotCount ? ` · ${moonshotCount} moonshot${moonshotCount === 1 ? '' : 's'} hidden` : ''}{finderPoolOn && !finderPool.done ? ` · scanning ${finderPool.scanned}/${finderPool.total}` : ''}</div>
                            : finderPoolOn && !finderPool.done
                                ? <div className="tc-dhq-package-note"><b>Scanning</b> partner {finderPool.scanned}/{finderPool.total} — rows appear as the league scan runs.</div>
                                : <div className="tc-dhq-empty">No package found for this intent. Try another partner chip, clear the focus, or open the builder below.</div>}
                    </div>
                </section>

                {deals.length > 0 && (
                    <section className="tc-dhq-panel tc-dhq-deal-stage">
                        <div className="tc-dhq-panel-head">
                            <span>Finder Rows</span>
                            <em>{showAllDeals ? deals.length : actionableDeals.length} idea{(showAllDeals ? deals.length : actionableDeals.length) === 1 ? '' : 's'} · {finderPoolOn ? 'league-wide' : selectedPartner ? selectedPartner.ownerName : 'Select a partner'}</em>
                        </div>
                        <div className="tc-dhq-deal-stage-body">
                            {visibleDeals.length
                                ? visibleDeals.map((deal, idx) => <TcDealCard key={deal.id} deal={deal} idx={idx} actionFloor={actionFloor} expandedDealId={expandedDealId} setExpandedDealId={setExpandedDealId} loadDealIntoBuilder={loadDealIntoBuilder} saveDeal={saveDeal} sideSummary={sideSummary} />)
                                : <div className="tc-dhq-empty">No actionable package clears {actionFloor}% acceptance. Use moonshots only if you want long-shot leverage ideas.</div>}
                        </div>
                        {(deals.length > visibleDeals.length || showAllDeals) && <button className="tc-dhq-show-more" onClick={() => setShowAllDeals(!showAllDeals)}>{showAllDeals ? 'Hide moonshots' : moonshotCount ? `Show ${moonshotCount} moonshot${moonshotCount === 1 ? '' : 's'}` : `Show ${deals.length - visibleDeals.length} more`}</button>}
                    </section>
                )}

                {/* Saved queue moved to the Trade Log tab's My Pipeline (Phase 5). */}
            </div>;
        }

        // ── renderContextRail — fixed two-card right rail (no morphing, no pinning) ──
        // VERDICT on top: the builder's live deal via TcVerdictPanel (grade/label/gain
        // free, likelihood/psych/DNA rows Pro inside the panel) with the Alex second
        // opinion under it (its own trade-quick-check gate, user-initiated). Compact
        // OWNER DNA below: live-deal partner → selected partner → top partner; content
        // Pro with a teaser for free. Desktop ≥1281px = sticky rail column; narrower
        // viewports stack the same two cards inline below the builder (index.html CSS).
        // ── League Teams — scrollable scout of every rival roster ──
        // Compact need/surplus card per team, ranked best-fit-first (partnerBoard
        // is already scored + sorted, and excludes my own team). Tap → that owner's
        // full Owner DNA. Reuses the exact assessment data the finder runs on.
        // Rendered in the far-right rail (≥1281px) AND inline on narrow/portrait
        // (<1281px, where the rail is hidden) — CSS keeps exactly one visible.
        function renderLeagueTeamsCard() {
            const _pro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
            const POSHEX = { QB:'#e74c3c', RB:'#2ecc71', WR:'#3498db', TE:'#f0a500', K:'#9b59b6', DEF:'#85929e', DL:'#e67e22', LB:'#1abc9c', DB:'#e91e63' };
            const leagueTargetPts = Math.max(1, ...assessments.map(a => a.weeklyPts || 0));
            const body = !_pro
                ? React.createElement(TcProTeaser, { label: 'League Teams', feature: 'owner-dna', sub: 'Scan every rival roster — needs, surplus, and trade fit — then open any owner\'s full DNA in a tap.' })
                : !partnerBoard.length
                    ? <div className="tc-dhq-empty">No rival rosters in scope yet.</div>
                    : partnerBoard.map(item => {
                        const a = item.assessment;
                        const wp = a.weeklyPts || 0;
                        const needs = (a.needs || []).slice(0, 5);
                        const has = (a.strengths || []).slice(0, 6);
                        const openDna = () => { setExpandedDnaOwner(a.rosterId); setTcTab('dna'); };
                        return (
                            // A <div role=button>, not <button>: Safari/WebKit collapses block
                            // children inside a <button>, which mashed the card rows together.
                            <div key={a.rosterId} role="button" tabIndex={0} className="tc-lt-card"
                                title={'Open ' + a.ownerName + '’s Owner DNA'}
                                onClick={openDna}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDna(); } }}>
                                <div className="tc-lt-top">
                                    {/* Inline sizing so a stale cached stylesheet can't render the
                                        avatar at its full ~100px natural size. */}
                                    <span className="tc-lt-av" style={{ width: '22px', height: '22px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--charcoal)', border: '1px solid rgba(212,175,55,0.25)' }}>
                                        {avatarUrl(a.avatar)
                                            ? <img src={avatarUrl(a.avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                                            : <b style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '0.7rem', color: 'var(--gold)' }}>{(a.ownerName || '?').charAt(0).toUpperCase()}</b>}
                                    </span>
                                    <span className="tc-lt-nm">{a.ownerName}</span>
                                    {a.tier && <span className="tc-lt-win" style={{ color: a.tierColor, borderColor: a.tierColor }}>{a.tier}</span>}
                                </div>
                                {a.teamName && a.teamName !== a.ownerName && <div className="tc-lt-team">{a.teamName}</div>}
                                <div className="tc-lt-line">
                                    {wp > 0 && <span className="tc-lt-p">{wp.toFixed(1)} <small>/ {leagueTargetPts.toFixed(0)} pts</small></span>}
                                    <span className="tc-lt-fit">{item.compat}% fit</span>
                                </div>
                                {needs.length > 0 && <div className="tc-lt-row"><span className="tc-lt-lbl">Needs</span>{needs.map(n => <span key={n.pos} className="tc-lt-chip" style={{ color: POSHEX[n.pos] || 'var(--silver)', borderColor: (POSHEX[n.pos] || '#BDB8AD') + '66', background: (POSHEX[n.pos] || '#BDB8AD') + '18' }}>{n.pos}</span>)}</div>}
                                {has.length > 0 && <div className="tc-lt-row"><span className="tc-lt-lbl">Has</span>{has.map(p => <span key={p} className="tc-lt-chip tc-lt-has">+{p}</span>)}</div>}
                                {item.dnaKey && item.dnaKey !== 'NONE' && item.dna && <div className="tc-lt-arch" style={{ color: item.dna.color }}>{item.dna.label}</div>}
                            </div>
                        );
                    });
            return (
                <div className="tc-dhq-panel tc-rail-card tc-lt-panel">
                    <div className="tc-dhq-panel-head">
                        <span>League Teams</span>
                        <em>{_pro && partnerBoard.length ? partnerBoard.length + ' rivals · tap → DNA' : 'Scout the field'}</em>
                    </div>
                    <div className="tc-dhq-panel-body">
                        <div className="tc-lt-scroll">{body}</div>
                    </div>
                </div>
            );
        }

        // The far-right rail is now the League Teams scout on its own — it fills the
        // full rail height (per owner request; the old Live Verdict + single-partner
        // Owner DNA cards were removed). Tapping a team still opens its full Owner DNA.
        function renderContextRail(tabButtons) {
            return (
                <aside className="tc-context-rail">
                    {/* Section tabs live at the top of the rail on wide desk layouts —
                        stacked ABOVE the League Teams card as a real flex item, so they
                        can never float over or overlap it (owner ruling). */}
                    {tabButtons ? <div className="tc-dhq-modebar tc-rail-tabs" role="group" aria-label="Trade Center sections">{tabButtons}</div> : null}
                    {renderLeagueTeamsCard()}
                </aside>
            );
        }

        // ── renderAdaptiveWorkspace — the Trade Center workspace (every tier's only view) ──
        // Phase 2 IA: TRADE DESK (default: finder region + persistent builder strip) ·
        // OWNER DNA · TRADE LOG. Gates are region-scoped (owner ruling, wrIsPro only):
        // the Desk's finder region and the Owner DNA tab are Pro with warroom-styled
        // teasers; the builder strip + raw verdict + Trade Log ledger are free.
        function renderAdaptiveWorkspace() {
            const active = tcTab; // canonical: 'desk' | 'dna' | 'log'
            const _pro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
            const surfaces = [
                { key: 'desk', label: 'Trade Builder' },
                { key: 'dna', label: 'Owner DNA' },
                { key: 'log', label: 'Trade Log' },
            ];
            // One set of section-tab buttons, rendered in two homes: the in-flow
            // row (narrow / DNA / Log) and inside the rail (wide desk). Chip
            // classes give them the exact finder-chip look, gold when active.
            // Owner ruling: the TRADE BUILDER chip IS the builder switch — it
            // opens/closes the builder panel (gold while open) instead of the
            // retired always-on strip; the finder is the desk's default view.
            const renderTcTabButtons = () => surfaces.map(s => (
                <button key={s.key} type="button"
                    className={(s.key === 'desk' ? active === 'desk' && builderExpanded : active === s.key) ? 'is-active' : ''}
                    onClick={() => {
                        if (s.key === 'desk') {
                            if (active === 'desk') setBuilderExpanded(v => !v);
                            else { setTcTab('desk'); setBuilderExpanded(true); }
                        } else setTcTab(s.key);
                    }}>
                    {s.label}
                    {s.key === 'log' && savedDeals.length > 0 && <span style={{ fontWeight: 500, opacity: 0.8 }}>{' · ' + savedDeals.length}</span>}
                </button>
            ));
            let body;
            if (active === 'dna') {
                body = _pro ? renderOwnerDna() : React.createElement(TcProTeaser, { label: 'Owner DNA', feature: 'owner-dna', sub: 'Profile every manager\'s trading psychology. Know who\'s a Fleecer, who\'s Desperate, and exactly how to approach each trade conversation.' });
            } else if (active === 'log') {
                // TRADE LOG (Phase 5): My Pipeline (Pro, wrIsPro teaser) + League
                // Ledger — raw history + raw fairness grades free per the gate ruling.
                body = renderTradeLog();
            } else if (!_pro) {
                // TRADE DESK, free: the finder region is Pro; the persistent builder
                // strip below stays the full free experience (manual builder + raw verdict).
                body = React.createElement(TcProTeaser, { label: 'Trade Finder', feature: 'trade-finder', sub: 'Auto-generate deals every owner in your league would actually consider — ranked by acceptance odds, owner psychology, and roster fit.' });
            } else {
                body = renderDealHQ();
            }
            // Persistent live verdict — the in-progress deal's verdict follows the Desk.
            const _verdict = computeManualVerdict();
            const _tsDeps = buildTradeSideDeps();
            // Context Rail: Desk-only per the approved IA — Owner DNA and Trade Log are
            // full-width tabs. Sticky column ≥1281px, inline stack below the builder
            // otherwise (index.html CSS). DNA-mini partner precedence: live-deal partner
            // → finder query's effective partner (owner focus > league-asset focus's
            // owner > facet) → top partner. Free never receives a ranked partner
            // (the board pick itself is partner intel — a Pro read).
            const railOn = active === 'desk';
            return (
                <div className="tc-trade-root">
                    {/* Phone-tier touch bumps for the class-styled Trade Desk controls
                        (index.html base CSS sizes them ~28-32px). Scoped ≤767 so the
                        tablet/desktop tiers are untouched (cardinal guardrail); scoped
                        under .tc-trade-root so nothing leaks to other tabs. Glyph and
                        font sizes unchanged — hit areas only (plan D7). */}
                    <style>{`
                        @media (max-width: 767px) {
                            .tc-trade-root .tc-ta-owner-select,
                            .tc-trade-root .tc-ta-roster-filter,
                            .tc-trade-root .tc-dna-select { min-height: 44px; }
                            .tc-trade-root .tc-ta-roster-item { min-height: 44px; }
                            .tc-trade-root button.tc-dhq-asset-row { min-height: 44px; }
                            .tc-trade-root .tc-rail-dna-link { min-height: 44px; }
                        }
                    `}</style>
                    {/* Section tabs — styled EXACTLY like the finder chips (same
                        .tc-dhq-modebar classes: bordered chips, active = solid gold).
                        On wide desk layouts the rail owns the tabs (they render inside
                        the rail column above League Teams — no floating/overlap); this
                        in-flow row shows everywhere else (narrow, Owner DNA, Trade Log). */}
                    <div className={'tc-tab-row' + (railOn ? ' rail-owns-tabs' : '')}>
                        <div className="tc-dhq-modebar" role="group" aria-label="Trade Center sections">{renderTcTabButtons()}</div>
                    </div>
                    <div className={'tc-adaptive-canvas' + (railOn ? ' has-rail' : '')}>
                    <div className="tc-adaptive-main">
                    {active === 'desk' && tradeContext && (
                        <div className="trade-context-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
                            <div style={{ minWidth: 0 }}>
                                <span style={{ display: 'block', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Trade Context</span>
                                <strong style={{ display: 'block', color: 'var(--white)', fontSize: '0.9rem', fontFamily: 'var(--font-title)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Opened from transaction ticker</strong>
                                <em style={{ display: 'block', color: 'var(--silver)', fontSize: '0.74rem', fontStyle: 'normal' }}>{formatTradeContextSummary(tradeContext) || 'Use this deal as context while evaluating partner fit and packages.'}</em>
                            </div>
                            <button type="button" onClick={clearTradeContext} style={{ background: 'transparent', border: '1px solid var(--acc-line2, rgba(212,175,55,0.32))', borderRadius: '4px', color: 'var(--gold)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.72rem', padding: '4px 10px', textTransform: 'uppercase' }}>Clear</button>
                        </div>
                    )}
                    {/* Trade Builder — owner ruling: the always-on blue strip is gone
                        and the Trade Finder owns the top of the desk. The builder now
                        renders ONLY while open, toggled by the TRADE BUILDER chip
                        (and by Load in Builder on a finder row), as a standard gold
                        panel above the finder so it appears where you just tapped. */}
                    {active === 'desk' && builderExpanded && (
                        <section className="tc-dhq-panel" style={{ marginBottom: '12px' }}>
                            <div className="tc-dhq-panel-head">
                                <span>Trade Builder</span>
                                <em>{_verdict.hasTrade
                                    ? `${_verdict.verdictText} ${_verdict.diffDisplay} · gave ${_verdict.totalA.toLocaleString()} / got ${_verdict.totalB.toLocaleString()}${_pro ? ` · ${_verdict.likelihood}% accept` : ''}`
                                    : 'Build or tweak a trade without leaving this view.'}</em>
                                <div className="tc-dhq-actions" style={{ flex: '0 0 auto' }}>
                                    <button type="button" onClick={() => setBuilderExpanded(false)}>Close ▴</button>
                                </div>
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.6, marginBottom: '10px', lineHeight: 1.5 }}>
                                Values sourced from <strong style={{ color: 'var(--gold)' }}>{skinVocabulary.valueShortLabel || 'DHQ'} Engine</strong> ({valueSourceLabel}).
                            </div>
                            {/* .tc-builder-sides: phone tier (index.html ≤767 CSS) stacks the
                                two sides vertically (send above, get below) — the hard 1fr 1fr
                                yields two ~165px columns at 375px, unusable for the owner
                                select + roster picker. ≥768 keeps side-by-side. */}
                            <div className="tc-builder-sides" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'start' }}>
                                {TcTradeSide({ side: 'A', color: 'var(--k-5dade2, #5dade2)', label: 'YOU SEND', ..._tsDeps })}
                                {TcTradeSide({ side: 'B', color: 'var(--k-e74c3c, #e74c3c)', label: 'YOU GET', ..._tsDeps })}
                            </div>
                        </section>
                    )}
                    {/* League Teams inline — narrow/portrait only (rail is hidden <1281px). */}
                    {active === 'desk' && <div className="tc-lt-inline">{renderLeagueTeamsCard()}</div>}
                    {body}
                    </div>
                    {railOn && renderContextRail(renderTcTabButtons())}
                    </div>
                </div>
            );
        }

        // ── computeManualVerdict — the manual builder's deal evaluation, extracted from
        // the retired analyzer surface so the persistent builder strip can reuse it (and so the
        // verdict math lives in one place). Pure function of builder state; no behavior change.
        function computeManualVerdict() {
            // Use the same ownership-aware value path as the pick list.
            const pickVal = (pkId) => { const p = pkId.split('-'); const sl = (p[4] || '').charAt(0) === 's' ? Number(p[4].slice(1)) : null; return pickValueForParts(p[1], Number(p[2]), p[3], sl); };
            const totalA = tradeIds.A.reduce((s, id) => s + (getPlayerValue(id).value || 0), 0)
                + tradePickIds.A.reduce((s, pkId) => s + pickVal(pkId), 0)
                + Math.round((tradeFaab.A || 0) * FAAB_RATE);
            const totalB = tradeIds.B.reduce((s, id) => s + (getPlayerValue(id).value || 0), 0)
                + tradePickIds.B.reduce((s, pkId) => s + pickVal(pkId), 0)
                + Math.round((tradeFaab.B || 0) * FAAB_RATE);
            const userGain = totalB - totalA;
            const absDiff = Math.abs(userGain);
            const hasTrade = tradeIds.A.length > 0 || tradeIds.B.length > 0 || tradePickIds.A.length > 0 || tradePickIds.B.length > 0 || tradeFaab.A > 0 || tradeFaab.B > 0;
            const diff = totalA - totalB;

            const otherOwnerId = tradeOwner.B;
            const otherDnaKey = otherOwnerId ? (ownerDna[otherOwnerId] || 'NONE') : 'NONE';
            const otherDna = DNA_TYPES[otherDnaKey] || DNA_TYPES.NONE;
            const myOwnerId = tradeOwner.A || (myAssessment?.ownerId || null);
            const theirAssessment = assessments.find(a => a.ownerId === otherOwnerId) || null;
            const theirPosture = calcOwnerPosture(theirAssessment, otherDnaKey);
            const psychTaxes = calcPsychTaxes(myAssessment, theirAssessment, otherDnaKey, theirPosture);
            const grudgeTax = calcGrudgeTax(myOwnerId, otherOwnerId, grudges, otherDnaKey);
            const netTaxTotal = psychTaxes.reduce((s,t) => s + (Number(t.impact) || 0), 0) + grudgeTax.total;
            const acceptanceTaxes = grudgeTax.total !== 0
                ? [...psychTaxes, { name:'Grudge Tax', impact:grudgeTax.total, type: grudgeTax.total > 0 ? 'BONUS' : 'TAX' }]
                : psychTaxes;
            // ── One evaluator (Phase 1): the headline derives from the SAME shared
            // TradeEngine.fairnessGrade ratio bands the finder's deal cards use (buildDeal).
            // The old fairMargin(4% of max side) WIN/LOSE/EVEN derivation is deleted —
            // regression baseline: tmp/trade-regression/run-regression.js.
            const grade = window.App?.TradeEngine?.fairnessGrade
                ? window.App.TradeEngine.fairnessGrade(totalA, totalB)
                : { grade: totalB >= totalA ? 'B+' : 'C', label: totalB >= totalA ? 'Win' : 'Overpay', color: totalB >= totalA ? 'var(--good)' : 'var(--bad)' };

            // Use shared canonical acceptance calculation (same as Scout / Deal HQ buildDeal).
            // Step 2 (one evaluator): pass totalPieces so the complexity tax (−5% acceptance per asset
            // beyond 4) matches buildDeal — manual and generated deals now score by identical math.
            const _calcLikelihood = window.App?.TradeEngine?.calcAcceptanceLikelihood;
            const tradePieceCount = tradeIds.A.length + tradeIds.B.length + tradePickIds.A.length + tradePickIds.B.length;
            let likelihood = 50;
            if (hasTrade && (totalA > 0 || totalB > 0)) {
                if (typeof _calcLikelihood === 'function') {
                    likelihood = _calcLikelihood(totalA, totalB, otherDnaKey, acceptanceTaxes, myAssessment, theirAssessment, { totalPieces: tradePieceCount });
                } else {
                    const maxSide = Math.max(totalA, totalB, 1);
                    const complexityTax = Math.max(0, tradePieceCount - 4) * 5;
                    const taxValueAdjust = ((netTaxTotal - complexityTax) / 200) * maxSide;
                    const normalizedSurplus = (diff + taxValueAdjust) / maxSide;
                    likelihood = Math.round(Math.max(5, Math.min(95, 50 + Math.round(normalizedSurplus * 200))));
                }
            }
            const manualBehaviorProfile = theirAssessment ? ownerBehaviorByRosterId?.[String(theirAssessment.rosterId)] : null;
            const manualBehaviorFit = manualBehaviorProfile && typeof window.App?.Intelligence?.evaluateBehaviorTradeFit === 'function'
                ? window.App.Intelligence.evaluateBehaviorTradeFit({
                    behaviorProfile: manualBehaviorProfile,
                    givePlayers: tradeIds.A.map(playerAsset).filter(Boolean),
                    givePicks: tradePickIds.A.map(id => ({ id })),
                    receivePlayers: tradeIds.B.map(playerAsset).filter(Boolean),
                    receivePicks: tradePickIds.B.map(id => ({ id })),
                    userGain,
                })
                : null;
            if (manualBehaviorFit) likelihood = Math.round(Math.max(5, Math.min(95, likelihood + (manualBehaviorFit.acceptanceDelta || 0))));
            const likelihoodColor = likelihood >= 70 ? 'var(--win-green)' : likelihood >= 45 ? 'var(--warn)' : 'var(--loss-red)';
            // Letter grade + label + numeric diff are FREE (Scout parity) — no gate on these fields.
            const verdictColor = grade.color || grade.col || 'var(--gold)';
            const verdictText = `${grade.grade}${grade.label ? ' · ' + grade.label.toUpperCase() : ''}`;
            const diffDisplay = userGain > 0 ? `+${absDiff.toLocaleString()}` : userGain < 0 ? `-${absDiff.toLocaleString()}` : '+/-0';
            const sentPositions = [...new Set(tradeIds.A.map(pid => normPos(playersData[pid]?.position)).filter(Boolean))];
            const receivedPositions = [...new Set(tradeIds.B.map(pid => normPos(playersData[pid]?.position)).filter(Boolean))];
            const pickCapitalDelta = tradePickIds.B.reduce((s, pkId) => s + pickVal(pkId), 0) - tradePickIds.A.reduce((s, pkId) => s + pickVal(pkId), 0);
            const pickQuantityDelta = tradePickIds.B.length - tradePickIds.A.length;
            const faabDelta = (tradeFaab.B || 0) - (tradeFaab.A || 0);
            const rosterImpactLabel = receivedPositions.length || sentPositions.length
                ? `+${receivedPositions.join('/') || 'none'} / -${sentPositions.join('/') || 'none'}`
                : 'No players selected';
            const starterValueDelta = tradeIds.B.reduce((s, id) => s + (getPlayerValue(id).value || 0), 0) - tradeIds.A.reduce((s, id) => s + (getPlayerValue(id).value || 0), 0);
            // ── GM Strategy lens (Lane 2 — YOUR bar to act). Derived ONLY from GM
            // Strategy via getDealHqTuning; compares against `likelihood` above but
            // never edits it, so the opponent's displayed acceptance % is unchanged.
            const _gmTuning = getDealHqTuning(window.WR?.AlexSettings?.get?.() || {});
            const gmFloor = dealActionableAcceptanceFloor(_gmTuning);
            const gmModeLabel = _gmTuning.modeLabel;
            const gmViability = hasTrade ? dealViability({ likelihood }, _gmTuning) : null;
            const gmWarnings = [];
            if (hasTrade) {
                tradeIds.A
                    .filter(pid => _gmTuning.untouchable?.has(String(pid)))
                    .forEach(pid => gmWarnings.push({ type: 'untouchable', text: `Untouchable in deal: ${playersData[pid]?.full_name || playersData[pid]?.name || pid}` }));
                sentPositions
                    .filter(p => _gmTuning.targetPositions?.has(p))
                    .forEach(p => gmWarnings.push({ type: 'target', text: `Shipping ${p} — a position you're targeting` }));
                receivedPositions
                    .filter(p => _gmTuning.sellPositions?.has(p))
                    .forEach(p => gmWarnings.push({ type: 'sell', text: `Buying ${p} — your strategy says SELL` }));
            }
            return { totalA, totalB, hasTrade, grade, userGain, otherOwnerId, otherDnaKey, otherDna, theirPosture, psychTaxes, grudgeTax, netTaxTotal, likelihood, manualBehaviorProfile, manualBehaviorFit, likelihoodColor, verdictColor, verdictText, diffDisplay, rosterImpactLabel, starterValueDelta, pickCapitalDelta, pickQuantityDelta, faabDelta, gmFloor, gmModeLabel, gmViability, gmWarnings };
        }

        // ── Alex second opinion on the builder deal ──────────────────────────
        // Sends the deterministic verdict plus both teams' assessments and the
        // full deal to the trade_verdict edge route (premium tier, uncached).

        function buildTradeVerdictContext(v) {
            const needsToStrings = (needs) => (needs || []).map(n => n.urgency === 'deficit' ? `${n.pos}*` : n.pos);
            const pickParts = (pkId) => { const p = pkId.split('-'); const sl = (p[4] || '').charAt(0) === 's' ? Number(p[4].slice(1)) : null; return { year: p[1], round: Number(p[2]), slot: sl, value: pickValueForParts(p[1], Number(p[2]), p[3], sl) }; };
            const dealSide = (side) => ({
                players: tradeIds[side].map(playerAsset).filter(Boolean).map(a => ({ name: a.name, pos: a.pos, age: a.age, value: a.value })),
                picks: tradePickIds[side].map(pickParts),
                faab: tradeFaab[side] || 0,
            });
            const theirAssessment = assessments.find(a => a.ownerId === v.otherOwnerId) || null;
            const psychNotes = [...v.psychTaxes.slice(0, 3).map(t => `${t.name} ${t.impact > 0 ? '+' : ''}${t.impact}%`),
                ...(v.grudgeTax.total !== 0 ? [`Grudge ${v.grudgeTax.total > 0 ? '+' : ''}${v.grudgeTax.total}%`] : [])].join(', ');
            return {
                leagueName: currentLeague?.name || 'my league',
                leagueId,
                rosterPositions: currentLeague?.roster_positions || [],
                roster_positions: currentLeague?.roster_positions || [],
                scoringSettings: currentLeague?.scoring_settings || {},
                scoring_settings: currentLeague?.scoring_settings || {},
                myTeam: myAssessment ? {
                    record: `${myAssessment.wins}-${myAssessment.losses}`,
                    tier: myAssessment.tier,
                    window: myAssessment.tradeWindow || myAssessment.window || '',
                    healthScore: myAssessment.healthScore,
                    needs: needsToStrings(myAssessment.needs),
                    strengths: (myAssessment.strengths || []).slice(0, 5),
                } : {},
                partnerTeam: theirAssessment ? {
                    owner: theirAssessment.ownerName,
                    record: `${theirAssessment.wins}-${theirAssessment.losses}`,
                    tier: theirAssessment.tier,
                    window: theirAssessment.tradeWindow || theirAssessment.window || '',
                    dna: v.otherDnaKey !== 'NONE' ? (v.otherDna.label || v.otherDnaKey) : 'Unknown',
                    posture: v.theirPosture?.label || 'N/A',
                    needs: needsToStrings(theirAssessment.needs),
                } : {},
                iSend: dealSide('A'),
                iReceive: dealSide('B'),
                verdict: {
                    verdictText: v.verdictText,
                    diffDisplay: v.diffDisplay,
                    likelihood: `${v.likelihood}%`,
                    psychNotes,
                },
            };
        }

        async function requestAlexVerdict(v, dealKey) {
            setAlexVerdict({ loading: true, dealKey });
            try {
                const result = await window.OD.callAI({ type: 'trade_verdict', context: buildTradeVerdictContext(v) });
                setAlexVerdict({ text: result.analysis, dealKey });
                const partnerName = (assessments.find(a => a.ownerId === v.otherOwnerId) || {}).ownerName;
                if (typeof window.OD?.saveAIAnalysis === 'function') {
                    window.OD.saveAIAnalysis(leagueId, 'trade_verdict', partnerName ? `Trade Verdict vs ${partnerName}` : 'Trade Verdict', result.analysis).catch?.(() => {});
                }
            } catch (e) {
                setAlexVerdict({ error: e.message || 'Second opinion failed. Try again in a moment.', dealKey });
            }
        }

        function sendVerdictFeedback(action, dealKey) {
            setAlexVerdict(prev => prev && prev.dealKey === dealKey ? { ...prev, feedback: action } : prev);
            // Learning-loop capture — no-op until the AIFeedback helper ships.
            window.WR?.AIFeedback?.send?.({ leagueId, surface: 'trade_verdict', recId: dealKey, action });
        }

        function renderAlexVerdict() {
            const v = computeManualVerdict();
            if (!v.hasTrade) return null;
            if (!canAccess('trade-quick-check')) return null;
            // Key the response to the deal's contents so editing the deal invalidates a stale verdict.
            const dealKey = [tradeIds.A.join(','), tradeIds.B.join(','), tradePickIds.A.join(','), tradePickIds.B.join(','), tradeFaab.A, tradeFaab.B].join('|');
            const current = alexVerdict && alexVerdict.dealKey === dealKey ? alexVerdict : null;
            const ClampedRead = window.WR?.ClampedRead; // guarded — shared primitive, script-order safe
            const verdictHtml = current?.text ? current.text
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\*\*([^*\n]+)\*\*/g, '<strong style="color:var(--gold);font-weight:700">$1</strong>')
                .replace(/^- (.+)$/gm, '<div style="padding-left:0.8rem;margin:0.12rem 0">• $1</div>')
                .replace(/\n\n/g, '<div style="margin:0.45rem 0"></div>')
                .replace(/\n/g, '<br>') : '';
            return (
                <div style={{ marginTop: '10px' }}>
                    {!current && (
                        <button type="button" onClick={() => requestAlexVerdict(v, dealKey)}
                            style={{ width:'100%', background:'var(--acc-fill2, rgba(212,175,55,0.08))', border:'1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius:'6px', color:'var(--gold)', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:'0.8rem', fontWeight:700, letterSpacing:'0.05em', padding:'9px 12px', minHeight:'44px' }}>
                            ✨ Ask Alex for a second opinion
                        </button>
                    )}
                    {current?.loading && <GMMessage compact>Reading the deal…</GMMessage>}
                    {current?.error && (
                        <div style={{ fontSize:'0.78rem', color:'var(--loss-red)', padding:'6px 2px' }}>
                            {current.error}{' '}
                            <button type="button" onClick={() => requestAlexVerdict(v, dealKey)} style={{ background:'none', border:'none', color:'var(--gold)', cursor:'pointer', fontSize:'0.78rem', textDecoration:'underline', padding:0 }}>Retry</button>
                        </div>
                    )}
                    {current?.text && (
                        <GMMessage title="Second Opinion">
                            {/* Clamp the read to ~4 lines with a "Full read" expand;
                                fall back to the unclamped render if the shared
                                primitive hasn't loaded (script-order safety). */}
                            {ClampedRead
                                ? <ClampedRead maxHeight={104}><div dangerouslySetInnerHTML={{ __html: verdictHtml }} /></ClampedRead>
                                : <div dangerouslySetInnerHTML={{ __html: verdictHtml }} />}
                            <div style={{ display:'flex', alignItems:'center', gap:'8px', marginTop:'8px' }}>
                                {current.feedback
                                    ? <span style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.6 }}>{current.feedback === 'up' ? 'Glad it helped.' : 'Noted — Alex learns from this.'}</span>
                                    : <>
                                        <span style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.6 }}>Useful?</span>
                                        <button type="button" onClick={() => sendVerdictFeedback('up', dealKey)} style={{ background:'none', border:'1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius:'4px', color:'var(--silver)', cursor:'pointer', fontSize:'0.78rem', padding:'2px 9px' }}>Agree</button>
                                        <button type="button" onClick={() => sendVerdictFeedback('down', dealKey)} style={{ background:'none', border:'1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius:'4px', color:'var(--silver)', cursor:'pointer', fontSize:'0.78rem', padding:'2px 9px' }}>Disagree</button>
                                    </>}
                            </div>
                        </GMMessage>
                    )}
                </div>
            );
        }

        // buildTradeSideDeps — constructs the prop bag for TcTradeSide (builder-side helper closures +
        // value fns). Lifted out of the retired analyzer surface (encapsulated, not globalized); the
        // Desk's persistent builder strip is its only consumer. Each helper only reads TradeCalcTab state.
        function buildTradeSideDeps() {
            function rosterPlayersFor(side) {
                const ownerId = tradeOwner[side]; if (!ownerId) return null;
                const roster = allRosters.find(r => r.owner_id === ownerId); if (!roster) return null;
                const playerIdSet = [...new Set([...(roster.players||[]), ...(roster.reserve||[]), ...(roster.taxi||[])])];
                const q = searchText[side].toLowerCase().trim();
                return playerIdSet.filter(id => {
                    const p = playersData[id]; if (!p || !normPos(p.position)) return false;
                    if (q.length >= 1) return `${p.first_name||''} ${p.last_name||''}`.toLowerCase().includes(q);
                    return true;
                }).map(id => { const p = playersData[id]; const v = getPlayerValue(id); return { id, name:`${p.first_name||''} ${p.last_name||''}`.trim(), pos:normPos(p.position), team:p.team||'FA', value:v.value, source:v.source }; })
                .sort((a,b) => { const pd = (TC_POS_ORDER[a.pos]??9) - (TC_POS_ORDER[b.pos]??9); return pd !== 0 ? pd : b.value - a.value; });
            }

            function addPlayer(side, pid) { if (tradeIds[side].includes(pid)) return; setTradeIds(prev => ({ ...prev, [side]: [...prev[side], pid] })); setSearchText(prev => ({ ...prev, [side]: '' })); }
            function removePlayer(side, pid) { setTradeIds(prev => ({ ...prev, [side]: prev[side].filter(id => id !== pid) })); }
            function addPick(side, pickId) { if (tradePickIds[side].includes(pickId)) return; setTradePickIds(prev => ({ ...prev, [side]: [...prev[side], pickId] })); }
            function removePick(side, pickId) { setTradePickIds(prev => ({ ...prev, [side]: prev[side].filter(id => id !== pickId) })); }
            function makePickId(year, round, fromRosterId) { return `PICK-${year}-${round}-${fromRosterId}`; }
            function pickLabel(year, round, fromRid, slot) { return formatPickLabel(year, round, fromRid, slot); }
            const ownerOptions = [{ id: null, label: '-- None --' }, ...assessments.map(a => ({ id: a.ownerId, label: `${a.ownerName} (${a.teamName})` }))];

            return { tradeIds, tradePickIds, tradeFaab, getPlayerValue, pickValueForParts, FAAB_RATE, rosterPlayersFor, tradeOwner, picksByOwner, comparePicksByDraftOrder, setTradeOwner, setSearchText, ownerOptions, playersData, MAX_VALUE, removePlayer, posColor, normPos, PICK_COLORS, ownerNameForRosterId, allRosters, removePick, pickLabel, searchText, TC_POS_ORDER, addPlayer, makePickId, addPick, setTradeFaab };
        }

        // ── Trade Log tab (Phase 5) — My Pipeline (Pro) + League Ledger (free) ──
        // Pipeline: WR_KEYS.SAVED_TRADES rows in the WrTradePipeline schema, grouped
        // into IDEA · SAVED · PROPOSED · DONE lanes; outcome logging writes grudges
        // (the DNA-learning loop). Ledger: every real league trade on the dual-shape
        // adapters (LI 'sides' + raw WrTxns), graded via the shared fairnessGrade —
        // raw history + raw grades are free per the gate ruling.

        function pipelineRowSummary(row) {
            const s = row.snapshot || {};
            const names = list => (list || []).map(a => a?.name || a?.label || (a?.pid && playersData[a.pid]?.full_name) || '').filter(Boolean);
            const sideBits = (players, picks, faab) => [
                ...names(players),
                ...(picks || []).map(p => p?.label || tradePickLabel(p)).filter(Boolean),
                ...(faab > 0 ? [`$${faab} FAAB`] : []),
            ];
            const cut = arr => arr.length ? arr.slice(0, 3).join(', ') + (arr.length > 3 ? ` +${arr.length - 3}` : '') : '—';
            return `${cut(sideBits(s.givePlayers, s.givePicks, s.giveFaab))} → ${cut(sideBits(s.receivePlayers, s.receivePicks, s.receiveFaab))}`;
        }

        // Only rows whose assets still carry builder ids (pids / pick ids) can re-open
        // in the builder — Alex-chat rows are name+value only and stay summary-only.
        function pipelineRowLoadable(row) {
            const s = row.snapshot || {};
            const players = [...(s.givePlayers || []), ...(s.receivePlayers || [])];
            const picks = [...(s.givePicks || []), ...(s.receivePicks || [])];
            return row.partnerOwnerId != null
                && (players.length > 0 || picks.length > 0)
                && players.every(p => p && (p.pid || p.id))
                && picks.every(p => p && p.id);
        }

        function renderPipelineRow(row) {
            const s = row.snapshot || {};
            const terminal = row.status === 'accepted' || row.status === 'rejected' || row.status === 'countered';
            const outcomeType = row.outcome?.grudgeType || null;
            const gt = outcomeType ? GRUDGE_TYPES[outcomeType] : null;
            const outcomeColor = !gt ? 'var(--silver)' : gt.cat === 'rejected' ? 'var(--loss-red)' : gt.cat === 'counter' ? 'var(--warn)' : 'var(--win-green)';
            // Phone: 44px touch bumps on the lane controls (status select, outcome
            // select, Load in Builder, remove X) — glyph sizes unchanged, plan D7.
            const selStyle = { padding: '3px 6px', minHeight: _vp.isPhone ? '44px' : undefined, fontSize: '0.68rem', fontFamily: 'var(--font-body)', background: 'var(--charcoal)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px', color: 'var(--silver)', cursor: 'pointer' };
            const btnStyle = { padding: '3px 8px', minHeight: _vp.isPhone ? '44px' : undefined, minWidth: _vp.isPhone ? '44px' : undefined, fontSize: '0.68rem', fontFamily: 'var(--font-body)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--silver)', cursor: 'pointer' };
            return (
                <div key={row.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '7px 10px', marginBottom: '5px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '6px' }}>
                    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
                            {s.grade && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 700, color: tcGradeColor(s.grade) }}>{s.grade}</span>}
                            <strong style={{ color: 'var(--white)', fontSize: '0.8rem', fontFamily: 'var(--font-title)' }}>{row.partnerName || 'Unknown partner'}</strong>
                            {s.likelihood != null && <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65 }}>{s.likelihood}% @ save</span>}
                            {row.source === 'alex-chat' && <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', opacity: 0.7 }}>Alex</span>}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pipelineRowSummary(row)}</div>
                    </div>
                    {terminal
                        ? <span title={row.outcome?.date ? new Date(row.outcome.date).toLocaleDateString() : undefined} style={{ fontSize: '0.68rem', fontWeight: 700, color: outcomeColor, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{gt?.label || row.status}</span>
                        : <React.Fragment>
                            <select value={row.status} onChange={e => updatePipelineRow(row.id, { status: e.target.value })} style={selStyle} title="Pipeline status">
                                <option value="idea">Idea</option>
                                <option value="saved">Saved</option>
                                <option value="proposed">Proposed</option>
                            </select>
                            <select value="" onChange={e => { if (e.target.value) logDealOutcome(row, e.target.value); }} style={selStyle} title={row.partnerOwnerId ? 'Log the real-world outcome — teaches Alex this owner’s psychology' : 'No partner identity on this row — outcome updates status only'}>
                                <option value="">Log outcome…</option>
                                {Object.keys(GRUDGE_TYPES).map(k => <option key={k} value={k}>{GRUDGE_TYPES[k].label}</option>)}
                            </select>
                        </React.Fragment>}
                    {pipelineRowLoadable(row) && <button style={btnStyle} onClick={() => loadDealIntoBuilder({ ...row.snapshot, id: row.id, partnerOwnerId: row.partnerOwnerId })}>Load in Builder</button>}
                    <button style={{ ...btnStyle, color: 'rgba(231,76,60,0.75)' }} onClick={() => removeSavedDeal(row.id)} title="Remove from pipeline">X</button>
                </div>
            );
        }

        function renderTradePipeline(_pro) {
            let body;
            if (!_pro) {
                body = React.createElement(TcProTeaser, { label: 'Trade Pipeline', feature: 'trade-pipeline', sub: 'Track every deal from idea to proposed to done — logged outcomes teach Alex each owner\'s real trading psychology and sharpen future acceptance odds.' });
            } else if (!savedDeals.length) {
                body = <div className="tc-dhq-empty">No tracked deals yet — Save a finder row or an Alex trade card and it lands here.</div>;
            } else {
                const lanes = [
                    { key: 'idea', label: 'Idea', match: r => r.status === 'idea' },
                    { key: 'saved', label: 'Saved', match: r => r.status === 'saved' },
                    { key: 'proposed', label: 'Proposed', match: r => r.status === 'proposed' },
                    { key: 'done', label: 'Done', match: r => r.status === 'accepted' || r.status === 'rejected' || r.status === 'countered' },
                ];
                body = lanes.map(lane => {
                    const rows = savedDeals.filter(r => r && r.snapshot && lane.match(r));
                    if (!rows.length) return null;
                    return (
                        <div key={lane.key} style={{ marginBottom: '10px' }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--silver)', opacity: 0.7, margin: '0 0 4px' }}>{lane.label} · {rows.length}</div>
                            {rows.map(renderPipelineRow)}
                        </div>
                    );
                });
            }
            return (
                <section className="tc-dhq-panel" style={{ marginBottom: '12px' }}>
                    <div className="tc-dhq-panel-head">
                        <span>My Pipeline</span>
                        <em>{savedDeals.length ? `${savedDeals.length} tracked deal${savedDeals.length === 1 ? '' : 's'} — logged outcomes sharpen acceptance odds` : 'Saved and proposed deals live here'}</em>
                    </div>
                    {body}
                </section>
            );
        }

        function renderTradeLedger() {
            const liTrades = window.App?.LI?.tradeHistory || [];
            const usingRaw = !liTrades.length;
            const sourceTrades = usingRaw ? (ledgerRawTrades || []) : liTrades;
            const fg = window.App?.TradeEngine?.fairnessGrade || null;
            const pn = pid => playersData[pid]?.full_name || pid;
            const rows = sourceTrades.map((trade, idx) => {
                const rids = tradeRosterIds(trade);
                const sides = rids.map(rid => {
                    const assets = tradeSideReceivedAssets(trade, rid);
                    return { rid, assets, value: tradeAssetsValue(assets) };
                });
                // Fairness graded from the winning side via the shared ratio bands
                // (gave less, got more): B = fair, A+ = steal. fairnessGrade's zero
                // case returns '--' — the old empty-sides A+ bug is dead. 3-team
                // trades get no pairwise grade.
                let grade = null, winnerRid = null, pctDiff = null;
                if (sides.length === 2 && fg) {
                    const [a, b] = sides;
                    const hi = a.value >= b.value ? a : b;
                    const lo = hi === a ? b : a;
                    grade = fg(lo.value, hi.value);
                    if (grade.grade !== '--') pctDiff = Math.round(Math.abs(a.value - b.value) / Math.max(a.value, b.value, 1) * 100);
                    if (grade.grade !== 'B' && grade.grade !== '--' && hi.value !== lo.value) winnerRid = hi.rid;
                }
                const ts = tradeTimestampMs(trade);
                const when = trade.season
                    ? 'S' + trade.season + (trade.week ? ' W' + trade.week : '')
                    : ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
                    : trade.leg ? 'W' + trade.leg : '';
                return { key: String(trade.transaction_id || trade.id || 't' + idx) + ':' + idx, trade, rids, sides, grade, winnerRid, pctDiff, when };
            });
            const filtered = ledgerTeamFilter === 'all' ? rows : rows.filter(r => r.rids.some(rid => String(rid) === String(ledgerTeamFilter)));
            const visible = filtered.slice(0, ledgerShown);
            const loading = usingRaw && (ledgerSyncing || ledgerRawTrades === null) && !window.App?.LI_LOADED;
            const sideCol = (side) => (
                <div key={'side' + side.rid}>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontWeight: 700, marginBottom: '2px' }}>{ownerNameForRosterId(side.rid) || 'Team ' + side.rid} ({side.value.toLocaleString()})</div>
                    {(side.assets.players || []).map(pid => <div key={pid} style={{ fontSize: '0.72rem', color: 'var(--white)', lineHeight: 1.4 }}>{pn(pid)}</div>)}
                    {(side.assets.picks || []).map((pk, i) => <div key={'pk' + i} style={{ fontSize: '0.72rem', color: 'var(--gold)' }}>{tradePickLabel(pk)}</div>)}
                    {side.assets.faab > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--info, #5dade2)' }}>${side.assets.faab} FAAB</div>}
                    {!(side.assets.players || []).length && !(side.assets.picks || []).length && !(side.assets.faab > 0) && <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.5 }}>No assets listed</div>}
                </div>
            );
            return (
                <section className="tc-dhq-panel">
                    <div className="tc-dhq-panel-head">
                        <span>League Ledger</span>
                        <em>{filtered.length ? `${filtered.length} trade${filtered.length === 1 ? '' : 's'} · DHQ values + fairness grades` : 'Every completed league trade'}</em>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 10px', gap: '8px', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '0.74rem', color: 'var(--silver)', opacity: 0.65, lineHeight: 1.5 }}>
                            {usingRaw ? 'Raw league trades (Sleeper) valued with DHQ.' : 'League history analyzed with DHQ values.'}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <select value={ledgerTeamFilter} onChange={e => { setLedgerTeamFilter(e.target.value); setLedgerShown(20); }} style={{ padding: '4px 8px', minHeight: _vp.isPhone ? '44px' : undefined, fontSize: '0.74rem', fontFamily: 'var(--font-body)', background: 'var(--charcoal)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '4px', color: 'var(--silver)', cursor: 'pointer' }}>
                                <option value="all">All Teams</option>
                                {allRosters.map(r => <option key={r.roster_id} value={r.roster_id}>{ownerNameForRosterId(r.roster_id) || 'Team ' + r.roster_id}</option>)}
                            </select>
                            {usingRaw && <button onClick={() => refreshLedger(true)} disabled={ledgerSyncing} style={{ padding: '4px 10px', minHeight: _vp.isPhone ? '44px' : undefined, fontSize: '0.72rem', fontFamily: 'var(--font-body)', background: 'var(--acc-fill2, rgba(212,175,55,0.12))', color: 'var(--gold)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: '4px', cursor: ledgerSyncing ? 'default' : 'pointer', opacity: ledgerSyncing ? 0.6 : 1 }}>{ledgerSyncing ? 'Refreshing…' : 'Refresh'}</button>}
                        </div>
                    </div>
                    {loading ? (
                        <div style={{ color: 'var(--silver)', textAlign: 'center', padding: '2rem', opacity: 0.65 }}>
                            <div className="ld"><span>.</span><span>.</span><span>.</span></div>
                            <div style={{ marginTop: '8px' }}>Loading league trade history...</div>
                        </div>
                    ) : visible.length === 0 ? (
                        <div style={{ color: 'var(--silver)', textAlign: 'center', padding: '2rem', opacity: 0.65 }}>
                            {ledgerTeamFilter === 'all' ? 'No trades found in league history.' : 'No trades for this team yet.'}
                        </div>
                    ) : <div className="tc-inbox-grid">
                        {visible.map(r => (
                            <div key={r.key} style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', borderRadius: 'var(--card-radius)', padding: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        {r.grade && <span title={'Fairness graded from the winning side (shared DHQ ratio bands): B = fair, A+ = steal. Variance = % difference between sides.'} style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 600, color: r.grade.color || 'var(--silver)', cursor: 'help' }}>{r.grade.grade}</span>}
                                        {r.pctDiff != null && <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65 }}>{r.pctDiff}%</span>}
                                        {r.winnerRid != null && <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--win-green)', fontWeight: 700 }}>{ownerNameForRosterId(r.winnerRid) || 'Team ' + r.winnerRid}</span>}
                                    </div>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.5 }}>{r.when}</span>
                                </div>
                                {r.sides.length === 2
                                    ? <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '4px', alignItems: 'start' }}>
                                        {sideCol(r.sides[0])}
                                        <div style={{ fontSize: '0.82rem', color: 'var(--gold)', alignSelf: 'center', fontWeight: 700 }}>&#8644;</div>
                                        {sideCol(r.sides[1])}
                                    </div>
                                    : <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(r.sides.length, 1)}, 1fr)`, gap: '4px', alignItems: 'start' }}>
                                        {r.sides.map(sideCol)}
                                    </div>}
                            </div>
                        ))}
                    </div>}
                    {filtered.length > visible.length && <button className="tc-dhq-show-more" onClick={() => setLedgerShown(n => n + 20)}>Show {Math.min(20, filtered.length - visible.length)} more</button>}
                </section>
            );
        }

        function renderTradeLog() {
            const _pro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
            return (
                <div>
                    {renderTradePipeline(_pro)}
                    {renderTradeLedger()}
                </div>
            );
        }

        // ══ PHONE (<768) — Trade Center phone branch (iPhone program Phase 2).
        // Rendered by the early return above the desktop `renderAdaptiveWorkspace()`
        // call, so the desktop/tablet workspace (tc-tab-row, finder panel, the
        // builder panel and the League Teams context rail) NEVER mounts on phone
        // and stays byte-identical. Free/Pro: zero gate movement — the finder
        // region, Owner DNA content and My Pipeline stay Pro behind the SAME
        // TcProTeaser copy as desktop; the manual builder, TcVerdictPanel (its
        // internal free/Pro split unchanged) and the League Ledger stay free.
        function renderPhoneWorkspace() {
            const HeroCard = window.WR.HeroCard, AssetRow = window.WR.AssetRow, CardList = window.WR.CardList,
                FilterPill = window.WR.FilterPill,
                Sheet = window.WR.Sheet, ActionBar = window.WR.ActionBar;
            const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
            const MICRO = 'var(--text-micro, 0.6875rem)';
            const _pro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
            const active = tcTab; // canonical: 'desk' | 'dna' | 'log' (same setTcTab seam)
            const _verdict = computeManualVerdict();
            const _tsDeps = buildTradeSideDeps();

            // ── Micro-UI helpers (house style: lineup.js / my-team.js pilots) ──
            const chip = (text, color) => (
                <span style={{ fontFamily: MONO, fontSize: MICRO, fontWeight: 700, padding: '3px 8px', borderRadius: '5px', border: '1px solid ' + color, color, whiteSpace: 'nowrap' }}>{text}</span>
            );
            const kpiTile = (label, value, sub, valColor) => (
                <div key={label} style={{ background: 'var(--black, #121217)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '9px', padding: '9px 11px' }}>
                    <div style={{ fontFamily: MONO, fontSize: MICRO, color: 'var(--text-muted, #8B8B96)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                    <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.3rem', fontWeight: 700, color: valColor || 'var(--white)', lineHeight: 1.15, marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
                    {sub ? <div style={{ fontFamily: MONO, fontSize: MICRO, color: 'var(--silver)', opacity: 0.65, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '110px' }}>{sub}</div> : null}
                </div>
            );
            const actBtn = (goldOn) => ({ padding: '9px 14px', minHeight: '44px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer', borderRadius: '5px', fontFamily: 'var(--font-body)', border: '1px solid ' + (goldOn ? 'var(--acc-line2, rgba(212,175,55,0.4))' : 'rgba(255,255,255,0.14)'), background: goldOn ? 'rgba(212,175,55,0.12)' : 'transparent', color: goldOn ? 'var(--gold)' : 'var(--silver)' });
            const goldDiv = (label, sub) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                    <span style={{ fontFamily: MONO, fontSize: MICRO, fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</span>
                    {sub ? <span style={{ fontFamily: MONO, fontSize: MICRO, color: 'var(--silver)', opacity: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{sub}</span> : null}
                    <span aria-hidden="true" style={{ flex: 1, height: '1px', background: 'rgba(212,175,55,0.25)' }} />
                </div>
            );

            // ── Finder-control seams — the EXACT same state setters as the desktop
            // finder panel (renderDealHQ's selectFinderFocus / clearFinderFocus /
            // setPartnerFacet), re-declared here because those closures live inside
            // renderDealHQ, which stays untouched for tablet/desktop.
            const finderIntents = [
                { key: 'best', label: 'Best Moves' },
                { key: 'help', label: 'Get Help' },
                { key: 'shop', label: 'Shop Target' },
                { key: 'picks', label: 'Picks' },
            ];
            const intentLabel = (finderIntents.find(i => i.key === finderQuery.intent) || finderIntents[0]).label;
            const assetBrowserSorts = [
                { key: 'dhq', label: 'DHQ' },
                { key: 'age', label: 'Age' },
                { key: 'owner', label: 'Owned Team' },
                { key: 'points', label: 'Last FP' },
                { key: 'prime', label: 'Prime Years' },
            ];
            const sortLabel = (assetBrowserSorts.find(s => s.key === assetBrowserSort) || assetBrowserSorts[0]).label;
            const pinnedPartnerName = effPartnerId != null
                ? ((assessments.find(a => String(a.ownerId) === String(effPartnerId)) || {}).ownerName || 'Pinned')
                : 'Auto';
            function phSelectFocus(item) {
                if (!item) return;
                setFinderQuery(qr => item.kind === 'owner'
                    ? { ...qr, focus: { kind: 'owner', id: item.ownerId, label: item.label }, partnerFilter: item.ownerId }
                    : { ...qr, focus: { kind: item.kind, id: item.id, label: item.label, pos: item.pos || null, ownerId: item.ownerId, rosterId: item.rosterId } });
                setFinderSearch('');
                setShowAllDeals(false);
                setPhFinderPanel(null);
            }
            function phClearFocus() {
                // An owner focus and its partnerFilter were set together — clear both.
                setFinderQuery(qr => ({ ...qr, focus: null, partnerFilter: qr.focus?.kind === 'owner' ? null : qr.partnerFilter }));
                setShowAllDeals(false);
            }
            function phSetPartner(ownerId) {
                // Same precedence guard as the desktop setPartnerFacet: a focus that
                // pins a DIFFERENT owner would override the facet — drop it.
                const pinsOtherOwner = focusR && (
                    focusR.kind === 'owner'
                    || (focusR.ownerId != null && String(focusR.rosterId) !== String(myRosterId) && (ownerId == null || String(focusR.ownerId) !== String(ownerId)))
                );
                setFinderQuery(qr => ({ ...qr, partnerFilter: ownerId, focus: pinsOtherOwner ? null : qr.focus }));
                setShowAllDeals(false);
            }
            const phRosterLabel = roster => {
                const assessment = assessments.find(a => String(a.rosterId) === String(roster?.roster_id));
                return assessment?.teamName || ownerNameForRosterId(roster?.roster_id) || `Team ${roster?.roster_id || '?'}`;
            };

            // ── Focus typeahead (sheet-inline list, not a dropdown) — same sources
            // and caps as the desktop typeahead: owners, my/league players, picks.
            const phTypeQ = phFinderPanel === 'partner' ? finderSearch.trim().toLowerCase() : '';
            const phTypeGroups = [];
            if (phTypeQ.length >= 2) {
                const matches = s => String(s || '').toLowerCase().includes(phTypeQ);
                const ownerRows = assessments
                    .filter(a => String(a.rosterId) !== String(myRosterId) && (matches(a.ownerName) || matches(a.teamName)))
                    .slice(0, 3)
                    .map(a => ({ kind: 'owner', key: `own-${a.ownerId}`, id: a.ownerId, label: a.ownerName || a.teamName || `Team ${a.rosterId}`, sub: a.teamName || 'League owner', value: null, ownerId: a.ownerId, rosterId: a.rosterId }));
                const myPlayerRows = [];
                const leaguePlayerRows = [];
                for (const roster of allRosters) {
                    const mine = String(roster.roster_id) === String(myRosterId);
                    for (const asset of assetsForRoster(roster)) {
                        if (!matches(asset.name)) continue;
                        (mine ? myPlayerRows : leaguePlayerRows).push({
                            kind: 'player', key: `pl-${roster.roster_id}-${asset.pid}`, id: asset.pid,
                            label: asset.name, pos: asset.pos,
                            sub: `${asset.pos} ${asset.team} · ${mine ? 'your roster' : phRosterLabel(roster)}`,
                            value: asset.value, ownerId: roster.owner_id, rosterId: roster.roster_id,
                        });
                    }
                }
                myPlayerRows.sort((a, b) => b.value - a.value);
                leaguePlayerRows.sort((a, b) => b.value - a.value);
                const ordinal = r => ['', '1st', '2nd', '3rd'][r] || `${r}th`;
                const pickRows = [];
                for (const a of assessments) {
                    const mine = String(a.rosterId) === String(myRosterId);
                    for (const pk of pickAssetsForOwner(a.ownerId)) {
                        const haystack = `${pk.label} ${pk.year} round ${pk.round} ${ordinal(pk.round)} ${pk.via || ''} ${a.ownerName || ''} pick`;
                        if (!matches(haystack)) continue;
                        pickRows.push({ kind: 'pick', key: `pk-${a.rosterId}-${pk.id}`, id: pk.id, label: pk.label, sub: `${mine ? 'your pick' : a.ownerName}${pk.via ? ` · via ${pk.via}` : ''}`, value: pk.value, ownerId: a.ownerId, rosterId: a.rosterId });
                    }
                }
                pickRows.sort((a, b) => b.value - a.value);
                if (ownerRows.length) phTypeGroups.push({ label: 'Owners', rows: ownerRows });
                if (myPlayerRows.length) phTypeGroups.push({ label: 'My players', rows: myPlayerRows.slice(0, 5) });
                if (leaguePlayerRows.length) phTypeGroups.push({ label: 'League players', rows: leaguePlayerRows.slice(0, 6) });
                if (pickRows.length) phTypeGroups.push({ label: 'Picks', rows: pickRows.slice(0, 5) });
            }

            // ── Asset browser (the min-width desktop grid — the single worst phone
            // surface) re-poured as WR.AssetRows. Pro-only, exactly like the
            // desktop finder region; same row source, filters and sorts.
            const browsingMyRoster = effMode === 'shop' || effMode === 'sellSurplus' || effMode === 'picks';
            // Partner pinned + Intent=Add → browse ONLY that partner's roster;
            // no pin keeps the full league board.
            const phBrowserRosters = browsingMyRoster
                ? allRosters.filter(r => String(r.roster_id) === String(myRosterId))
                : allRosters.filter(r => String(r.roster_id) !== String(myRosterId)
                    && (effPartnerId == null || String(r.owner_id) === String(effPartnerId)));
            const phAssetRowsAll = (_pro && active === 'desk' && rosterState.isUsable) ? phBrowserRosters.flatMap(roster => assetsForRoster(roster)
                .filter(p => !browsingMyRoster || !isUntouchableAsset(p, finderTuning))
                .map(asset => {
                    const player = playersData[asset.pid] || {};
                    const age = playerAge(player) || asset.age || null;
                    const lastPoints = Math.round(calcSeasonPts(asset.pid, currentLeague.scoring_settings) || 0);
                    return { ...asset, age, lastPoints, primeYears: primeYearsRemaining(asset.pos, age), ownerId: roster.owner_id, rosterId: roster.roster_id, ownerLabel: phRosterLabel(roster) };
                })) : [];
            // League-derived flex groups (FLEX / SFLEX / IDP FLEX…) join the
            // plain positions as filter chips; the posMatchesFilter twin expands
            // a group key to its position set. Optional-chained — degrades to
            // plain positions until the window.App helpers land.
            const phFlexGroups = (window.App?.getLeagueFlexGroups?.({ league: currentLeague }) || [])
                .filter(g => (window.App?.FLEX_GROUP_POSITIONS?.[g] || []).some(pos => phAssetRowsAll.some(row => row.pos === pos)));
            const phBrowserPositions = ['ALL', ...Object.keys(TC_POS_ORDER).filter(pos => phAssetRowsAll.some(row => row.pos === pos)), ...phFlexGroups];
            const _phPosMatch = window.App?.posMatchesFilter || ((pos, f) => !f || f === 'ALL' || pos === f);
            const phSortedAssets = phAssetRowsAll
                .filter(row => _phPosMatch(row.pos, assetBrowserPos))
                .filter(row => !assetBrowserRookieOnly || !!tcRookieInfoFor(row.pid))
                .sort((a, b) => {
                    if (assetBrowserSort === 'age') return (a.age || 99) - (b.age || 99) || b.value - a.value;
                    if (assetBrowserSort === 'owner') return a.ownerLabel.localeCompare(b.ownerLabel) || b.value - a.value;
                    if (assetBrowserSort === 'points') return b.lastPoints - a.lastPoints || b.value - a.value;
                    if (assetBrowserSort === 'prime') return (b.primeYears || 0) - (a.primeYears || 0) || b.value - a.value;
                    return b.value - a.value;
                });
            const phVisibleAssets = phSortedAssets.slice(0, assetBrowserOpen ? 28 : 8);
            // ── Picks board — when Intent=Picks the Add-assets board lists DRAFT
            // PICKS instead of players, with an Owned/League scope toggle.
            // Owned = your picks (→ YOU SEND); League = every other owner's
            // picks (→ YOU GET).
            const phPicksMode = effMode === 'picks';
            const phPicksScopeMine = phPicksScope === 'owned';
            // Drafted-pick exclusion = the component-scope pickUndrafted.
            const phPickRowsAll = (_pro && active === 'desk' && rosterState.isUsable && phPicksMode)
                ? assessments
                    .filter(a => phPicksScopeMine ? String(a.rosterId) === String(myRosterId) : String(a.rosterId) !== String(myRosterId))
                    .flatMap(a => pickAssetsForOwner(a.ownerId).map(pk => ({ ...pk, ownerId: a.ownerId, rosterId: a.rosterId, ownerName: a.ownerName || a.teamName || ('Team ' + a.rosterId) })))
                    .filter(pickUndrafted)
                    // Draft order: year, then all rounds within that year, then slot —
                    // not value-ranked, so 2027 1st→2nd→3rd… then 2028.
                    .sort(comparePicksByDraftOrder)
                : [];
            const phVisiblePicks = phPickRowsAll.slice(0, assetBrowserOpen ? 40 : 12);
            // Gold "+" add affordance → the component-scope addAssetToBuilder
            // (builder-add + side-B owner-select semantics).
            const phPlusChip = (row) => (
                <button type="button" aria-label={'Add ' + row.name + ' to the builder'}
                    onClick={e => { e.stopPropagation(); addAssetToBuilder(row); }}
                    style={{ width: '34px', height: '34px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '7px', border: '1px solid var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.10)', color: 'var(--gold)', fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer', fontFamily: MONO, lineHeight: 1, padding: 0 }}>+</button>
            );
            const phAssetRow = (row) => {
                const rf = tcRookieInfoFor(row.pid);
                const rookieBits = rf ? [rf.college, rf.draftSlot || (rf.isUDFA ? 'UDFA' : ''), rf.tierLabel].filter(Boolean) : [];
                return (
                    <AssetRow key={`${row.rosterId}-${row.pid}`} pos={row.pos} name={row.name}
                        tag={row.ownerLabel + (rookieBits.length ? ' · ' + rookieBits.join(' · ') : '')}
                        slots={[{ label: 'DHQ', value: row.value.toLocaleString() }, { label: 'AGE', value: row.age || '—', tone: 'mute' }]}
                        verdict={phPlusChip(row)}
                        accent={focusPlayerPid != null && String(focusPlayerPid) === String(row.pid) ? 'gold' : undefined}
                        onClick={() => {
                            // Row tap = focus the finder on this asset (desktop selectAssetFocus).
                            setFinderQuery(qr => ({ ...qr, focus: { kind: 'player', id: row.pid, label: row.name, pos: row.pos, ownerId: row.ownerId, rosterId: row.rosterId } }));
                            setShowAllDeals(false);
                        }} />
                );
            };

            // Pick "+" → the component-scope addPickRowToBuilder.
            const phPickPlusChip = (row) => (
                <button type="button" aria-label={'Add ' + row.label + ' to the builder'}
                    onClick={e => { e.stopPropagation(); addPickRowToBuilder(row); }}
                    style={{ width: '34px', height: '34px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '7px', border: '1px solid var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.10)', color: 'var(--gold)', fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer', fontFamily: MONO, lineHeight: 1, padding: 0 }}>+</button>
            );
            const phPickRow = (row) => (
                <AssetRow key={`${row.rosterId}-${row.id}`} pos="PK" name={row.label}
                    tag={(phPicksScopeMine ? 'Your pick' : row.ownerName) + (row.via && row.via !== row.ownerName ? ' · via ' + row.via : '')}
                    slots={[{ label: 'DHQ', value: row.value.toLocaleString(), strong: true }]}
                    verdict={phPickPlusChip(row)}
                    accent={finderQuery.focus && finderQuery.focus.kind === 'pick' && String(finderQuery.focus.id) === String(row.id) ? 'gold' : undefined}
                    onClick={() => {
                        setFinderQuery(qr => ({ ...qr, focus: { kind: 'pick', id: row.id, label: row.label, ownerId: row.ownerId, rosterId: row.rosterId } }));
                        setShowAllDeals(false);
                    }} />
            );

            // ── Finder deal cards — TcDealCard re-poured for phone: send/receive
            // as the approved two-column card, decision chips, same Load/Save/Why
            // handlers (loadDealIntoBuilder / saveDeal / expandedDealId).
            const phAssetLine = (asset) => {
                const isPick = asset.type === 'pick';
                return (
                    <div key={isPick ? asset.id : (asset.pid || asset.id)} style={{ marginTop: '6px', minWidth: 0 }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isPick ? asset.label : asset.name}</div>
                        <div style={{ fontFamily: MONO, fontSize: MICRO, color: 'var(--text-muted, #8B8B96)' }}>{isPick ? 'PICK' : asset.pos} · {asset.value.toLocaleString()}</div>
                    </div>
                );
            };
            const phDealSide = (label, players, picks, faab, total) => (
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: MONO, fontSize: MICRO, fontWeight: 600, color: 'var(--silver)', opacity: 0.65, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label} · {total.toLocaleString()}</div>
                    {(players || []).map(phAssetLine)}
                    {(picks || []).map(phAssetLine)}
                    {faab > 0 ? (
                        <div style={{ marginTop: '6px' }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--win-green, #2ecc71)' }}>${faab} FAAB</div>
                        </div>
                    ) : null}
                </div>
            );
            const phDealCard = (deal, idx) => {
                const likeColor = deal.likelihood >= finderActionFloor ? 'var(--good)' : deal.likelihood >= Math.max(55, finderActionFloor - 15) ? 'var(--warn)' : 'var(--bad)';
                const deltaColor = deal.userGain >= 0 ? 'var(--good)' : 'var(--bad)';
                const expanded = expandedDealId === deal.id;
                return (
                    <div key={deal.id} style={{ background: 'var(--black, #121217)', border: '1px solid ' + (idx === 0 ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.07)'), borderRadius: '9px', padding: '11px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--white)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto' }}>{deal.partnerName}</strong>
                            {chip(deal.grade, deal.gradeColor || 'var(--gold)')}
                            {chip(deal.likelihood + '%', likeColor)}
                            {chip((deal.userGain >= 0 ? '+' : '') + Math.round(deal.userGain).toLocaleString(), deltaColor)}
                        </div>
                        <div style={{ display: 'flex', marginTop: '9px' }}>
                            <div style={{ flex: 1, minWidth: 0, paddingRight: '11px' }}>{phDealSide('You get', deal.receivePlayers, deal.receivePicks, deal.receiveFaab, deal.totals.receive.total)}</div>
                            <div style={{ flex: 1, minWidth: 0, paddingLeft: '11px', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>{phDealSide('You send', deal.givePlayers, deal.givePicks, deal.giveFaab, deal.totals.give.total)}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
                            <button type="button" style={actBtn(true)} onClick={() => { loadDealIntoBuilder(deal); setPhBuilderOpen(true); }}>Load in Builder</button>
                            <button type="button" style={actBtn(false)} onClick={() => saveDeal(deal)}>Save</button>
                            <button type="button" style={{ ...actBtn(false), marginLeft: 'auto', border: 'none' }} onClick={() => setExpandedDealId(expanded ? null : deal.id)}>{expanded ? 'Why ▴' : 'Why ▾'}</button>
                        </div>
                        {expanded && (
                            <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <div style={{ fontSize: '0.74rem', color: 'var(--silver)', lineHeight: 1.5 }}><b style={{ color: 'var(--white)' }}>Accept:</b> {deal.whyAccept}</div>
                                <div style={{ fontSize: '0.74rem', color: 'var(--silver)', lineHeight: 1.5 }}><b style={{ color: 'var(--white)' }}>You:</b> {deal.whyYou}</div>
                                <div style={{ fontSize: '0.74rem', color: 'var(--silver)', lineHeight: 1.5 }}><b style={{ color: 'var(--white)' }}>Swing:</b> {deal.swing}</div>
                                {(deal.caution || []).length > 0 && <div style={{ fontSize: MICRO, color: 'var(--warn)', fontFamily: MONO }}>{deal.caution.slice(0, 3).join(' · ')}</div>}
                            </div>
                        )}
                    </div>
                );
            };

            // ── Hero — the live deal answered as a decision. Renders ONLY for a
            // live deal you're actively building; the finder leads with its own
            // rows otherwise. Tier split mirrors TcVerdictPanel: grade/label/diff/
            // side totals free, accept-odds Pro.
            const liveDealPartner = _verdict.hasTrade && tradeOwner.B ? (assessments.find(a => a.ownerId === tradeOwner.B) || null) : null;
            let heroEl = null;
            if (_verdict.hasTrade) {
                heroEl = (
                    <HeroCard kicker={liveDealPartner ? 'Live deal · vs ' + liveDealPartner.ownerName : 'Live deal'}
                        headline={_verdict.verdictText + ' · ' + _verdict.diffDisplay}
                        facts={'gave ' + _verdict.totalA.toLocaleString() + ' / received ' + _verdict.totalB.toLocaleString() + (_pro ? ' · accept ' + _verdict.likelihood + '%' : '')}
                        cta="BUILDER" onCta={() => setPhBuilderOpen(true)} />
                );
            }

            // ── DNA-mini — the rail's second card re-homed inline at the bottom of
            // the desk (and under the log). Same partner precedence and the same
            // free-tier teaser as the desktop rail.
            const railBoard = _pro ? partnerBoard : [];
            const liveDealOwnerId = _verdict.hasTrade ? tradeOwner.B : null;
            const railItem = (liveDealOwnerId != null && railBoard.find(p => String(p.assessment.ownerId) === String(liveDealOwnerId)))
                || railBoard.find(p => String(p.assessment.ownerId) === String(effPartnerId))
                || railBoard[0] || null;
            const dnaPartner = railItem?.assessment || null;
            let dnaMiniBody;
            if (!_pro) {
                dnaMiniBody = React.createElement(TcProTeaser, { label: 'Owner DNA', feature: 'owner-dna', sub: 'Profile every manager\'s trading psychology — posture, behavior reads, and exactly how to approach each negotiation.' });
            } else if (!dnaPartner) {
                dnaMiniBody = <div className="tc-dhq-empty">No partner in scope yet — pin one in the finder controls.</div>;
            } else {
                const needsLine = (dnaPartner.needs || []).slice(0, 4).map(n => n.pos).join(' · ');
                dnaMiniBody = (
                    <React.Fragment>
                        <div className="tc-dhq-dossier-card">
                            <h3>{dnaPartner.ownerName}</h3>
                            <div className="tc-dhq-chipline">
                                <span style={{ color: railItem.posture.color }}>{railItem.posture.label}</span>
                                {railItem.dnaKey !== 'NONE' && <span style={{ color: railItem.dna.color }}>{railItem.dna.label}</span>}
                                <span>{railItem.compat}% fit</span>
                            </div>
                            <p>{needsLine ? `Needs ${needsLine}. ` : 'No urgent roster hole. '}{railItem.behaviorProfile?.strategy?.offerFrame || railItem.dna?.strategy || railItem.posture.desc}</p>
                        </div>
                        <button type="button" className="tc-rail-dna-link" onClick={() => { setExpandedDnaOwner(dnaPartner.rosterId); setTcTab('dna'); }}>Full profile ▸</button>
                    </React.Fragment>
                );
            }
            const dnaMiniEl = (
                <div className="tc-dhq-panel">
                    <div className="tc-dhq-panel-head">
                        <span>Owner DNA</span>
                        <em>{dnaPartner ? dnaPartner.ownerName : 'No partner selected'}</em>
                    </div>
                    <div className="tc-dhq-panel-body tc-dhq-dossier-body" style={{ flex: '0 0 auto', minHeight: 'auto', overflow: 'visible', paddingRight: 0 }}>{dnaMiniBody}</div>
                </div>
            );

            // ── Inline finder-control choosers (no modal window) — each top pill
            // toggles its own inline chooser rendered right under the pill row;
            // tap a value and it applies immediately + closes.
            const finderPanelWrap = body => (
                <div style={{ background: 'var(--black, #121217)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', borderRadius: '8px', padding: '10px 11px' }}>{body}</div>
            );
            let finderPanelEl = null;
            if (_pro && rosterState.isUsable && phFinderPanel === 'intent') {
                finderPanelEl = finderPanelWrap(
                    <div className="wr-seg">
                        {finderIntents.map(i => (
                            <button key={i.key} type="button" className={finderQuery.intent === i.key ? 'is-on' : ''}
                                onClick={() => { setFinderQuery(qr => ({ ...qr, intent: i.key })); setAssetBrowserPos('ALL'); setShowAllDeals(false); setPhFinderPanel(null); }}>{i.label}</button>
                        ))}
                    </div>
                );
            } else if (_pro && rosterState.isUsable && phFinderPanel === 'partner') {
                // Full scrollable partner list (ALL partners, not a capped chip
                // set). Ranked by board score; tap a row to pin, tap the pinned
                // row again to clear back to Auto.
                const partnerRow = on => ({ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)', background: on ? 'rgba(212,175,55,0.12)' : 'transparent', textAlign: 'left', padding: '7px 10px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.8rem' });
                finderPanelEl = finderPanelWrap(
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ maxHeight: '42vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '6px' }}>
                            <button type="button" style={partnerRow(effPartnerId == null)} onClick={() => { phSetPartner(null); setPhFinderPanel(null); }}>
                                <strong style={{ color: effPartnerId == null ? 'var(--gold)' : 'var(--white)', fontWeight: 600 }}>Auto</strong>
                                <span style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.65, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Best partner picked for you</span>
                            </button>
                            {partnerBoard.map(item => {
                                const a = item.assessment;
                                const on = effPartnerId != null && String(a.ownerId) === String(effPartnerId);
                                return (
                                    <button key={a.rosterId} type="button" style={partnerRow(on)} onClick={() => { phSetPartner(on ? null : a.ownerId); setPhFinderPanel(null); }}>
                                        <strong style={{ color: on ? 'var(--gold)' : 'var(--white)', fontWeight: 600, minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.ownerName}</strong>
                                        {item.posture && <span style={{ fontSize: '0.58rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: item.posture.color, whiteSpace: 'nowrap' }}>{item.posture.label}</span>}
                                        <span style={{ fontFamily: MONO, fontSize: '0.72rem', color: 'var(--silver)' }}>{item.score}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div>
                            <div style={{ fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--silver)', opacity: 0.6, marginBottom: '5px' }}>Or target a player / pick</div>
                            {focusR && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', border: '1px solid rgba(212,175,55,0.35)', borderRadius: '5px', background: 'rgba(212,175,55,0.08)', padding: '6px 9px', fontSize: '0.76rem', color: 'var(--white)', minWidth: 0 }}>
                                        <em style={{ fontStyle: 'normal', fontSize: '0.6rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)' }}>{focusR.kind === 'pick' ? 'Pick' : focusR.kind === 'owner' ? 'Owner' : (focusR.pos || 'Player')}</em>
                                        <strong style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{focusR.label}</strong>
                                    </span>
                                    <button type="button" onClick={phClearFocus} aria-label="Clear focus" style={{ ...actBtn(false), padding: '6px 12px' }}>✕ Clear</button>
                                </div>
                            )}
                            <input type="text" value={finderSearch}
                                onChange={e => setFinderSearch(e.target.value)}
                                placeholder="Search players, picks, owners"
                                aria-label="Finder focus search"
                                style={{ width: '100%', minHeight: '44px', border: '1px solid rgba(212,175,55,0.22)', borderRadius: '5px', background: 'rgba(255,255,255,0.045)', color: 'var(--white)', fontFamily: 'var(--font-body)', fontSize: '16px', padding: '8px 10px' }} />
                            {phTypeGroups.map(group => (
                                <div key={group.label}>
                                    <div style={{ padding: '8px 2px 3px', fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--silver)', opacity: 0.6 }}>{group.label}</div>
                                    {group.rows.map(row => (
                                        <button key={row.key} type="button" onClick={() => phSelectFocus(row)}
                                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'transparent', color: 'var(--silver)', textAlign: 'left', padding: '7px 2px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.78rem' }}>
                                            <strong style={{ color: 'var(--white)', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.label}</strong>
                                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.68rem', opacity: 0.7 }}>{row.sub}</span>
                                            {row.value != null && <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: '0.72rem' }}>{row.value.toLocaleString()}</span>}
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                );
            } else if (_pro && rosterState.isUsable && phFinderPanel === 'pos') {
                finderPanelEl = finderPanelWrap(
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {phBrowserPositions.map(pos => {
                                const on = assetBrowserPos === pos;
                                return <button key={pos} type="button" style={actBtn(on)} onClick={() => { setAssetBrowserPos(pos); setPhFinderPanel(null); }}>{pos === 'ALL' ? 'All pos' : pos}</button>;
                            })}
                        </div>
                        {tcRookieFields && <button type="button" style={actBtn(assetBrowserRookieOnly)} onClick={() => setAssetBrowserRookieOnly(v => !v)}>Rookies only</button>}
                    </div>
                );
            } else if (_pro && rosterState.isUsable && phFinderPanel === 'sort') {
                finderPanelEl = finderPanelWrap(
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {assetBrowserSorts.map(opt => {
                            const on = assetBrowserSort === opt.key;
                            return <button key={opt.key} type="button" style={actBtn(on)} onClick={() => { setAssetBrowserSort(opt.key); setPhFinderPanel(null); }}>{opt.label}</button>;
                        })}
                    </div>
                );
            }

            // ── Builder sheet — the builder's content plus the FULL TcVerdictPanel
            // (its internal free/Pro split unchanged) and the Alex second opinion
            // (its own trade-quick-check gate, user-initiated).
            const builderSheetEl = (
                <Sheet open={phBuilderOpen} onClose={() => setPhBuilderOpen(false)} title={_verdict.hasTrade ? 'Live deal' : 'Trade builder'} desktop={null}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 14px 4px' }}>
                        <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.6, lineHeight: 1.5 }}>
                            Values sourced from <strong style={{ color: 'var(--gold)' }}>{skinVocabulary.valueShortLabel || 'DHQ'} Engine</strong> ({valueSourceLabel}).
                        </div>
                        <div className="tc-builder-sides" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'start' }}>
                            {TcTradeSide({ side: 'A', color: 'var(--k-5dade2, #5dade2)', label: 'YOU SEND', ..._tsDeps })}
                            {TcTradeSide({ side: 'B', color: 'var(--k-e74c3c, #e74c3c)', label: 'YOU GET', ..._tsDeps })}
                        </div>
                        {_verdict.hasTrade
                            ? <React.Fragment>
                                {React.createElement(TcVerdictPanel, { ..._verdict, FAAB_RATE })}
                                {renderAlexVerdict()}
                            </React.Fragment>
                            : <div className="tc-dhq-empty">Add assets to either side — the verdict updates live.</div>}
                    </div>
                </Sheet>
            );

            // ── Action bar — the canonical live-deal strip (desk only; the Trade
            // Log row tap opens its own sheet instead, per the approved spec).
            const actionBarEl = (
                <ActionBar visible={active === 'desk'}
                    label={_verdict.hasTrade ? 'LIVE DEAL' : 'TRADE BUILDER'}
                    value={_verdict.hasTrade ? `${_verdict.grade?.grade || '--'} ${_verdict.diffDisplay}` : 'No live deal'}
                    tone={_verdict.hasTrade ? (_verdict.userGain > 0 ? 'good' : _verdict.userGain < 0 ? 'bad' : 'gold') : 'mute'}
                    actionLabel="BUILDER"
                    onAction={() => setPhBuilderOpen(true)}
                    onOpen={() => setPhBuilderOpen(true)} />
            );

            // ── DESK body ──
            let deskBody = null;
            if (active === 'desk') {
                const pillsEl = (_pro && rosterState.isUsable) ? (
                    <div className="wr-hscroll" style={{ display: 'flex', gap: '6px', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
                        {React.createElement(FilterPill, { label: 'Intent', value: intentLabel, onClick: () => setPhFinderPanel(p => p === 'intent' ? null : 'intent') })}
                        {React.createElement(FilterPill, { label: 'Partner', value: pinnedPartnerName, onClick: () => setPhFinderPanel(p => p === 'partner' ? null : 'partner') })}
                        {focusR ? React.createElement(FilterPill, { label: '✕', value: focusR.label, onClick: phClearFocus }) : null}
                        {React.createElement(FilterPill, { label: 'Pos', value: assetBrowserPos, onClick: () => setPhFinderPanel(p => p === 'pos' ? null : 'pos') })}
                        {React.createElement(FilterPill, { label: 'Sort', value: sortLabel, onClick: () => setPhFinderPanel(p => p === 'sort' ? null : 'sort') })}
                    </div>
                ) : null;
                deskBody = (
                    <React.Fragment>
                        {dealHqNotice && <div className="tc-dhq-notice" onAnimationEnd={() => setDealHqNotice(null)}>{dealHqNotice}</div>}
                        {tradeContext && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))', borderRadius: '8px', padding: '9px 11px' }}>
                                <div style={{ minWidth: 0 }}>
                                    <span style={{ display: 'block', fontSize: MICRO, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, fontFamily: MONO }}>Trade Context</span>
                                    <em style={{ display: 'block', color: 'var(--silver)', fontSize: '0.74rem', fontStyle: 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatTradeContextSummary(tradeContext) || 'Opened from the transaction ticker.'}</em>
                                </div>
                                <button type="button" onClick={clearTradeContext} style={{ ...actBtn(false), flexShrink: 0 }}>Clear</button>
                            </div>
                        )}
                        {heroEl}
                        {_pro && !rosterState.isUsable && window.App?.renderRosterDataBlocker?.(rosterState, {
                            title: rosterState.isPreDraftRosterEmpty ? null : 'Roster sync incomplete',
                            message: rosterState.isPreDraftRosterEmpty ? rosterState.message : 'Trade partner scores need your current roster before they can be trusted.',
                            detail: rosterState.detail,
                            actionLabel: rosterState.isPreDraftRosterEmpty ? null : 'Refresh Data',
                            style: { minHeight: '180px' },
                        })}
                        {pillsEl}
                        {finderPanelEl}
                        {_pro && rosterState.isUsable && (
                            finderDeals.length
                                ? <React.Fragment>
                                    {goldDiv('Finder rows', finderPoolOn ? 'league-wide' : (selectedPartner ? 'vs ' + selectedPartner.ownerName : null))}
                                    <div style={{ fontFamily: MONO, fontSize: MICRO, color: 'var(--silver)', opacity: 0.7 }}>{finderActionable.length} actionable · {finderMoonshotCount} moonshot{finderMoonshotCount === 1 ? '' : 's'}{finderPoolOn && !finderPool.done ? ` · scanning ${finderPool.scanned}/${finderPool.total}` : ''}</div>
                                </React.Fragment>
                                : (finderPoolOn && !finderPool.done
                                    ? <div style={{ fontFamily: MONO, fontSize: MICRO, color: 'var(--silver)', opacity: 0.7 }}>Scanning partner {finderPool.scanned}/{finderPool.total} — moves appear as the league scan runs.</div>
                                    : <div className="tc-dhq-empty">No package found for this intent — change the partner or focus in the finder controls.</div>)
                        )}
                        {_pro && rosterState.isUsable && finderVisibleDeals.map(phDealCard)}
                        {_pro && rosterState.isUsable && (finderDeals.length > finderVisibleDeals.length || showAllDeals) && (
                            <button type="button" style={{ ...actBtn(false), width: '100%' }} onClick={() => setShowAllDeals(!showAllDeals)}>{showAllDeals ? 'Hide moonshots' : finderMoonshotCount ? `Show ${finderMoonshotCount} moonshot${finderMoonshotCount === 1 ? '' : 's'}` : `Show ${finderDeals.length - finderVisibleDeals.length} more`}</button>
                        )}
                        {!_pro && React.createElement(TcProTeaser, { label: 'Trade Finder', feature: 'trade-finder', sub: 'Auto-generate deals every owner in your league would actually consider — ranked by acceptance odds, owner psychology, and roster fit.' })}
                        {/* Intent=Picks → a draft-pick board with an Owned/League scope toggle. */}
                        {_pro && rosterState.isUsable && phPicksMode && (
                            <React.Fragment>
                                {goldDiv('Add picks', phPicksScopeMine ? 'Your picks' : 'League picks')}
                                <div className="wr-seg">
                                    <button type="button" className={phPicksScopeMine ? 'is-on' : ''} onClick={() => { setPhPicksScope('owned'); setAssetBrowserOpen(false); }}>Owned</button>
                                    <button type="button" className={!phPicksScopeMine ? 'is-on' : ''} onClick={() => { setPhPicksScope('league'); setAssetBrowserOpen(false); }}>League</button>
                                </div>
                                {phVisiblePicks.length > 0
                                    ? <React.Fragment>
                                        {React.createElement(CardList, { groups: [{ label: null, rows: phVisiblePicks.map(phPickRow) }] })}
                                        {phPickRowsAll.length > 12 && (
                                            <button type="button" style={{ ...actBtn(false), width: '100%' }} onClick={() => setAssetBrowserOpen(v => !v)}>{assetBrowserOpen ? 'Show fewer picks ▴' : `Show more picks ▾ (${Math.min(40, phPickRowsAll.length)} of ${phPickRowsAll.length})`}</button>
                                        )}
                                      </React.Fragment>
                                    : <div className="tc-dhq-empty">No {phPicksScopeMine ? 'owned' : 'league'} picks to browse.</div>}
                            </React.Fragment>
                        )}
                        {_pro && rosterState.isUsable && !phPicksMode && phAssetRowsAll.length > 0 && (
                            <React.Fragment>
                                {goldDiv('Add assets', browsingMyRoster ? 'Your roster' : (effPartnerId != null ? pinnedPartnerName : 'League board'))}
                                {/* Position filter lives in the top "Pos" pill chooser
                                    (assetBrowserPos) — no duplicate inline row here. The
                                    active filter still shows in the pill value + empty note. */}
                                {phVisibleAssets.length > 0
                                    ? <React.Fragment>
                                        {React.createElement(CardList, { groups: [{ label: null, rows: phVisibleAssets.map(phAssetRow) }] })}
                                        {phSortedAssets.length > 8 && (
                                            <button type="button" style={{ ...actBtn(false), width: '100%' }} onClick={() => setAssetBrowserOpen(v => !v)}>{assetBrowserOpen ? 'Show fewer assets ▴' : `Show more assets ▾ (${Math.min(28, phSortedAssets.length)} of ${phSortedAssets.length})`}</button>
                                        )}
                                      </React.Fragment>
                                    : <div className="tc-dhq-empty">No {assetBrowserPos === 'ALL' ? '' : assetBrowserPos + ' '}assets to browse.</div>}
                            </React.Fragment>
                        )}
                        {dnaMiniEl}
                    </React.Fragment>
                );
            }

            // ── LOG body — lanes as stacked card lists; ledger reused as-is (its
            // controls already carry the 44px phone bumps); DNA-mini underneath.
            let logBody = null;
            if (active === 'log') {
                const pipelineRows = savedDeals.filter(r => r && r.snapshot);
                const isTerminal = r => r.status === 'accepted' || r.status === 'rejected' || r.status === 'countered';
                const wins = pipelineRows.filter(r => r.outcome?.grudgeType === 'ACCEPTED_WON').length;
                const losses = pipelineRows.filter(r => r.outcome?.grudgeType === 'ACCEPTED_LOST').length;
                const pending = pipelineRows.filter(r => r.status === 'proposed').length;
                const RANK_TO_GRADE = ['—', 'F', 'D', 'C', 'B', 'B+', 'A', 'A+'];
                const gradeRanks = pipelineRows.map(r => FINDER_GRADE_RANK[r.snapshot?.grade] || 0).filter(n => n > 0);
                const avgGrade = gradeRanks.length ? RANK_TO_GRADE[Math.round(gradeRanks.reduce((s, n) => s + n, 0) / gradeRanks.length)] : '—';
                const OUTCOME_SHORT = { ACCEPTED_FAIR: 'FAIR', ACCEPTED_WON: 'W', ACCEPTED_LOST: 'L', REJECTED: 'REJ', COUNTER_FAIR: 'CTR', COUNTER_LOWBALL: 'CTR' };
                const whenLabel = r => { const t = Date.parse(r.createdAt || ''); return t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; };
                const phLogRowEl = (row) => {
                    const s = row.snapshot || {};
                    const gt = row.outcome?.grudgeType ? GRUDGE_TYPES[row.outcome.grudgeType] : null;
                    const outcomeChip = isTerminal(row)
                        ? chip(OUTCOME_SHORT[row.outcome?.grudgeType] || row.status.toUpperCase().slice(0, 4), gt ? (gt.cat === 'rejected' ? 'var(--loss-red)' : gt.cat === 'counter' ? 'var(--warn)' : 'var(--win-green)') : 'var(--silver)')
                        : row.status === 'proposed' ? chip('PEND', 'var(--info, #5dade2)') : null;
                    return (
                        <div key={row.id} role="button" tabIndex={0}
                            onClick={() => setPhLogRowId(row.id)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPhLogRowId(row.id); } }}
                            style={{ display: 'flex', alignItems: 'center', gap: '9px', minHeight: '56px', padding: '9px 10px', background: 'var(--black, #121217)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '9px', cursor: 'pointer' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pipelineRowSummary(row)}</div>
                                <div style={{ fontFamily: MONO, fontSize: MICRO, color: 'var(--text-muted, #8B8B96)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>{[whenLabel(row), row.partnerName || null, row.source === 'alex-chat' ? 'Alex' : null].filter(Boolean).join(' · ')}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                {s.grade ? chip(s.grade, tcGradeColor(s.grade)) : null}
                                {outcomeChip}
                                <span aria-hidden="true" style={{ color: 'var(--text-muted, #55555f)', fontFamily: MONO, fontSize: '0.9rem', fontWeight: 600 }}>›</span>
                            </div>
                        </div>
                    );
                };
                const lanes = [
                    { key: 'idea', label: 'Idea', match: r => r.status === 'idea' },
                    { key: 'saved', label: 'Saved', match: r => r.status === 'saved' },
                    { key: 'proposed', label: 'Proposed', match: r => r.status === 'proposed' },
                    { key: 'done', label: 'Done', match: isTerminal },
                ];
                const laneGroups = lanes
                    .map(lane => ({ lane, rows: pipelineRows.filter(lane.match) }))
                    .filter(g => g.rows.length)
                    .map(g => ({ label: g.lane.label, sub: String(g.rows.length), rows: g.rows.map(phLogRowEl) }));
                logBody = (
                    <React.Fragment>
                        {_pro ? (
                            <React.Fragment>
                                <div className="wr-kpi-strip">
                                    {kpiTile('Deals', pipelineRows.length, 'tracked')}
                                    {kpiTile('Record', (wins + losses) ? `${wins}W-${losses}L` : '—', 'logged outcomes', wins > losses ? 'var(--good)' : losses > wins ? 'var(--bad)' : undefined)}
                                    {kpiTile('Avg grade', avgGrade, 'DHQ bands', avgGrade === '—' ? undefined : tcGradeColor(avgGrade))}
                                    {kpiTile('Pending', pending, 'proposed', pending ? 'var(--warn)' : undefined)}
                                </div>
                                {laneGroups.length
                                    ? React.createElement(CardList, { groups: laneGroups })
                                    : <div className="tc-dhq-empty">No tracked deals yet — Save a finder row or an Alex trade card and it lands here.</div>}
                            </React.Fragment>
                        ) : React.createElement(TcProTeaser, { label: 'Trade Pipeline', feature: 'trade-pipeline', sub: 'Track every deal from idea to proposed to done — logged outcomes teach Alex each owner\'s real trading psychology and sharpen future acceptance odds.' })}
                        {renderTradeLedger()}
                        {_pro && dnaMiniEl}
                    </React.Fragment>
                );
            }

            // ── Trade Log row → deal sheet (the inline lane selects re-homed:
            // status seg + GRUDGE_TYPES outcome list + Load in Builder + Remove,
            // all driving the EXISTING updatePipelineRow/logDealOutcome/
            // loadDealIntoBuilder/removeSavedDeal handlers).
            const phLogRow = phLogRowId ? (savedDeals.find(r => r.id === phLogRowId) || null) : null;
            const phLogTerminal = !!phLogRow && (phLogRow.status === 'accepted' || phLogRow.status === 'rejected' || phLogRow.status === 'countered');
            const logSheetEl = (
                <Sheet open={!!phLogRow} onClose={() => setPhLogRowId(null)} title={phLogRow ? (phLogRow.partnerName || 'Tracked deal') : ''} desktop={null}>
                    {phLogRow && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 14px 4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                {phLogRow.snapshot?.grade ? chip(phLogRow.snapshot.grade, tcGradeColor(phLogRow.snapshot.grade)) : null}
                                {phLogRow.snapshot?.likelihood != null && <span style={{ fontFamily: MONO, fontSize: MICRO, color: 'var(--silver)', opacity: 0.65 }}>{phLogRow.snapshot.likelihood}% @ save</span>}
                                {phLogRow.source === 'alex-chat' && <span style={{ fontFamily: MONO, fontSize: MICRO, color: 'var(--gold)', opacity: 0.7 }}>Alex</span>}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--silver)', lineHeight: 1.55 }}>{pipelineRowSummary(phLogRow)}</div>
                            {phLogTerminal ? (
                                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--white)' }}>
                                    Outcome: <span style={{ color: (GRUDGE_TYPES[phLogRow.outcome?.grudgeType]?.color) || 'var(--silver)' }}>{GRUDGE_TYPES[phLogRow.outcome?.grudgeType]?.label || phLogRow.status}</span>
                                </div>
                            ) : (
                                <React.Fragment>
                                    <div>
                                        <div style={{ fontFamily: MONO, fontSize: MICRO, letterSpacing: '0.05em', color: 'var(--silver)', textTransform: 'uppercase', marginBottom: '6px' }}>Pipeline status</div>
                                        <div className="wr-seg">
                                            {['idea', 'saved', 'proposed'].map(stKey => (
                                                <button key={stKey} type="button" className={phLogRow.status === stKey ? 'is-on' : ''} onClick={() => updatePipelineRow(phLogRow.id, { status: stKey })}>{stKey}</button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontFamily: MONO, fontSize: MICRO, letterSpacing: '0.05em', color: 'var(--silver)', textTransform: 'uppercase', marginBottom: '6px' }}>{phLogRow.partnerOwnerId ? 'Log the real-world outcome — teaches Alex this owner\'s psychology' : 'Log outcome (no partner identity — updates status only)'}</div>
                                        {Object.keys(GRUDGE_TYPES).map(k => (
                                            <button key={k} type="button" onClick={() => logDealOutcome(phLogRow, k)}
                                                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px', marginBottom: '6px', padding: '8px 10px', background: 'var(--black, #121217)', border: '1px solid ' + (GRUDGE_TYPES[k].color || 'rgba(255,255,255,0.1)'), borderRadius: '7px', color: GRUDGE_TYPES[k].color || 'var(--silver)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 600, textAlign: 'left' }}>
                                                {GRUDGE_TYPES[k].label}
                                            </button>
                                        ))}
                                    </div>
                                </React.Fragment>
                            )}
                            <div style={{ display: 'flex', gap: '8px' }}>
                                {pipelineRowLoadable(phLogRow) && (
                                    <button type="button" style={{ ...actBtn(true), flex: 1 }} onClick={() => { loadDealIntoBuilder({ ...phLogRow.snapshot, id: phLogRow.id, partnerOwnerId: phLogRow.partnerOwnerId }); setPhLogRowId(null); setPhBuilderOpen(true); }}>Load in Builder</button>
                                )}
                                <button type="button" style={{ ...actBtn(false), flex: 1, color: 'rgba(231,76,60,0.85)' }} onClick={() => { removeSavedDeal(phLogRow.id); setPhLogRowId(null); }}>Remove</button>
                            </div>
                        </div>
                    )}
                </Sheet>
            );

            // ── DNA tab — already card-based; same gate as desktop.
            const dnaTabBody = active === 'dna'
                ? (_pro ? renderOwnerDna() : React.createElement(TcProTeaser, { label: 'Owner DNA', feature: 'owner-dna', sub: 'Profile every manager\'s trading psychology. Know who\'s a Fleecer, who\'s Desperate, and exactly how to approach each trade conversation.' }))
                : null;

            return (
                // Bottom pad clears the always-on ActionBar + home-indicator dock
                // without relying on the shell backstop.
                <div className="tc-trade-root" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px var(--wr-phone-gutter, 12px) calc(60px + var(--wr-bottom-inset, 0px))' }}>
                    {/* Same phone-tier touch bumps as the desktop workspace root —
                        the builder sheet (TcTradeSide) and DNA tab reuse the same
                        class-styled controls. Scoped ≤767 under .tc-trade-root. */}
                    <style>{`
                        @media (max-width: 767px) {
                            .tc-trade-root .tc-ta-owner-select,
                            .tc-trade-root .tc-ta-roster-filter,
                            .tc-trade-root .tc-dna-select { min-height: 44px; }
                            .tc-trade-root .tc-ta-roster-item { min-height: 44px; }
                            .tc-trade-root button.tc-dhq-asset-row { min-height: 44px; }
                            .tc-trade-root .tc-rail-dna-link { min-height: 44px; }
                        }
                    `}</style>
                    {/* Sub-nav — same canonical tcTab setters as the desktop
                        module-nav; the LOG count mirrors the desktop badge. */}
                    <div className="wr-seg">
                        <button type="button" className={active === 'desk' ? 'is-on' : ''} onClick={() => setTcTab('desk')}>Desk</button>
                        <button type="button" className={active === 'dna' ? 'is-on' : ''} onClick={() => setTcTab('dna')}>Owner DNA</button>
                        <button type="button" className={active === 'log' ? 'is-on' : ''} onClick={() => setTcTab('log')}>{savedDeals.length > 0 ? `Log · ${savedDeals.length}` : 'Log'}</button>
                    </div>
                    {deskBody}
                    {dnaTabBody}
                    {logBody}
                    {builderSheetEl}
                    {logSheetEl}
                    {actionBarEl}
                </div>
            );
        }

        // ── Main render ──
        // ── Command mode: concise intelligence briefing ──
        if (viewMode === 'command') {
            // Gate: Intelligence requires warroom tier
            if (!canAccess('intelligence-full')) {
                return React.createElement(UpgradeGate, {
                    feature: 'intelligence-full',
                    title: 'UNLOCK TRADE CENTER',
                    description: 'See trades your leaguemates are actually likely to accept. Owner DNA profiles every manager\'s trading psychology — Fleecer, Dominator, Stalwart, Acceptor, or Desperate — then calculates acceptance likelihood.',
                    targetTier: 'warroom'
                });
            }
            // Rank all teams by trade fit
            const allTargets = assessments.filter(a => a.rosterId !== myRosterId).map(a => {
                const dk = ownerDna[a.ownerId] || 'NONE';
                const dna = DNA_TYPES[dk] || DNA_TYPES.NONE;
                const posture = calcOwnerPosture(a, dk);
                const compat = myAssessment ? calcComplementarity(myAssessment, a) : 0;
                const theirNeeds = a.needs?.slice(0, 3) || [];
                const yourSurplus = myAssessment?.strengths?.filter(s => theirNeeds.some(n => n.pos === s)) || [];
                const desperation = a.panic || 0;
                const label = compat >= 50 ? 'TARGET' : compat >= 25 ? 'POSSIBLE' : desperation >= 3 ? 'DESPERATE' : 'LOW PROB';
                const labelCol = label === 'TARGET' ? 'var(--k-2ecc71, #2ecc71)' : label === 'POSSIBLE' ? 'var(--k-f0a500, #f0a500)' : label === 'DESPERATE' ? 'var(--k-bb8fce, #bb8fce)' : 'var(--silver)';
                return { ...a, dk, dna, posture, compat, theirNeeds, yourSurplus, desperation, label, labelCol };
            }).sort((a, b) => b.compat - a.compat);

            const topTargets = allTargets.filter(t => t.label === 'TARGET' || t.label === 'POSSIBLE').slice(0, 5);
            const desperate = allTargets.filter(t => t.desperation >= 3 && t.label !== 'TARGET').slice(0, 2);
            const avoid = allTargets.filter(t => t.compat < 15).slice(0, 2);

            // Strategy summary
            const myNeeds = myAssessment?.needs?.slice(0, 3) || [];
            const myStrengths = myAssessment?.strengths || [];
            const stratText = myNeeds.length ? 'Target teams needing ' + myStrengths.slice(0, 2).join('/') + '. Offer surplus depth for ' + myNeeds.map(n => n.pos).join('/') + ' upgrades.' : 'Your roster is balanced. Look for value asymmetry trades.';

            const renderTarget = (t, i, showCTA) => (
                <div key={i} style={{ background: 'var(--black)', border: '2px solid var(--acc-line1, rgba(212,175,55,0.2))', borderLeft: '4px solid ' + (t.dna.color || 'var(--gold)'), borderRadius: 'var(--card-radius)', padding: '16px 20px', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-title)', fontSize: '1.2rem', color: 'var(--white)' }}>{t.ownerName}</span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: t.labelCol, background: wrAlpha(t.labelCol, '15'), padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase' }}>{t.label}</span>
                        {t.dk !== 'NONE' && <span style={{ fontSize: '0.72rem', fontWeight: 700, color: t.dna.color, background: wrAlpha(t.dna.color, '15'), padding: '2px 8px', borderRadius: '4px' }}>{t.dna.label}</span>}
                        <span style={{ fontSize: '0.72rem', color: t.posture.color }}>{t.posture.label}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-title)', fontSize: '1.1rem', color: t.compat >= 50 ? 'var(--good)' : t.compat >= 30 ? 'var(--warn)' : 'var(--silver)' }}>{t.compat}%</span>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--silver)', lineHeight: 1.6, marginBottom: '8px' }}>
                        Needs <strong style={{ color: 'var(--bad)' }}>{t.theirNeeds.map(n => n.pos).join(', ') || 'unknown'}</strong>
                        {t.yourSurplus.length > 0 && <span>. You have <strong style={{ color: 'var(--good)' }}>{t.yourSurplus.join(', ')}</strong> to offer</span>}
                        . <em style={{ color: t.dna.color, opacity: 0.8 }}>{t.dna.strategy ? t.dna.strategy.split('.')[0] + '.' : ''}</em>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.74rem', color: 'var(--silver)', opacity: 0.5 }}>{t.healthScore} health {'\u00B7'} {t.wins}-{t.losses} {'\u00B7'} {t.tier}</span>
                        {showCTA && <React.Fragment>
                            <button onClick={() => { const targetRoster = allRosters.find(r => r.roster_id === t.rosterId); const topPid = (targetRoster?.players || []).map(pid => ({ pid, val: getPlayerValue(pid).value })).filter(p => p.val > 0).sort((a, b) => b.val - a.val)[0]; setFinderQuery(qr => ({ ...qr, intent: 'shop', partnerFilter: t.ownerId, focus: topPid ? { kind: 'player', id: topPid.pid } : { kind: 'owner', id: t.ownerId, label: t.ownerName } })); setTcTab('desk'); }} style={{ marginLeft: 'auto', padding: '5px 12px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '4px', fontFamily: 'var(--font-body)', fontSize: '0.74rem', cursor: 'pointer', fontWeight: 700 }}>GENERATE TRADES</button>
                        </React.Fragment>}
                    </div>
                </div>
            );

            return (
                <div style={{ padding: '20px var(--space-xl)', maxWidth: '1000px', margin: '0 auto' }} className="wr-fade-in">
                    <div className="wr-module-strip">
                        <div className="wr-module-context">
                            <span>Trade</span>
                            <strong>Intelligence Briefing</strong>
                            <em>Best partners, leverage spots, and low-probability paths.</em>
                        </div>
                    </div>

                    {/* Strategy summary */}
                    <div style={{ background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: '10px', padding: '14px 18px', marginBottom: '20px', fontSize: '0.85rem', color: 'var(--silver)', lineHeight: 1.7 }}>
                        {stratText}
                    </div>

                    {/* Best trade partners */}
                    {topTargets.length > 0 && <div style={{ marginBottom: '20px' }}>
                        <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.1rem', color: 'var(--good)', letterSpacing: '0.06em', marginBottom: '8px' }}>BEST TRADE PARTNERS</div>
                        {topTargets.map((t, i) => renderTarget(t, i, true))}
                    </div>}

                    {/* Desperate teams */}
                    {desperate.length > 0 && <div style={{ marginBottom: '20px' }}>
                        <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.1rem', color: 'var(--k-bb8fce, #bb8fce)', letterSpacing: '0.06em', marginBottom: '8px' }}>DESPERATE TEAMS (EXPLOIT)</div>
                        {desperate.map((t, i) => renderTarget(t, 'desp-' + i, true))}
                    </div>}

                    {/* Avoid / low probability */}
                    {avoid.length > 0 && <div style={{ marginBottom: '20px' }}>
                        <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.1rem', color: 'var(--silver)', letterSpacing: '0.06em', marginBottom: '8px', opacity: 0.6 }}>LOW PROBABILITY</div>
                        {avoid.map((t, i) => <div key={'avoid-'+i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--ov-1, rgba(255,255,255,0.02))', borderRadius: '6px', marginBottom: '4px', opacity: 0.5 }}>
                            <span style={{ fontSize: '0.82rem', color: 'var(--silver)' }}>{t.ownerName}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--silver)' }}>{t.compat}% fit {'\u00B7'} {t.dna.label}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.4 }}>Low roster overlap</span>
                        </div>)}
                    </div>}

                    {/* Target map summary */}
                    <div style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                        <div style={{ fontFamily: 'var(--font-title)', fontSize: '1rem', color: 'var(--gold)', marginBottom: '8px' }}>LEAGUE TARGET MAP</div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {allTargets.map((t, i) => <span key={i} style={{ fontSize: '0.74rem', padding: '3px 10px', borderRadius: '4px', background: wrAlpha(t.labelCol, '12'), border: '1px solid ' + wrAlpha(t.labelCol, '30'), color: t.labelCol, fontWeight: 600 }}>{t.ownerName} {t.compat}%</span>)}
                        </div>
                    </div>

                    {/* Trade history insight */}
                    {(() => {
                        const tradeHist = window.App?.LI?.tradeHistory || [];
                        if (!tradeHist.length) return <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                            <div style={{ fontFamily: 'var(--font-title)', fontSize: '1rem', color: 'var(--silver)', opacity: 0.6, marginBottom: '4px' }}>LEAGUE TRADE PATTERNS</div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--silver)', opacity: 0.4 }}>No trade history available yet. As trades occur, patterns will emerge here.</div>
                        </div>;
                        const activeCounts = {};
                        tradeHist.forEach(t => (t.roster_ids || []).forEach(rid => { activeCounts[rid] = (activeCounts[rid] || 0) + 1; }));
                        const mostActive = Object.entries(activeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
                        return <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                            <div style={{ fontFamily: 'var(--font-title)', fontSize: '1rem', color: 'var(--gold)', marginBottom: '6px' }}>WHAT WORKS IN THIS LEAGUE</div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--silver)', lineHeight: 1.6 }}>
                                {tradeHist.length} trades completed. Most active: {mostActive.map(([rid, cnt]) => (ownerNameForRosterId(parseInt(rid)) || 'Team ' + rid) + ' (' + cnt + ')').join(', ')}.
                            </div>
                        </div>;
                    })()}

                    <div style={{ textAlign: 'center', padding: '12px', fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.4 }}>Switch to Analyst view for full owner profiles, trade calculator, and history</div>
                </div>
            );
        }

        // ══ PHONE (<768) — EARLY RETURN (iPhone program Phase 2). Everything
        // below renders only off-phone, so the desktop/tablet workspace stays
        // byte-identical. Kit presence (wr-primitives.js loads earlier in the
        // babel chain) is fixed for the page's lifetime, so gating the return
        // on it has no hook hazard. Command mode returned above (desktop shape
        // on every tier — outside the phone re-pour's scope).
        const _phoneKitReady = !!(window.WR && window.WR.HeroCard && window.WR.AssetRow && window.WR.CardList && window.WR.FilterPill && window.WR.FilterSheet && window.WR.Sheet && window.WR.ActionBar);
        if (_vp.isPhone && _phoneKitReady) return renderPhoneWorkspace();

        // ── Workspace entry (Phase 2) ──
        // Every tier lands on the adaptive workspace (TRADE DESK · OWNER DNA ·
        // TRADE LOG); gating is region-scoped inside it (wrIsPro). The legacy
        // 3-tab shell and its _wrAdaptiveCanvas kill switch are retired — the
        // shell's only ungated surface (the analyzer) was replaced by the
        // Desk's persistent builder strip, which serves free at full fidelity.
        return renderAdaptiveWorkspace();
    }
