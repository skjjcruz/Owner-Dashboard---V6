// ══════════════════════════════════════════════════════════════════
// js/shared/ask-tools-moves.js — Ask tools: moves, trades, owners, draft
//
// Registers on window.App.AskTools (js/shared/ask-tools.js, which must load
// first). Tools the member's own AI can call:
//   get_transactions     league moves (trades, waivers, free agents)
//   trade_plan           verdict first: who, what they want, the going rate,
//                        up to 3 offers from what I own (start here)
//   evaluate_trade       grade a proposed deal; `verdict` reconciles it all
//   find_trade_partners  who to call, for a position or in general
//   get_owner_profile    one owner's trading DNA, record and activity
//   get_draft_info       picks owned, pick values, past drafts, hit rates,
//                        rookie prospects
//
// Every number comes from the app's own data or engine (App.LI, the team
// assessor, App.TradeEngine, the pick-value model). Nothing here calls an AI.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const AT = App.AskTools;
    if (!AT || typeof AT.register !== 'function') {
        if (root.console && root.console.warn) root.console.warn('ask-tools-moves.js: App.AskTools missing; load ask-tools.js first.');
        return;
    }
    const h = AT.h;
    const { S, LI, round1, pname, ppos, pl, value, meta, rosters, league, season, week, platform, myRoster, label, findTeam, findPlayer, rosterOf, assess, record, withTimeout, isMe } = h;

    // ── Small helpers ──────────────────────────────────────────────
    const clampInt = (n, lo, hi, dflt) => { const v = parseInt(n, 10); return isNaN(v) ? dflt : Math.max(lo, Math.min(hi, v)); };
    const rosterById = rid => rosters().find(r => String(r.roster_id) === String(rid)) || null;
    const teamLabel = rid => { const r = rosterById(rid); return r ? label(r) : 'Team ' + rid; };
    const toMs = ts => { const n = Number(ts) || 0; return n && n < 1e12 ? n * 1000 : n; };
    const isoDate = ts => { const ms = toMs(ts); if (!ms) return null; try { return new Date(ms).toISOString().slice(0, 10); } catch (e) { return null; } };
    const totalTeams = () => rosters().length || Number((h.settings() || {}).num_teams) || 12;
    const draftRounds = () => Number((h.settings() || {}).draft_rounds) || 4;
    const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];
    const roundName = rd => ORD[rd] || ('R' + rd);
    const playerLine = pid => ({ name: pname(pid), pos: ppos(pid), nfl_team: pl(pid).team || 'FA', value: value(pid) || 0 });
    const allAssess = () => { try { return typeof root.assessAllTeamsFromGlobal === 'function' ? (root.assessAllTeamsFromGlobal() || []) : []; } catch (e) { return []; } };
    const assessSummary = a => a ? {
        tier: a.tier || null, window: a.window || null, health: a.healthScore != null ? Math.round(a.healthScore) : null, panic: a.panic != null ? a.panic : null,
        needs: (a.needs || []).map(n => n.pos + (n.urgency ? ' (' + n.urgency + ')' : '')), strengths: a.strengths || [],
        faab_left: a.faabRemaining != null ? a.faabRemaining : undefined,
    } : null;
    const TE = () => App.TradeEngine || null;

    // ── One value scale (owner ruling 2026-10-10) ──────────────────
    // The same bands the server connector states: 7,000+ elite, 4,000+
    // starter, 2,000+ depth, below that a stash. Every threshold in this
    // file reads from here (the headliner rule used to start at 3,000).
    const SCALE = { ELITE: 7000, STARTER: 4000, DEPTH: 2000 };
    const SCALE_NOTE = 'Values are DHQ dynasty values: 7,000+ elite, 4,000+ starter, 2,000+ depth, below that a stash.';
    // ── Who counts as a veteran (position-aware age cliffs) ────────
    // Chosen cutoffs: RB 27+, WR 29+, TE 29+, QB 32+; anything else
    // (K, IDP) 30+. A flat "26+" used to call a 27-year-old QB a veteran.
    const VET_AGE = { QB: 32, RB: 27, WR: 29, TE: 29 };
    const vetAge = pos => VET_AGE[String(pos || '').toUpperCase()] || 30;
    const isVet = (pos, age) => Number(age) > 0 && Number(age) >= vetAge(pos);
    const VET_RULE = 'veterans past their age cliff (RB 27+, WR 29+, TE 29+, QB 32+)';
    const isSF = () => { const rp = (h.league() || {}).roster_positions || []; return rp.some(x => /SUPER_FLEX|SUPERFLEX/i.test(x)) || rp.filter(x => x === 'QB').length >= 2; };

    // ── Pick values ────────────────────────────────────────────────
    // Same order of preference as the Trade Room (trade-calc.js
    // pickValueForParts → PlayerValue.getPickValue): the league-calibrated
    // DHQ curve, then the shared industry pick-value model, then a fixed
    // round table. Read at the current season so no engine year discount
    // applies; pickValue adds the discount itself (below).
    function rawPickValue(round, slot) {
        const teams = totalTeams(), rounds = draftRounds(), yr = season();
        const s = slot || Math.ceil(teams / 2);
        try {
            const PV = App.PlayerValue;
            if (PV && typeof PV.getPickValue === 'function') { const v = PV.getPickValue(yr, round, teams, s, rounds); if (v > 0) return v; }
        } catch (e) { /* fall through */ }
        try {
            const fn = LI().dhqPickValueFn;
            if (typeof fn === 'function') { const v = fn(yr, round, s); if (v > 0) return v; }
        } catch (e) { /* fall through */ }
        try {
            if (typeof root.getPickValueBySlot === 'function') { const v = root.getPickValueBySlot(round, s, teams, rounds); if (v > 0) return v; }
        } catch (e) { /* fall through */ }
        return ({ 1: 7000, 2: 3500, 3: 1800, 4: 800 }[round] || 400);
    }
    // The next draft still to be held. The engine discounted from the
    // current season, so in October 2026 (2026 draft done) the 2027 pick,
    // six months out, took a full year's 12% cut. Taken from the pick
    // ownership builder (which already rolls past a finished draft), else
    // from the drafts / league status / week.
    let ndyMemo = null;
    function nextDraftYear() {
        const s = S(), key = [rosters(), s.tradedPicks, season(), s.drafts];
        if (ndyMemo && ndyMemo.key.every((k, i) => k === key[i])) return ndyMemo.v;
        let v = null;
        const own = picksByOwner();
        if (own) { const ys = Object.values(own).flat().map(x => Number(x.year)).filter(Boolean); if (ys.length) v = Math.min(...ys); }
        if (v == null) {
            const yr = parseInt(season(), 10) || new Date().getFullYear();
            const ds = (s.drafts || []).filter(d => String(d.season) === String(yr));
            const st = String((league() || {}).status || '');
            if (ds.length) v = ds.every(d => String(d.status || '').toLowerCase() === 'complete') ? yr + 1 : yr;
            else if (/^(pre_draft|drafting)$/.test(st)) v = yr;
            else v = (week() >= 1 || /^(in_season|post_season|complete)$/.test(st)) ? yr + 1 : yr;
        }
        ndyMemo = { key, v };
        return v;
    }
    // Current standings, worst team first (win %, then fewest points for).
    // Null before anyone has played.
    function standingsWorstFirst() {
        const rs = rosters().slice();
        const g = r => { const st = r.settings || {}; return (st.wins || 0) + (st.losses || 0) + (st.ties || 0); };
        if (!rs.some(r => g(r) > 0)) return null;
        const pct = r => { const st = r.settings || {}; return g(r) ? ((st.wins || 0) + 0.5 * (st.ties || 0)) / g(r) : 0.5; };
        const pf = r => { const st = r.settings || {}; return (st.fpts || 0) + (st.fpts_decimal || 0) / 100; };
        return rs.sort((a, b) => pct(a) - pct(b) || pf(a) - pf(b)).map(r => String(r.roster_id));
    }
    // Projected slot of a team's pick in the NEXT draft from today's
    // standings (worst team picks 1st). Later drafts are too far to call:
    // they stay mid-round. Null when unknown.
    function projectedSlot(year, origRid) {
        if (origRid == null || Number(year) !== nextDraftYear()) return null;
        const order = standingsWorstFirst();
        if (!order) return null;
        const i = order.indexOf(String(origRid));
        return i < 0 ? null : i + 1;
    }
    // A pick's value: slot (given, else projected from standings for the
    // next draft, else mid), no discount for the next draft, 12% a year
    // for each draft after it.
    function pickValue(year, round, slot, fromRid) {
        round = Number(round);
        const s = slot != null ? Number(slot) : projectedSlot(year, fromRid);
        const ahead = Math.max(0, (parseInt(year, 10) || 0) - nextDraftYear());
        return Math.round(rawPickValue(round, s) * Math.pow(0.88, ahead));
    }
    // Picks owned by each roster: { rid: [{ year, round, originalOwnerRid }] }
    // from the shared team assessor's builder (rosters + Sleeper's traded
    // picks). Null when the builder or the league isn't loaded.
    function picksByOwner() {
        const fn = (typeof root.buildPicksByOwner === 'function' && root.buildPicksByOwner) || (typeof App.buildPicksByOwner === 'function' && App.buildPicksByOwner);
        const lg = league();
        if (!fn || !lg || !rosters().length) return null;
        try { return fn(rosters(), Object.assign({ season: season() }, lg), S().tradedPicks || []) || null; } catch (e) { return null; }
    }
    const pickLabel = (year, round, fromRid, holderRid) => year + ' ' + roundName(Number(round)) + (fromRid != null && String(fromRid) !== String(holderRid) ? ' (from ' + teamLabel(fromRid) + ')' : '');

    // "2027 1st", "2027 round 2", "2027 R1", "2026 1.03", "Gas's 2027 1st",
    // "2027 1st from Gas", "next year's 2nd", "early 2027 1st". Null if the
    // text doesn't read as a pick.
    const WORD_ROUND = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };
    function parsePick(text) {
        const raw = String(text || '');
        const t = ' ' + raw.toLowerCase().replace(/[’']s\b/g, '').replace(/[(),]/g, ' ') + ' ';
        let year = (t.match(/\b(20\d\d)\b/) || [])[1];
        let round = null, slot = null, m;
        if ((m = t.match(/\b([1-7])\.(\d{1,2})\b/))) { round = +m[1]; slot = +m[2]; }
        else if ((m = t.match(/\b([1-7])(?:st|nd|rd|th)\b/))) round = +m[1];
        else if ((m = t.match(/\bround\s*([1-7])\b/) || t.match(/\b(?:r|rd)\s?([1-7])\b/))) round = +m[1];
        else if ((m = t.match(/\b(first|second|third|fourth|fifth|sixth|seventh)\b/))) round = WORD_ROUND[m[1]];
        if (!round) return null;
        if (!year && !/\b(pick|picks|rounder|round)\b/.test(t)) return null;
        const yrNow = parseInt(season(), 10) || new Date().getFullYear();
        if (!year) year = /\bnext year\b/.test(t) ? yrNow + 1 : null;
        if (/\bearly\b/.test(t) && slot == null) slot = 2;
        else if (/\blate\b/.test(t) && slot == null) slot = Math.max(1, totalTeams() - 1);
        // Whatever is left may name the original owner ("from Gas", "Gas 2027 1st").
        const rest = t.replace(/\b20\d\d\b|\b[1-7]\.\d{1,2}\b|\b[1-7](st|nd|rd|th)\b|\bround\s*[1-7]\b|\b(r|rd)\s?[1-7]\b|\b(first|second|third|fourth|fifth|sixth|seventh)\b|\b(pick|picks|rounder|round|from|via|the|a|an|next|year|early|mid|middle|late|my|own|their|his|projected)\b/g, ' ').replace(/\s+/g, ' ').trim();
        let from = null;
        if (rest && rest.length >= 2) { const r = /^(me|mine|i)$/.test(rest) ? myRoster() : findTeam(rest); if (r) from = r.roster_id; }
        if (/\bmy\b|\bmine\b|\bown\b/.test(t) && from == null) { const me = myRoster(); if (me) from = me.roster_id; }
        return { year: year ? Number(year) : null, round, slot, from };
    }

    // ── Owner DNA ──────────────────────────────────────────────────
    // computeWeightedDNA lives inside the Trade Room component
    // (trade-calc.js) and is not on window, so this is a faithful port of it
    // over App.LI.tradeHistory + ownerProfiles; a global one wins if present.
    const DNA_META = {
        FLEECER: { label: 'The Fleecer', strategy: 'Hunts lopsided value. Lead with clean surplus; the math still has to work.' },
        DOMINATOR: { label: 'The Dominator', strategy: 'Needs to feel like the winner. Frame the offer as handing them the better side.' },
        STALWART: { label: 'The Stalwart', strategy: 'Attached to his roster and slow to move. Lead with clear value, never lowball.' },
        ACCEPTOR: { label: 'The Acceptor', strategy: 'Sells current players for futures. Offer picks and young upside.' },
        DESPERATE: { label: 'The Desperate', strategy: 'Urgency from injuries or a playoff push. Find his empty slot and move fast.' },
        NONE: { label: 'No DNA read', strategy: 'Not enough trades to read him. Offer fair value and watch for tells.' },
    };
    function computeDNA(rid) {
        try { if (typeof root.computeWeightedDNA === 'function') return root.computeWeightedDNA(rid); } catch (e) { /* port below */ }
        const L = LI(), all = L.tradeHistory || [], profile = (L.ownerProfiles || {})[rid] || {};
        const same = x => String(x) === String(rid);
        const trades = all.filter(t => (t.roster_ids || []).some(same));
        if (trades.length < 2) return null;
        const scores = { FLEECER: 0, DOMINATOR: 0, STALWART: 0, ACCEPTOR: 0, DESPERATE: 0 }, signals = [];
        const leagueSize = Math.max(1, rosters().length || 10);
        const avgTrades = all.length / leagueSize;
        if (avgTrades > 0) {
            const ratio = trades.length / avgTrades;
            if (ratio < 0.5) { scores.STALWART += 4; signals.push('Low trade activity'); } else if (ratio > 1.75) { scores.FLEECER += 3; signals.push('High trade volume'); }
        }
        const graded = (profile.tradesWon || 0) + (profile.tradesLost || 0) + (profile.tradesFair || 0);
        if (graded >= 2) {
            const w = (profile.tradesWon || 0) / graded, l = (profile.tradesLost || 0) / graded, f = (profile.tradesFair || 0) / graded;
            if (w > 0.55) { scores.FLEECER += Math.round(w * 6); signals.push('Wins ' + Math.round(w * 100) + '% of trades'); }
            if (l > 0.45) { scores.ACCEPTOR += 2; scores.DESPERATE += 2; signals.push('Loses ' + Math.round(l * 100) + '% of trades'); }
            if (f > 0.55) { scores.STALWART += 2; signals.push('Prefers balanced deals'); }
        }
        const avgDiff = profile.avgValueDiff || 0;
        if (avgDiff > 400) { scores.FLEECER += 4; signals.push('Avg +' + Math.round(avgDiff) + ' DHQ/trade'); } else if (avgDiff > 100) { scores.DOMINATOR += 2; signals.push('Avg +' + Math.round(avgDiff) + ' DHQ/trade'); } else if (avgDiff < -300) { scores.DESPERATE += 3; scores.ACCEPTOR += 1; signals.push('Avg ' + Math.round(avgDiff) + ' DHQ/trade'); } else if (Math.abs(avgDiff) <= 150) { scores.STALWART += 2; signals.push('Balanced trade value'); }
        let pr = 0, ps = 0, eSent = 0, eRecv = 0, late = 0;
        const sc = L.playerScores || {};
        for (const t of trades) {
            const mine = (t.sides || {})[rid] || { players: [], picks: [] };
            const other = (t.roster_ids || []).find(r => !same(r));
            const theirs = (t.sides || {})[other] || { players: [], picks: [] };
            pr += (mine.picks || []).length; ps += (theirs.picks || []).length;
            for (const pid of theirs.players || []) if ((sc[pid] || 0) > 5000) eSent++;
            for (const pid of mine.players || []) if ((sc[pid] || 0) > 5000) eRecv++;
            if ((t.week || 0) >= 10 && (theirs.totalValue || 0) > (mine.totalValue || 0) * 1.15) late++;
        }
        if (ps > 1 && pr < ps * 0.7) { scores.DOMINATOR += 3; signals.push('Trades picks for players (win-now)'); }
        if (pr > 1 && ps < pr * 0.7) { scores.ACCEPTOR += 3; signals.push('Trades players for picks'); }
        if (eSent >= 2 && eSent > eRecv) { scores.DESPERATE += 4; signals.push('Sold ' + eSent + ' elite players'); }
        if (eRecv >= 2 && eRecv > eSent) { scores.FLEECER += 3; signals.push('Acquired ' + eRecv + ' elite players'); }
        if (late >= 2) { scores.DESPERATE += 3; signals.push(late + ' late-season panic trades'); }
        const ranked = Object.entries(scores).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
        if (!ranked.length || ranked[0][1] < 3) return null;
        const [top, second] = ranked;
        const total = ranked.reduce((s, [, v]) => s + v, 0);
        const dominance = second ? (top[1] - second[1]) / top[1] : 1;
        const confidence = Math.min(92, Math.round(((top[1] / total) * 0.6 + dominance * 0.4) * 100));
        if (confidence < 22) return null;
        return { key: top[0], confidence, reasoning: signals.slice(0, 4).join(' · ') || 'Based on trade patterns' };
    }
    function dnaBrief(rid) {
        const d = computeDNA(rid);
        const key = d && d.key ? d.key : 'NONE';
        const m = DNA_META[key] || DNA_META.NONE;
        return { key, label: m.label, confidence_pct: d ? d.confidence : null, signals: d ? d.reasoning : 'Fewer than two graded trades', how_to_deal: m.strategy };
    }

    // Psychology factors, in plain English (names from App.TradeEngine.calcPsychTaxes).
    const PLAIN = {
        'Endowment Effect': 'they value their own players above the market',
        'Panic Premium': 'they are hurting and more willing to deal',
        'Status Tax': 'they hate losing a trade',
        'Loss Aversion': 'they fear giving up a familiar player',
        'Rebuilding Discount': 'they discount current starters while rebuilding',
        'Need Fulfillment': 'your surplus fills a position they need',
        'Window Alignment': 'your windows fit (one buying now, one building)',
        'Window Friction': 'you are both chasing the same window',
        'Locked Roster Tax': 'their roster is set and they rarely move',
        'Seller Momentum': 'they are actively selling',
    };
    const psychLines = taxes => (taxes || []).slice(0, 6).map(x => ({ factor: x.name, effect: (Number(x.impact) || 0) > 0 ? 'helps' : 'hurts', impact: Number(x.impact) || 0, means: PLAIN[x.name] || x.desc || String(x.name).toLowerCase() }));

    // Owner posture, with the rebuild read first. The engine's
    // calcOwnerPosture checks panic >= 4 before a rebuild, so a 1-3 team
    // selling vets for picks read "Desperate: will overpay for immediate
    // help" (and got the Panic Premium on acceptance), and a middling team
    // with panic >= 2 read "Active Buyer". Here: a rebuilding owner is a
    // seller whatever his panic; "buyer" needs a contending read.
    const POSTURE = {
        SELLER: { key: 'SELLER', label: 'Active Seller', desc: 'Moving assets for futures. Buy at a discount.' },
        NEUTRAL: { key: 'NEUTRAL', label: 'Neutral', desc: 'No strong directional push. Fair offers only.' },
    };
    function postureFor(theirA, dnaKey, intent) {
        const E = TE();
        if (intent && intent.mode === 'REBUILDING') return POSTURE.SELLER;
        let p = null;
        try { p = E && E.calcOwnerPosture ? E.calcOwnerPosture(theirA, dnaKey) : null; } catch (e) { p = null; }
        if (p && p.key === 'BUYER' && !(intent && intent.mode === 'CONTENDING')) return POSTURE.NEUTRAL;
        if (p && p.key === 'SELLER' && intent && intent.mode === 'CONTENDING') return POSTURE.NEUTRAL;
        return p;
    }
    // Acceptance chance + posture for a deal (give = my side's total).
    // `intent` (ownerIntent) corrects the posture, and a rebuilder's panic
    // is not a reason to pay for immediate help (no Panic Premium).
    function dealRead(me, partner, giveTotal, getTotal, pieces, intent) {
        const out = { posture: null, accept_pct: null, psychology: [], dna: null, _taxes: [], _mineA: null, _theirA: null };
        if (!partner) return out;
        out.dna = dnaBrief(partner.roster_id);
        const E = TE(), mineA = me ? assess(me.roster_id) : null, theirA = assess(partner.roster_id);
        out._mineA = mineA; out._theirA = theirA;
        if (!E || !mineA || !theirA) return out;
        try {
            const posture = postureFor(theirA, out.dna.key, intent);
            let taxes = E.calcPsychTaxes ? (E.calcPsychTaxes(mineA, theirA, out.dna.key, posture) || []) : [];
            if (intent && intent.mode === 'REBUILDING') taxes = taxes.filter(t => t.name !== 'Panic Premium');
            out._taxes = taxes;
            out.posture = posture ? { key: posture.key, label: posture.label, means: posture.desc } : null;
            out.psychology = psychLines(taxes);
            if (E.calcAcceptanceLikelihood) out.accept_pct = E.calcAcceptanceLikelihood(giveTotal, getTotal, out.dna.key, taxes, mineA, theirA, { totalPieces: pieces });
        } catch (e) { /* acceptance is a bonus */ }
        return out;
    }
    // Acceptance on what the partner VALUES (owner ruling 2026-10-10): the
    // engine's curve runs on worth-to-them against their cost as they see
    // it, so sending more of what they don't want (aging vets to a
    // rebuilder) no longer raises the chance. Each extra player they must
    // roster costs 8 points (a roster spot). Same 5-95 curve as the engine
    // when it isn't loaded.
    function acceptFor(read, toThem, theirCost, pieces, extraPlayers) {
        const E = TE();
        let pct = null;
        try {
            if (E && E.calcAcceptanceLikelihood && read && read._mineA && read._theirA) pct = E.calcAcceptanceLikelihood(toThem, theirCost, (read.dna || {}).key || 'NONE', read._taxes || [], read._mineA, read._theirA, { totalPieces: pieces });
        } catch (e) { pct = null; }
        if (pct == null) { const mx = Math.max(toThem, theirCost, 1); pct = Math.max(5, Math.min(95, 50 + Math.round((toThem - theirCost) / mx * 200))); }
        return Math.max(1, Math.round(pct - 8 * Math.max(0, extraPlayers || 0)));
    }

    // ── Transactions ───────────────────────────────────────────────
    // Raw platform moves for the open league (Sleeper shape: type, status,
    // roster_ids, adds {pid: rid}, drops {pid: rid}, settings.waiver_bid,
    // draft_picks, waiver_budget, leg, created). S.transactions is bucketed
    // by week ({ w0: [...], w1: [...] }) by league-detail.js and also carries
    // DHQ history trades (_fromDHQ), which are read from LI.tradeHistory instead.
    function flattenTxns(raw) {
        const list = Array.isArray(raw) ? raw : Object.keys(raw || {}).reduce((acc, k) => acc.concat(Array.isArray(raw[k]) ? raw[k] : []), []);
        const seen = new Set();
        return list.filter(t => {
            if (!t || !t.type || t._fromDHQ || t.status === 'failed') return false;
            const k = t.transaction_id || (t.type + '-' + (t.created || 0) + '-' + JSON.stringify(t.adds || {}));
            if (seen.has(k)) return false;
            seen.add(k); return true;
        });
    }
    async function rawTxns() {
        let list = flattenTxns(S().transactions);
        if (list.length) return list;
        const W = root.WrTxns, lid = S().currentLeagueId;
        if (W && lid) {
            try { list = flattenTxns(W.getCached ? W.getCached(lid) : []); } catch (e) { list = []; }
            if (!list.length && platform() === 'sleeper' && W.fetchLeagueTxns) list = flattenTxns(await withTimeout(W.fetchLeagueTxns(lid), 8000, []));
        }
        return list;
    }
    const txnWeek = t => Number(t.leg != null ? t.leg : t.week) || 0;
    function sideRows(sides, rids) {
        return rids.map(rid => {
            const s = sides[rid] || {};
            return {
                team: teamLabel(rid), roster_id: rid,
                got_players: (s.players || []).map(playerLine),
                got_picks: (s.picks || []).map(pk => pickLabel(pk.season, pk.round, pk.from, rid)),
                got_faab: s.faab || undefined,
                value_now: Math.round(s.totalValue || 0),
            };
        });
    }
    function gradeTrade(rids, sides) {
        const vals = rids.map(rid => (sides[rid] || {}).totalValue || 0);
        const maxV = Math.max(...vals, 1);
        const diff = rids.length === 2 ? Math.abs(vals[0] - vals[1]) : 0;
        const pct = +(diff / maxV * 100).toFixed(1);
        const winner = rids.length === 2 && vals[0] !== vals[1] ? (vals[0] > vals[1] ? rids[0] : rids[1]) : null;
        return { fairness: Math.round(100 - Math.min(100, pct)), winner, valueDiff: diff, valueDiffPct: pct };
    }
    // One trade row from LI.tradeHistory (all seasons, valued today).
    function histTradeRow(t) {
        const rids = t.roster_ids || Object.keys(t.sides || {});
        return {
            date: isoDate(t.ts), season: String(t.season || ''), week: t.week != null ? t.week : null, type: 'trade',
            teams: rids.map(teamLabel), sides: sideRows(t.sides || {}, rids),
            fairness: t.fairness != null ? t.fairness : null,
            winner: t.winner != null && t.valueDiffPct > 15 ? teamLabel(t.winner) : t.valueDiffPct != null && t.valueDiffPct <= 15 ? 'fair (within 15%)' : null,
            margin_now: Math.round(t.valueDiff || 0), margin_pct: t.valueDiffPct != null ? t.valueDiffPct : null,
            _rids: rids.map(String), _winner: t.winner != null ? String(t.winner) : null, _pct: t.valueDiffPct, _ts: toMs(t.ts),
            _pids: rids.flatMap(r => ((t.sides || {})[r] || {}).players || []).map(String),
        };
    }
    // A raw platform trade (not yet in LI.tradeHistory), valued the same way.
    function rawTradeRow(t) {
        const rids = (t.roster_ids || []).map(String);
        const sides = {};
        rids.forEach(rid => { sides[rid] = { players: [], picks: [], faab: 0, totalValue: 0 }; });
        Object.entries(t.adds || {}).forEach(([pid, rid]) => { if (sides[rid]) sides[rid].players.push(pid); });
        (t.draft_picks || []).forEach(pk => { const s = sides[String(pk.owner_id)]; if (s) s.picks.push({ season: pk.season, round: pk.round, from: pk.roster_id }); });
        (t.waiver_budget || []).forEach(b => { const s = sides[String(b.receiver)]; if (s) s.faab += Number(b.amount) || 0; });
        rids.forEach(rid => { const s = sides[rid]; s.totalValue = s.players.reduce((a, pid) => a + value(pid), 0) + s.picks.reduce((a, pk) => a + pickValue(pk.season, pk.round, null, pk.from), 0); if (!s.faab) delete s.faab; });
        const g = gradeTrade(rids, sides);
        return histTradeRow(Object.assign({ season: t.season || season(), week: txnWeek(t), ts: t.status_updated || t.created, roster_ids: rids, sides }, g));
    }
    function moveRow(t) {
        const rids = [...new Set([...(t.roster_ids || []), ...Object.values(t.adds || {}), ...Object.values(t.drops || {})].map(String))];
        const bid = t.settings && t.settings.waiver_bid;
        return {
            date: isoDate(t.status_updated || t.created), season: season(), week: txnWeek(t), type: t.type,
            team: rids.map(teamLabel).join(' / '),
            adds: Object.keys(t.adds || {}).map(playerLine),
            drops: Object.keys(t.drops || {}).map(pid => ({ name: pname(pid), pos: ppos(pid) })),
            faab_bid: t.type === 'waiver' ? (Number(bid) || 0) : undefined,
            _rids: rids, _ts: toMs(t.status_updated || t.created), _pids: [...Object.keys(t.adds || {}), ...Object.keys(t.drops || {})].map(String),
        };
    }
    const strip = row => { const o = {}; for (const k in row) if (k[0] !== '_' && row[k] !== undefined) o[k] = row[k]; return o; };

    AT.register({
        name: 'get_transactions',
        description: 'League moves: trades (every season, with today\'s value per side and who won), waiver claims with FAAB bids, and free-agent pickups. Filter by type, team, player, recent weeks or season.',
        parameters: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['all', 'trade', 'waiver', 'free_agent'], description: 'Default all.' },
                team: { type: 'string', description: 'Team or owner name, roster id, or "me".' },
                player: { type: 'string', description: 'Only moves involving this player.' },
                weeks: { type: 'integer', description: 'Only the last N weeks of this season.' },
                season: { type: 'string', description: 'Only this season, e.g. "2025". Past seasons have trades only.' },
                limit: { type: 'integer', description: 'Max rows (default 20, max 50).' },
            },
        },
        async run(a) {
            if (!rosters().length) throw new Error('League not loaded yet.');
            const type = ['trade', 'waiver', 'free_agent'].includes(a.type) ? a.type : 'all';
            const limit = clampInt(a.limit, 1, 50, 20);
            const cur = season();
            const notes = [];
            let team = null, pid = null, alt = [];
            if (a.team != null && a.team !== '') { team = findTeam(a.team); if (!team) throw new Error('No team in this league matches "' + a.team + '".'); }
            if (a.player) { const f = findPlayer(a.player); if (!f) throw new Error('No player matches "' + a.player + '".'); pid = String(f.pid); alt = f.alternatives; }
            const wantSeason = a.season ? String(a.season) : null;
            const weeks = a.weeks ? clampInt(a.weeks, 1, 30, null) : null;
            const minWeek = weeks ? Math.max(0, week() - weeks + 1) : null;

            let rows = [];
            const curOk = !wantSeason || wantSeason === cur;
            const raw = curOk ? await rawTxns() : [];
            if (curOk && !raw.length && type !== 'trade') notes.push(platform() === 'sleeper' ? 'No waiver or free-agent moves are loaded for this season yet.' : 'Waiver and free-agent history is only read from Sleeper leagues.');
            if (wantSeason && wantSeason !== cur && type !== 'trade') notes.push('Waiver and free-agent moves are only kept for the current season; past seasons show trades.');
            if (type !== 'trade') rows.push(...raw.filter(t => t.type !== 'trade' && (type === 'all' ? ['waiver', 'free_agent', 'commissioner'].includes(t.type) : t.type === type)).map(moveRow));
            if (type === 'all' || type === 'trade') {
                const hist = (LI().tradeHistory || []).map(histTradeRow);
                const seenTs = new Set(hist.map(r => r._ts));
                const fresh = raw.filter(t => t.type === 'trade' && !seenTs.has(toMs(t.created)) && !seenTs.has(toMs(t.status_updated))).map(rawTradeRow);
                rows.push(...hist, ...fresh);
                if (!hist.length && !fresh.length && !LI().tradeHistory) notes.push('DHQ trade history is still loading; only this season\'s raw trades are shown.');
            }
            if (wantSeason) rows = rows.filter(r => String(r.season) === wantSeason);
            if (minWeek != null) rows = rows.filter(r => String(r.season) === cur && Number(r.week) >= minWeek);
            if (team) rows = rows.filter(r => r._rids.includes(String(team.roster_id)));
            if (pid) rows = rows.filter(r => r._pids.includes(pid));
            rows.sort((x, y) => (y._ts || 0) - (x._ts || 0) || Number(y.season) - Number(x.season) || (y.week || 0) - (x.week || 0));

            const out = { filters: { type, team: team ? label(team) : undefined, player: pid ? pname(pid) : undefined, season: wantSeason || undefined, weeks: weeks || undefined }, total_found: rows.length };
            if (alt.length) out.player_alternatives = alt;
            // A team's trade record over everything matched (before the cap).
            if (team) {
                const trades = rows.filter(r => r.type === 'trade' && r._rids.length === 2);
                if (trades.length) {
                    const rid = String(team.roster_id);
                    const rec = { won: 0, lost: 0, fair: 0 };
                    trades.forEach(r => { if (r._pct != null && r._pct <= 15) rec.fair++; else if (r._winner === rid) rec.won++; else if (r._winner != null) rec.lost++; else rec.fair++; });
                    out.trade_record_for_team = rec;
                }
                rows.forEach(r => { if (r.type === 'trade' && r._rids.length === 2) r.result_for_team = r._pct != null && r._pct <= 15 ? 'fair' : r._winner === String(team.roster_id) ? 'won' : r._winner ? 'lost' : 'fair'; });
            }
            out.rows = rows.slice(0, limit).map(strip);
            if (rows.length > limit) out.more = rows.length - limit;
            if (rows.some(r => r.type === 'trade')) notes.push('Trade values are today\'s DHQ values, not the values on the day of the trade. A trade within 15% is graded fair.');
            if (notes.length) out.notes = notes;
            return out;
        },
    });

    // ── What an owner is trying to do right now (owner ruling 2026-10-10) ──
    // "BWIT just traded significant assets for draft picks, threw a bunch of
    // starters on the block, and isn't winning. A rebuilding owner only takes
    // picks and young, up-and-coming players, not relics." The app's window
    // label alone said REBUILDING but the AI still pitched a 38-year-old QB.
    // This reads the evidence (record, this season's trades, the trade
    // block) into a plain mode, and prices every piece the way THAT owner
    // sees it. Rules are simple and stated, so the AI can explain them.
    const curSeason = () => String(h.season() || '');
    async function ownerIntent(r) {
        if (!r) return null;
        const rid = String(r.roster_id), A = assess(r.roster_id) || {}, st = r.settings || {};
        const wins = Number(st.wins) || 0, losses = Number(st.losses) || 0;
        const ev = [];
        // This season's trades: what came in and what went out.
        let picksIn = 0, picksOut = 0, valOut = 0, valIn = 0;
        const soldNames = [], boughtNames = [];
        try {
            const tx = await AT.run('get_transactions', { team: rid, type: 'trade', season: curSeason(), limit: 50 });
            (tx.rows || []).forEach(row => (row.sides || []).forEach(side => {
                const theirs = String(side.roster_id) === rid;
                const players = side.got_players || [], picks = side.got_picks || [];
                const v = players.reduce((n, x) => n + (Number(x.value) || 0), 0);
                if (theirs) { picksIn += picks.length; valIn += v; players.forEach(x => boughtNames.push(x.name)); }
                else { picksOut += picks.length; valOut += v; players.forEach(x => soldNames.push(x.name)); }
            }));
            if (picksIn || soldNames.length) ev.push('this season traded away ' + (soldNames.length ? soldNames.slice(0, 5).join(', ') : 'no players') + ' and took in ' + picksIn + ' draft pick' + (picksIn === 1 ? '' : 's') + (boughtNames.length ? ' plus ' + boughtNames.slice(0, 4).join(', ') : ''));
        } catch (e) { /* trades still loading */ }
        // The trade block: veterans listed means selling.
        let listed = [];
        try {
            const lg = h.league();
            const rows = lg ? await h.withTimeout(leaguePlayers(lg.league_id || lg.id), 8000, null) : null;
            listed = (rows || []).filter(x => x && x.settings && x.settings.otb && !String(x.player_id).includes(',') && String((rosterOf(String(x.player_id)) || {}).roster_id) === rid).map(x => String(x.player_id));
        } catch (e) { listed = []; }
        // A veteran by the position-aware cliffs (VET_AGE), not a flat 26+.
        const vetsListed = listed.filter(pid => isVet(h.ppos(pid), pl(pid).age) && value(pid) >= 800);
        if (listed.length) ev.push(listed.length + ' on the trade block (' + listed.slice(0, 6).map(pid => pname(pid) + ' ' + (pl(pid).age || '?')).join(', ') + ')' + (vetsListed.length ? '; veterans among them: ' + vetsListed.slice(0, 4).map(pname).join(', ') : ''));
        ev.push('record ' + wins + '-' + losses + (A.powerRank ? ', power rank ' + A.powerRank : '') + (A.window ? ', app window ' + String(A.window).toLowerCase() : '') + (A.panic != null ? ', panic ' + A.panic + '/5' : ''));
        // Mode. The rebuild evidence (selling players for picks, listing
        // veterans, losing) is read first and wins over panic: a losing team
        // that sells is rebuilding, not desperate (see postureFor).
        let mode = 'NEUTRAL';
        const sellingSignals = (picksIn >= 3 && valOut > valIn ? 2 : 0) + (vetsListed.length >= 2 ? 1 : 0) + (A.window === 'REBUILDING' ? 1 : 0) + (losses > wins + 1 ? 1 : 0);
        const buyingSignals = (picksOut >= 2 && valIn > valOut ? 2 : 0) + (A.window === 'CONTENDING' ? 1 : 0) + (wins > losses ? 1 : 0);
        if (sellingSignals >= 2 && sellingSignals > buyingSignals) mode = 'REBUILDING';
        else if (buyingSignals >= 2 && buyingSignals > sellingSignals) mode = 'CONTENDING';
        const wants = mode === 'REBUILDING' ? ['draft picks (the nearer the better)', 'young players (about 24 or under) and rising players with 3+ peak years left']
            : mode === 'CONTENDING' ? ['proven starters who score now', 'help at their weak spots: ' + ((A.needs || []).map(n => n.pos).join(', ') || 'none')]
            : ['fair value', 'help at their weak spots: ' + ((A.needs || []).map(n => n.pos).join(', ') || 'none')];
        const avoids = mode === 'REBUILDING' ? [VET_RULE + ': little to no use to them, however good this week']
            : mode === 'CONTENDING' ? ['far-off picks and long-term projects that don\'t score this season'] : [];
        return { team: label(r), mode, evidence: ev, wants, avoids, signals: { selling: sellingSignals, buying: buyingSignals }, _listed: listed, _vetsListed: vetsListed };
    }
    // How much one piece is worth TO a team in that mode, as a share of its
    // value: a rebuilder pays up for near picks and youth and pays almost
    // nothing for a veteran past his age cliff; a contender is the reverse.
    function appealFor(mode, x) {
        if (x.kind === 'faab') return { mult: 1, why: 'FAAB' };
        if (mode === 'REBUILDING') {
            if (x.kind === 'pick') {
                // Nearer picks matter more to a rebuild: next draft x1.15,
                // the one after x1.0, anything later x0.85.
                const ahead = (Number(x.year) || 0) - nextDraftYear();
                if (ahead <= 0) return { mult: 1.15, why: 'a pick in the next draft is exactly what a rebuild wants' };
                if (ahead === 1) return { mult: 1, why: 'a pick a year further out' };
                return { mult: 0.85, why: 'a far-off pick: a rebuild wants nearer ones' };
            }
            const pk = x.peak_years_left, age = Number(x.age) || 0;
            if (age && age <= 24) return { mult: 1.15, why: 'young (' + age + ')' };
            // Owner ruling 2026-10-10: "Jonathan Taylor still has lots of life."
            // A starter-level player (4,000+) with peak years left isn't a relic
            // to a rebuilder just because he crossed the age line.
            // (Peak-years data reads 0 for Taylor at 27, so this keys on value and
            // being AT the line, not past it: a 33-year-old QB isn't included.)
            if (isVet(x.pos, age) && x.value >= SCALE.STARTER && age <= vetAge(x.pos)) return { mult: 0.8, why: x.pos + ' at ' + age + ': at the usual age line, but still a top player with good years left' };
            if (isVet(x.pos, age)) {
                // Past the cliff: even with peak years on paper, little use to a rebuild.
                if (pk != null && pk >= 1) return { mult: 0.55, why: x.pos + ' at ' + age + ', past the age cliff (' + vetAge(x.pos) + '+); only ' + pk + ' peak year' + (pk === 1 ? '' : 's') + ' left' };
                if (pk == null && age < vetAge(x.pos) + 3) return { mult: 0.55, why: x.pos + ' at ' + age + ', past the age cliff (' + vetAge(x.pos) + '+)' };
                return { mult: 0.2, why: 'past his peak at ' + age + ': little use to a rebuild' };
            }
            if (pk == null || pk >= 3) return { mult: 1, why: 'still has peak years' };
            if (pk >= 1) return { mult: 0.55, why: 'only ' + pk + ' peak year' + (pk === 1 ? '' : 's') + ' left' };
            return { mult: 0.2, why: 'past his peak at ' + (age || '?') + ': little use to a rebuild' };
        }
        if (mode === 'CONTENDING') {
            if (x.kind === 'pick') return { mult: 0.8, why: 'a pick doesn\'t help them win now' };
            return { mult: 1, why: 'helps now if he starts for them' };
        }
        return { mult: 1, why: '' };
    }

    // ── evaluate_trade ─────────────────────────────────────────────
    // FAAB as a trade piece ("$250 FAAB"), at the Trade Room's rate (1 FAAB
    // dollar = 2 DHQ), so the builder and this evaluator price it the same.
    const FAAB_RATE = 2;
    function faabPiece(text) {
        const m = String(text || '').trim().match(/^\$\s*(\d+)(?:\s*faab)?$|^(\d+)\s*(?:\$\s*)?faab$/i);
        if (!m) return null;
        const d = Number(m[1] || m[2]);
        return d > 0 ? { kind: 'faab', label: '$' + d + ' FAAB', dollars: d, value: Math.round(d * FAAB_RATE) } : null;
    }
    function resolvePiece(text, holderHint) {
        const fb = faabPiece(text);
        if (fb) return fb;
        const pk = parsePick(text);
        if (pk) {
            const own = picksByOwner();
            let year = pk.year;
            if (!year) { const yrs = own ? [...new Set(Object.values(own).flat().map(x => x.year))].sort() : []; year = yrs[0] || (parseInt(season(), 10) || new Date().getFullYear()) + 1; }
            let from = pk.from;
            // No original owner named: the holder's own pick if they have it.
            if (from == null && holderHint && own) {
                const list = own[holderHint.roster_id] || [];
                const mineOrig = list.find(x => x.year === year && x.round === pk.round && String(x.originalOwnerRid) === String(holderHint.roster_id));
                const any = list.find(x => x.year === year && x.round === pk.round);
                // Neither: read it as their own original pick, so a pick
                // they already dealt away is flagged below.
                from = (mineOrig || any || {}).originalOwnerRid != null ? (mineOrig || any).originalOwnerRid : holderHint.roster_id;
            }
            return pickAsset(year, pk.round, from, own, pk.slot);
        }
        const f = findPlayer(text);
        if (!f) return null;
        return Object.assign(playerAsset(f.pid), { alternatives: f.alternatives });
    }
    // One pick as a trade piece. holder = the roster that verifiably holds
    // it in the ownership builder; null when ownership isn't loaded or the
    // pick isn't found (never assumed to be anyone's).
    function pickAsset(year, round, from, own, slot) {
        own = own === undefined ? picksByOwner() : own;
        const projected = slot == null ? projectedSlot(year, from) : null;
        const v = pickValue(year, round, slot != null ? slot : null, from);
        let holder = null;
        if (own && from != null) { for (const rid in own) if ((own[rid] || []).some(x => Number(x.year) === Number(year) && Number(x.round) === Number(round) && String(x.originalOwnerRid) === String(from))) { holder = rid; break; } }
        const sl = slot != null ? slot : projected;
        return {
            kind: 'pick', label: year + ' ' + roundName(round) + (sl ? ' (' + (slot != null ? '' : 'projected ') + round + '.' + String(sl).padStart(2, '0') + ')' : '') + (from == null ? '' : isMe(rosterById(from)) ? ' (own)' : ' (' + teamLabel(from) + '\'s)'),
            value: v, year: Number(year), round: Number(round), from, holder,
            slot_basis: slot != null ? 'slot given' : projected ? 'projected from current standings' : Number(year) === nextDraftYear() ? 'mid-round (no standings yet)' : 'mid-round (later draft)',
        };
    }
    function playerAsset(pid) {
        pid = String(pid);
        const m = meta(pid), r = rosterOf(pid);
        return { kind: 'player', pid, label: pname(pid), value: value(pid), pos: ppos(pid), age: pl(pid).age || null, peak_years_left: m.peakYrsLeft != null ? m.peakYrsLeft : undefined, injury: h.injury(pid) || undefined, owner_rid: r ? String(r.roster_id) : null };
    }
    const pieceOut = x => x.kind === 'player'
        ? { player: x.label, pos: x.pos, age: x.age, value: x.value, peak_years_left: x.peak_years_left, injury: x.injury, owner: x.owner_rid ? teamLabel(x.owner_rid) : 'free agent', also_matched: x.alternatives && x.alternatives.length ? x.alternatives : undefined }
        : { pick: x.label, value: x.value };
    // What one side's pieces do to a team: fills a need, or opens a hole.
    function fitFor(teamA, gets, gives) {
        if (!teamA) return null;
        const needs = (teamA.needs || []).map(n => n.pos), strengths = teamA.strengths || [];
        const pa = teamA.posAssessment || {};
        const lines = [];
        gets.filter(x => x.kind === 'player').forEach(x => { if (needs.includes(x.pos)) lines.push(x.label + ' fills a ' + x.pos + ' need'); else if (strengths.includes(x.pos)) lines.push(x.label + ' adds to a ' + x.pos + ' surplus'); });
        gives.filter(x => x.kind === 'player').forEach(x => {
            const p = pa[x.pos] || {};
            const starter = (p.nflStarterIds || []).map(String).includes(x.pid);
            if (needs.includes(x.pos)) lines.push('losing ' + x.label + ' deepens a ' + x.pos + ' hole');
            else if (starter && p.status !== 'surplus') lines.push('losing ' + x.label + ' costs a ' + x.pos + ' starter');
            else if (strengths.includes(x.pos)) lines.push(x.label + ' comes from a ' + x.pos + ' surplus');
        });
        const picksIn = gets.filter(x => x.kind === 'pick').length, picksOut = gives.filter(x => x.kind === 'pick').length;
        if (picksIn && teamA.window === 'REBUILDING') lines.push('picks suit a rebuild');
        if (picksOut && teamA.window === 'CONTENDING') lines.push('spending picks fits a contender');
        return lines;
    }

    // ── Shared trade logic (evaluate_trade and trade_plan) ─────────
    // The headliner rule (owner ruling 2026-10-10): "when people put young,
    // front-line QBs up for trade, they'll always want a 1st rounder
    // minimum." Quantity doesn't buy quality: a young starter costs one real
    // headline piece back. Who counts, on the one value scale (SCALE):
    //   - any player aged 28 or under worth 4,000+ (a starter), or
    //   - in superflex / 2QB, a QB aged 29 or under who starts for his NFL
    //     team (Sleeper depth chart #1) or is worth 4,000+.
    // A QB costs a 1st at minimum (two 1sts when elite, 7,000+, in
    // superflex; the old cut was 5,000, off the scale). Anyone else: a 1st,
    // or one young player (28 or under) worth 70%+ of him.
    function headlinerRuleFor(x) {
        if (!x || x.kind !== 'player') return null;
        const age = Number(x.age) || 99, sf = isSF(), qb = x.pos === 'QB';
        const nflStarter = Number(pl(x.pid).depth_chart_order) === 1;
        const anchor = (x.value >= SCALE.STARTER && age <= 28) || (qb && sf && age <= 29 && (nflStarter || x.value >= SCALE.STARTER));
        if (!anchor) return null;
        const firsts = qb && sf && x.value >= SCALE.ELITE ? 2 : 1;
        // Owner ruling 2026-10-10 (Love test): "A person rebuilding is not
        // going to trade a starting QB, like Jordan Love, who's young, for a
        // 1st rounder three years down the line. He may accept a first
        // rounder this year plus a little something something like a second
        // or a nice player." So the headline 1st is a NEXT-draft 1st; a 1st
        // one draft further out only counts with a real add; a rebuilder
        // doesn't count one two or more drafts out at all. A young starting
        // QB in superflex also needs that "little something" on top.
        const plus = qb && sf ? 1 : 0;
        const nd = nextDraftYear();
        const firstWords = firsts === 2 ? 'two ' + nd + ' 1sts' : 'a ' + nd + ' 1st';
        return {
            qb, sf, firsts, plus, next_draft: nd, young_player_min_value: Math.round(x.value * 0.7),
            needed: firstWords + (plus ? ' (a rebuilder also wants a 2nd or a solid young player on top)' : '') + (qb ? ', or a young QB of similar standing' : ', or one young player (28 or under) worth ' + Math.round(x.value * 0.7) + '+'),
            rule: (qb ? 'A young starting QB costs ' + firstWords + ' (the next draft)' + (plus ? ', and a rebuilder wants a little more on top, a 2nd or a solid young player,' : '') + (sf ? ' in a superflex league' : '') + ', or a young QB of similar standing.'
                : 'A young starter costs one real headline piece: ' + firstWords + ' (the next draft) or a young player worth about 70%+ of him. Several lesser pieces don\'t add up to one.')
                + ' A 1st a draft further out only counts with a real add; a rebuilder won\'t take one two or more drafts away as the headliner.',
        };
    }
    // Does a package meet that rule? Only 1sts the member verifiably holds
    // count: a pick whose holder is unknown (null) is NOT the member's.
    // A 1st's credit as the headline piece depends on how far off it is
    // (owner ruling above): next draft = full; one draft further = only
    // with a real add; two or more = none for a rebuilder, add-only for
    // anyone else.
    function headlinerMet(rule, target, give, meRid, mode) {
        const nd = nextDraftYear(), mine = x => x.kind === 'pick' && x.holder != null && String(x.holder) === String(meRid);
        const firsts = give.filter(x => mine(x) && x.round === 1);
        const ahead = x => (Number(x.year) || nd) - nd;
        const full = firsts.filter(x => ahead(x) <= 0);
        const later = firsts.filter(x => ahead(x) === 1 || (ahead(x) > 1 && mode !== 'REBUILDING'));
        const tooFar = firsts.filter(x => !full.includes(x) && !later.includes(x));
        const sweet = give.filter(x => (mine(x) && x.round === 2 && ahead(x) <= 1) || (x.kind === 'player' && x.value >= SCALE.DEPTH && !(mode === 'REBUILDING' && isVet(x.pos, x.age))));
        let spare = sweet.length, credit = full.length;
        later.forEach(() => { if (spare > 0) { credit++; spare--; } });
        const plus = mode === 'REBUILDING' ? (rule.plus || 0) : 0;
        const picksOk = credit >= rule.firsts && spare >= plus;
        const big = give.filter(x => x.kind === 'player').sort((p, q) => q.value - p.value)[0];
        // For a QB: a young QB of similar standing, or (owner ruling 2026-10-10)
        // one of the member's top players worth at least as much, with a pick.
        const topSwap = rule.qb && !!big && big.pos !== 'QB' && big.value >= target.value * 0.7 && (Number(big.age) || 99) <= 28 && give.some(mine);
        const playerOk = !!big && (Number(big.age) || 99) <= 28 && ((big.value >= target.value * 0.7 && (!rule.qb || big.pos === 'QB')) || topSwap);
        const ok = picksOk || playerOk;
        const notes = [];
        if (tooFar.length) notes.push(tooFar.map(x => x.label).join(' + ') + ' is too far off for a rebuilder to count as the headliner; it takes a ' + nd + ' 1st.');
        if (!ok && credit >= rule.firsts && plus) notes.push('The 1st is there; add a 2nd or a solid young player on top.');
        if (!ok && later.length && credit < rule.firsts) notes.push('A ' + later.map(x => x.year).join('/') + ' 1st needs a real add (a 2nd or a solid young player) to stand in for a ' + nd + ' 1st.');
        return { ok, firsts: firsts.length, via: picksOk ? firsts.concat(sweet).map(x => x.label).join(' + ') : playerOk ? big.label : null, notes };
    }
    // What one piece the partner gives up costs THEM, as they see it.
    // Bug fix 2026-10-10: a listed player is worth LESS to the owner who
    // listed him. The old Math.max(mult, 0.85) raised a listed veteran
    // from 0.2 to 0.85. Now Math.min: a listed piece takes 15% off, and a
    // listed veteran counts at most half his value.
    // Market floor (LAB243 review): a rebuilder has little USE for a veteran,
    // but he can still sell him to a contender at market, so what he gives
    // up is never below about 70% of the veteran's value (85% of that when
    // he listed him). Without the floor, a listed Josh Jacobs "cost" his
    // owner 17% of his value and a 24-year-old depth back read as a 95% deal.
    const LISTED_DISCOUNT = 0.85, VET_MARKET_FLOOR = 0.7;
    function costToOwner(mode, x, listed) {
        const ap = mode === 'REBUILDING' ? appealFor('REBUILDING', x) : { mult: 1, why: '' };
        const vet = x.kind === 'player' && isVet(x.pos, x.age);
        const base = vet && mode === 'REBUILDING' ? Math.max(ap.mult, VET_MARKET_FLOOR) : ap.mult;
        const mult = listed ? base * LISTED_DISCOUNT : base;
        return { cost: Math.round(x.value * mult), mult: Math.round(mult * 100) / 100, why: [ap.why, listed ? 'on their trade block, so they want him moved' : ''].filter(Boolean).join('; ') };
    }
    // Both sides of a deal priced the way the partner sees them.
    function priceDeal(intent, give, get) {
        const mode = intent ? intent.mode : 'NEUTRAL', listed = new Set(intent ? intent._listed : []);
        const priced = give.map(x => { const ap = appealFor(mode, x); return { piece: x.label, value: x.value, worth_to_them: Math.round(x.value * ap.mult), why: ap.why || undefined }; });
        const toThem = priced.reduce((n, x) => n + x.worth_to_them, 0);
        const theirCost = get.reduce((n, x) => n + costToOwner(mode, x, !!x.pid && listed.has(x.pid)).cost, 0);
        return { priced, toThem, theirCost, ratio: theirCost > 0 ? toThem / theirCost : 1 };
    }
    // A rebuilder balances by adding veterans it wants gone (its trade
    // block first), never picks.
    function theirVetsToShed(partner, intent, exclude, gap) {
        const listedSet = new Set(intent ? intent._listed : []);
        return (partner.players || []).map(String).filter(pid => !exclude.has(pid))
            .filter(pid => { const m = meta(pid); return value(pid) > 0 && ((m.peakYrsLeft != null && m.peakYrsLeft <= 1) || isVet(ppos(pid), pl(pid).age)); })
            .map(pid => ({ pid, v: value(pid), listed: listedSet.has(pid) }))
            .sort((x, y) => (y.listed - x.listed) || Math.abs(x.v - gap) - Math.abs(y.v - gap)).slice(0, 4)
            .map(x => pname(x.pid) + ' (' + ppos(x.pid) + ', ' + (pl(x.pid).age || '?') + ', value ' + x.v + (x.listed ? ', on their block' : '') + ')');
    }
    const MODE_WORD = { REBUILDING: 'rebuilding', CONTENDING: 'contending', NEUTRAL: 'middle' };
    // One verdict out of the signals, in a fixed order of precedence:
    // ownership > headliner > what the partner wants > raw value. The raw
    // value grade can never overrule the headliner ("not an overpay").
    function reconcile(o) {
        const r = o.tt / Math.max(o.tg, 1);
        let decision, call;
        let market = o.headliner && o.headliner.ok ? 'At market: the headliner is the going rate, not an overpay'
            : r >= 1.15 ? 'You win on value' : r >= 0.95 ? 'Fair value' : r >= 0.85 ? 'Slight overpay' : 'Overpay';
        const who = o.partnerName || 'them';
        if (o.ownIssues.length) { decision = 'pass'; call = 'You can\'t send this as written: ' + o.ownIssues.join(' '); }
        else if (o.headliner && !o.headliner.ok) { decision = 'counter'; market = 'Below the going rate'; call = 'Missing the headliner. ' + o.headliner.rule + ' Lead with that piece, then balance.'; }
        else if (o.pv && o.pv.ratio < 0.8) { decision = 'counter'; call = 'Not appealing to ' + who + ' (' + MODE_WORD[o.mode] + '): your side is worth about ' + o.pv.toThem + ' to them against ' + o.pv.theirCost + ' for what they give up. Rebuild it around what they want.'; }
        else if (!o.headliner && r < 0.85) { decision = 'counter'; call = 'You give up more than you get (' + o.tg + ' for ' + o.tt + '). Trim what you send.'; }
        else if (o.pv && o.pv.ratio < 0.95) { decision = 'offer'; call = 'Close: send it, and be ready to add a small piece of the kind ' + who + ' values.'; }
        else { decision = 'offer'; call = o.headliner ? 'Send it: it meets the going rate for a young starter.' : 'Send it: it works for both sides.'; }
        if (decision === 'offer' && o.accept != null && o.accept < 20) { decision = 'counter'; call = 'The value works on paper, but ' + who + ' is unlikely to take it (about ' + o.accept + '%). Add a piece of the kind they value, or look elsewhere.'; }
        return { decision, call, market_label: market };
    }
    const confidenceOf = o => (!o.partnerKnown || o.unknownHolders) ? 'low' : (o.mode === 'NEUTRAL' || !o.engine || !o.picksLoaded) ? 'medium' : 'high';

    // evaluate_trade's whole body. `intentFor(partnerRoster)` returns the
    // partner's ownerIntent (a promise): the tool reads it fresh; the batch
    // entry below (evaluateDeals) reads it once per partner. Nothing else
    // differs, so the Trade Finder's list and the tool can never disagree.
    async function evaluateTrade(a, intentFor) {
            const me = myRoster();
            if (!me) throw new Error('League not loaded yet.');
            const giveIn = [].concat(a.give || []).map(String).filter(Boolean), getIn = [].concat(a.get || []).map(String).filter(Boolean);
            if (!giveIn.length || !getIn.length) throw new Error('Name both sides of the trade: what you give and what you get.');
            let partner = a.partner ? findTeam(a.partner) : null;
            if (a.partner && !partner) throw new Error('No team in this league matches "' + a.partner + '".');
            const notFound = [];
            const give = giveIn.map(t => { const x = resolvePiece(t, me); if (!x) notFound.push(t); return x; }).filter(Boolean);
            // Partner from what I get, before resolving their picks.
            if (!partner) {
                const firstPlayer = getIn.map(t => (parsePick(t) ? null : findPlayer(t))).find(Boolean);
                const r = firstPlayer ? rosterOf(firstPlayer.pid) : null;
                if (r && !isMe(r)) partner = r;
            }
            const get = getIn.map(t => { const x = resolvePiece(t, partner); if (!x) notFound.push(t); return x; }).filter(Boolean);
            if (!partner) { const pk = get.find(x => x.kind === 'pick' && x.holder != null && String(x.holder) !== String(me.roster_id)); if (pk) partner = rosterById(pk.holder); }
            if (!give.length || !get.length) throw new Error('Couldn\'t match: ' + notFound.join(', ') + '. Use full player names or picks like "2027 1st".');

            const tg = give.reduce((s, x) => s + x.value, 0), tt = get.reduce((s, x) => s + x.value, 0);
            const E = TE();
            const fair = E && E.fairnessGrade ? E.fairnessGrade(tg, tt) : null;
            // ONE reading of the other owner (ownerIntent) feeds the mode,
            // the posture, the pricing and the windows line; the app's
            // window is part of its evidence, not a second opinion.
            const intent = partner ? await intentFor(partner) : null;
            const read = dealRead(me, partner, tg, tt, give.length + get.length, intent);
            const mineA = read._mineA || assess(me.roster_id), theirA = partner ? (read._theirA || assess(partner.roster_id)) : null;
            const warnings = [], ownIssues = [];
            let unknownHolders = false;
            give.forEach(x => {
                if (x.kind === 'player' && x.owner_rid !== String(me.roster_id)) ownIssues.push('You don\'t own ' + x.label + '.');
                if (x.kind === 'pick' && x.holder != null && String(x.holder) !== String(me.roster_id)) ownIssues.push('You don\'t own ' + x.label + '; ' + teamLabel(x.holder) + ' does.');
                if (x.kind === 'pick' && x.holder == null) { unknownHolders = true; warnings.push('Couldn\'t confirm you own ' + x.label + ' (pick ownership not loaded, or no such pick); it does not count as yours.'); }
            });
            warnings.push(...ownIssues);
            if (partner) get.forEach(x => { if (x.kind === 'player' && x.owner_rid !== String(partner.roster_id)) warnings.push(x.label + ' is not on ' + label(partner) + ' (' + (x.owner_rid ? teamLabel(x.owner_rid) : 'free agent') + ').'); if (x.kind === 'pick' && x.holder != null && String(x.holder) !== String(partner.roster_id)) warnings.push(x.label + ' belongs to ' + teamLabel(x.holder) + ', not ' + label(partner) + '.'); });
            const net = tt - tg;
            // The other owner's side of it: their mode, and what my package
            // is worth to them (owner ruling 2026-10-10). Acceptance runs on
            // those numbers, so overpaying in pieces they don't want doesn't
            // raise it.
            let partnerView = null, acceptPct = read.accept_pct, pv = null;
            if (partner && intent) {
                pv = priceDeal(intent, give, get);
                const extraPlayers = Math.max(0, give.filter(x => x.kind === 'player').length - get.filter(x => x.kind === 'player').length);
                acceptPct = acceptFor(read, pv.toThem, pv.theirCost, give.length + get.length, extraPlayers);
                partnerView = {
                    their_mode: intent.mode, evidence: intent.evidence, they_want: intent.wants, they_avoid: intent.avoids.length ? intent.avoids : undefined,
                    your_package_to_them: pv.priced, worth_to_them: pv.toThem, what_they_give_up_as_they_see_it: pv.theirCost,
                    verdict: pv.ratio >= 1 ? 'appealing to them' : pv.ratio >= 0.8 ? 'close, they may want a sweetener of the kind they value' : 'not appealing to them: rebuild the offer around what they want',
                    listed_by_them: get.filter(x => x.pid && intent._listed.includes(x.pid)).map(x => x.label + ' is on their trade block'),
                };
                if (!partnerView.listed_by_them.length) delete partnerView.listed_by_them;
            }
            // The headliner rule (see headlinerRuleFor).
            const anchors = get.map(x => ({ x, rule: headlinerRuleFor(x) })).filter(o => o.rule).sort((p, q) => q.x.value - p.x.value);
            let headliner = null;
            if (anchors.length) {
                const top = anchors[0].x, rule = anchors[0].rule;
                const met = headlinerMet(rule, top, give, me.roster_id, intent ? intent.mode : 'NEUTRAL');
                headliner = { target: top.label + ' (' + top.pos + ', ' + (top.age || '?') + ', value ' + top.value + ')', rule: rule.rule, offer_has_it: met.ok, via: met.via || undefined, notes: met.notes.length ? met.notes : undefined };
                if (!met.ok) {
                    if (acceptPct != null) acceptPct = Math.min(acceptPct, 10);
                    warnings.push('No headliner: ' + rule.rule + ' This offer won\'t start the conversation.');
                } else {
                    // Owner test 2026-10-10: a 1st for a young starting QB was
                    // called "a slight overpay" because the pick's number is a
                    // bit higher. The headliner is the market floor, not a premium.
                    headliner.market = 'This is the going rate: the headliner is the floor for a young starter. A value gap of this size is not an overpay to be clawed back.';
                }
            }
            // How a deal gets balanced (owner test 2026-10-10: the AI asked a
            // rebuilder to "add one of their own picks" back). A rebuilding
            // seller never gives picks back; they balance by adding veterans
            // they want gone (their trade block first). A contender balances
            // with picks or depth. When the headliner is met there is no gap
            // to claw back (only an optional throw-in); when it is missing,
            // the fix is the headliner, not balance.
            let balance = null;
            if (partner && partnerView && net < 0 && !(headliner && !headliner.offer_has_it)) {
                const gap = Math.abs(net);
                const rebuilding = intent.mode === 'REBUILDING';
                const exclude = new Set(get.map(x => x.pid).filter(Boolean));
                // Owner ruling 2026-10-10: at market there's nothing to balance,
                // and optional throw-ins only add noise to the answer.
                if (headliner && headliner.offer_has_it) {
                    balance = null;
                } else if (rebuilding) {
                    balance = { you_overpay_by: gap, how: 'A rebuilder won\'t give picks back. Ask them to add a veteran they want gone, ideally one from their trade block:', options: theirVetsToShed(partner, intent, exclude, gap) };
                } else {
                    balance = { you_overpay_by: gap, how: 'Ask for a pick or a depth player back, or trim what you send.' };
                }
            }
            const v = reconcile({ ownIssues, headliner: headliner ? { ok: headliner.offer_has_it, rule: headliner.rule } : null, pv, mode: intent ? intent.mode : 'NEUTRAL', tg, tt, accept: acceptPct, partnerName: partner ? label(partner) : null });
            const out = {
                verdict: {
                    decision: v.decision, confidence: confidenceOf({ partnerKnown: !!partner, unknownHolders, mode: intent ? intent.mode : 'NEUTRAL', engine: !!E, picksLoaded: !!picksByOwner() }),
                    call: v.call, market_label: v.market_label, accept_chance_pct: acceptPct,
                    partner_mode: intent ? MODE_WORD[intent.mode] : null,
                    precedence: 'ownership > headliner > what the partner wants > raw value. The grade below is raw value only and never overrules this.',
                },
                headliner: headliner || undefined,
                balance: balance || undefined,
                you_give: give.map(pieceOut), you_get: get.map(pieceOut),
                totals: { give: tg, get: tt, net_for_you: net, net_pct: round1(net / Math.max(tg, tt, 1) * 100) },
                grade: fair ? { grade: fair.grade, label: fair.label, basis: 'raw value totals only; see verdict' } : null,
                partner: partner ? label(partner) : null,
                accept_chance_pct: acceptPct,
                accept_chance_on_value_only_pct: acceptPct !== read.accept_pct ? read.accept_pct : undefined,
                partner_view: partnerView || undefined,
                partner_dna: read.dna, partner_posture: read.posture,
                my_team: assessSummary(mineA), their_team: assessSummary(theirA),
                fit: { for_me: fitFor(mineA, get, give), for_them: theirA ? fitFor(theirA, give, get) : null },
                psychology: read.psychology,
            };
            if (mineA && intent) out.windows = (mineA.window === 'CONTENDING' && intent.mode === 'REBUILDING') || (mineA.window === 'REBUILDING' && intent.mode === 'CONTENDING') ? 'opposite windows: a natural fit' : mineA.window === intent.mode ? 'same window: less natural motivation' : 'mixed';
            if (warnings.length) out.warnings = warnings;
            if (notFound.length) out.not_found = notFound;
            if (!E) out.note = 'The trade engine is still loading, so there is no grade yet; the acceptance chance uses the plain value curve.';
            out.values_note = SCALE_NOTE + ' A pick in the next draft is priced at its projected slot from current standings with no year discount; later drafts are mid-round, less 12% a year.';
            return out;
    }

    AT.register({
        name: 'evaluate_trade',
        description: 'Grade a proposed trade. Read `verdict` first: one decision (offer / counter / pass) that already reconciles the headliner rule, what this partner wants, and value. Also: DHQ value of every player and pick on both sides, the value-only grade, the chance the other owner accepts, their mode, DNA and posture, roster fit and psychology. Picks read like "2027 1st" or "2026 1.03". To BUILD an offer, use trade_plan.',
        parameters: {
            type: 'object',
            properties: {
                give: { type: 'array', items: { type: 'string' }, description: 'Players or picks I give.' },
                get: { type: 'array', items: { type: 'string' }, description: 'Players or picks I get.' },
                partner: { type: 'string', description: 'The other team (default: whoever owns what I get).' },
            },
            required: ['give', 'get'],
        },
        run(a) { return evaluateTrade(a, ownerIntent); },
    });

    // ── Many deals at once (the Trade Finder's list) ───────────────
    // evaluateDeals([{ give, get, partner }, ...]) → one evaluate_trade
    // result per deal, in order ({ error } for a deal it can't read). Same
    // code path as the tool (evaluateTrade); the only difference is that
    // each partner's ownerIntent (the trade-block fetch + this season's
    // trades) is read ONCE for the whole batch. Yields to the page every
    // few deals so a long list never blocks it.
    async function evaluateDeals(list, opts) {
        const deals = Array.isArray(list) ? list : [];
        const every = Math.max(1, Number(opts && opts.yieldEvery) || 8);
        const intents = new Map();
        const intentFor = r => {
            const k = String(r.roster_id);
            if (!intents.has(k)) intents.set(k, ownerIntent(r));
            return intents.get(k);
        };
        const out = [];
        for (let i = 0; i < deals.length; i++) {
            try { out.push(await evaluateTrade(deals[i] || {}, intentFor)); } catch (e) { out.push({ error: String((e && e.message) || e) }); }
            if (i % every === every - 1 && i < deals.length - 1) await new Promise(r => setTimeout(r, 0));
        }
        return out;
    }
    AT.evaluateDeals = evaluateDeals;

    // ── Sorting a candidate list by the shared call (pure) ─────────
    // The Trade Finder generates candidates; this decides which survive and
    // in what order, from each candidate's evaluate_trade `verdict`:
    //   - decision 'pass' (an ownership problem) or no verdict: dropped.
    //   - 'offer' at or above the member's acceptance bar: actionable.
    //   - any other 'offer', and a 'counter' at or above the moonshot line:
    //     a moonshot.
    //   - a 'counter' below the line: dropped (the call itself says the
    //     owner is unlikely to take it).
    // Order: shared acceptance (high first), then the caller's own
    // tie-break (its fit/value ranking), then input order.
    // MOONSHOT_LINE is reconcile's "unlikely to take it" threshold (20%).
    const MOONSHOT_LINE = 20;
    function triageByVerdict(items, opts) {
        const o = opts || {};
        const bar = Number.isFinite(Number(o.bar)) ? Number(o.bar) : 75;
        const line = Number.isFinite(Number(o.moonshotLine)) ? Number(o.moonshotLine) : MOONSHOT_LINE;
        const verdictOf = typeof o.verdictOf === 'function' ? o.verdictOf : x => (x && x.verdict) || null;
        const tie = typeof o.tieBreak === 'function' ? o.tieBreak : () => 0;
        const actionable = [], moonshots = [], dropped = [];
        (items || []).forEach((item, idx) => {
            const v = verdictOf(item);
            const acc = v && Number.isFinite(Number(v.accept_chance_pct)) ? Number(v.accept_chance_pct) : null;
            const row = { item, idx, acc: acc == null ? -1 : acc };
            if (!v || !v.decision || v.decision === 'pass') { dropped.push(Object.assign(row, { reason: v ? 'pass' : 'no verdict' })); return; }
            if (v.decision === 'offer' && acc != null && acc >= bar) { actionable.push(row); return; }
            if (v.decision === 'offer' || (v.decision === 'counter' && acc != null && acc >= line)) { moonshots.push(row); return; }
            dropped.push(Object.assign(row, { reason: 'counter below ' + line + '%' }));
        });
        const order = (p, q) => q.acc - p.acc || tie(p.item, q.item) || p.idx - q.idx;
        actionable.sort(order); moonshots.sort(order);
        const pick = rows => rows.map(r => r.item);
        return { actionable: pick(actionable), moonshots: pick(moonshots), dropped: dropped.map(r => ({ item: r.item, reason: r.reason })), bar, moonshotLine: line };
    }
    AT.triageByVerdict = triageByVerdict;

    // ── trade_plan (verdict first) ─────────────────────────────────
    // One coherent answer for "how do I get X" / "what can I do with Y":
    // the partner's mode with evidence, what I own (and only that), the
    // going rate, up to three offers built from my assets and priced the
    // way the partner sees them, and what not to offer. Same rules as
    // evaluate_trade (shared helpers above), so the two never disagree.
    const pieceKey = x => x.kind === 'pick' ? 'pk:' + x.year + ':' + x.round + ':' + x.from : 'pl:' + x.pid;
    const pieceName = x => x.kind === 'pick' ? x.label : x.label + ' (' + x.pos + ', ' + (x.age || '?') + ')';
    // Ids for an offer's pieces, for app callers (the Trade Finder loads
    // offers into its own deal shape). Non-enumerable, so the tool's answer
    // to the AI reads exactly as before.
    const pieceId = x => x.kind === 'pick' ? { kind: 'pick', year: x.year, round: x.round, from: x.from } : x.kind === 'faab' ? { kind: 'faab', dollars: x.dollars } : { kind: 'player', pid: x.pid };
    const withPieceIds = (out, give, get) => Object.defineProperty(out, 'piece_ids', { value: { give: give.map(pieceId), get: get.map(pieceId) }, enumerable: false });
    async function comparablesFor(target, partner) {
        try {
            const tx = await AT.run('get_transactions', { type: 'trade', season: curSeason(), limit: 50 });
            const pLabel = label(partner);
            const near = row => target && target.kind === 'player' && (row.sides || []).some(s => (s.got_players || []).some(p => p.pos === target.pos && p.value >= target.value * 0.6 && p.value <= target.value * 1.4));
            return (tx.rows || []).filter(r => near(r) || (r.teams || []).includes(pLabel)).slice(0, 3)
                .map(r => ({ date: r.date, sides: (r.sides || []).map(s => ({ team: s.team, got: [...(s.got_players || []).map(p => p.name + ' (' + p.pos + ', ' + p.value + ')'), ...(s.got_picks || [])] })) }));
        } catch (e) { return []; }
    }
    AT.register({
        name: 'trade_plan',
        description: 'START HERE before proposing any trade. One verdict for getting a player (or dealing with a team): decision (offer / tough / counter / pass / no_fit; tough = possible but costly or a stretch) and one plain recommendation; the partner\'s likely mode (rebuilding / contending / middle), read from their moves, with evidence, what they want and won\'t take; the going rate for the target; up to 3 offers built ONLY from what I own, each with its acceptance chance; and what not to offer and why. Optionally pass a package I\'m considering to check and improve it.',
        parameters: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'The player (or pick) I want, e.g. "Jordan Love". Default: the best player on the partner\'s trade block.' },
                partner: { type: 'string', description: 'The other team or owner (default: whoever has the target).' },
                give: { type: 'array', items: { type: 'string' }, description: 'Optional: a package I\'m thinking of sending, to check it.' },
            },
        },
        timeoutMs: 20000,
        async run(a) {
            const me = myRoster();
            if (!me) throw new Error('League not loaded yet.');
            const meRid = String(me.roster_id);
            let partner = a.partner ? findTeam(a.partner) : null;
            if (a.partner && !partner) throw new Error('No team in this league matches "' + a.partner + '".');
            if (partner && isMe(partner)) throw new Error('That\'s your own team; name the other owner.');
            // The target, and from it the partner.
            let target = null;
            if (a.target) {
                target = resolvePiece(a.target, partner);
                if (!target) throw new Error('No player or pick matches "' + a.target + '".');
                if (target.kind === 'player') {
                    if (target.owner_rid === meRid) throw new Error(target.label + ' is already yours.');
                    if (!target.owner_rid) throw new Error(target.label + ' is a free agent: no trade needed.');
                    if (partner && String(partner.roster_id) !== target.owner_rid) throw new Error(target.label + ' is on ' + teamLabel(target.owner_rid) + ', not ' + label(partner) + '.');
                    partner = partner || rosterById(target.owner_rid);
                } else {
                    if (target.holder == null) throw new Error('Couldn\'t confirm who holds ' + target.label + ' (pick ownership not loaded).');
                    if (String(target.holder) === meRid) throw new Error('You already hold ' + target.label + '.');
                    if (partner && String(partner.roster_id) !== String(target.holder)) throw new Error(target.label + ' belongs to ' + teamLabel(target.holder) + ', not ' + label(partner) + '.');
                    partner = partner || rosterById(target.holder);
                }
            }
            if (!partner) throw new Error('Name the player you want (target) or the team to deal with (partner).');
            const intent = await ownerIntent(partner);
            const mode = intent.mode, listed = new Set(intent._listed);
            const read = dealRead(me, partner, 0, 0, 0, intent);
            const evidence = [];
            if (!target) {
                const best = (partner.players || []).map(String).filter(pid => listed.has(pid)).map(playerAsset).filter(x => x.value > 0).sort((p, q) => q.value - p.value)[0];
                if (best) { target = best; evidence.push('No target named: using ' + best.label + ', the most valuable player on ' + label(partner) + '\'s trade block.'); }
            }

            // What I own: roster players, and picks the ownership builder
            // says I hold. Nothing else is ever offered.
            const own = picksByOwner();
            const picksLoaded = !!own;
            const withAppeal = x => { const ap = appealFor(mode, x); return Object.assign({}, x, { to_them: Math.round(x.value * ap.mult), mult: ap.mult, why: ap.why }); };
            const myPlayers = (me.players || []).map(String).map(playerAsset).filter(x => x.value > 0);
            const myPicks = own ? (own[me.roster_id] || own[meRid] || []).map(p => pickAsset(p.year, p.round, p.originalOwnerRid, own)).filter(p => String(p.holder) === meRid) : [];
            const assets = [...myPlayers, ...myPicks].map(withAppeal);
            const myFirstsAll = assets.filter(x => x.kind === 'pick' && x.round === 1);
            evidence.push(...intent.evidence);
            if (target && target.pid && listed.has(target.pid)) evidence.push(target.label + ' is on their trade block.');
            evidence.push(picksLoaded ? 'You hold ' + myFirstsAll.length + ' 1st-round pick' + (myFirstsAll.length === 1 ? '' : 's') + (myFirstsAll.length ? ': ' + myFirstsAll.map(x => x.label).join(', ') : '') + '.' : 'Pick ownership is not loaded, so no picks are offered.');

            // What not to offer.
            const doNot = [], dnoKeys = new Set();
            const addDno = (key, asset, reason) => { if (dnoKeys.has(key)) return; dnoKeys.add(key); doNot.push({ asset, reason }); };
            const relic = x => mode === 'REBUILDING' && x.mult <= 0.55;
            const lowLiquidity = x => x.kind === 'player' && /^(K|DEF)$/.test(x.pos);
            let userGive = null;
            const userIssues = [];
            if ([].concat(a.give || []).filter(Boolean).length) {
                userGive = [];
                [].concat(a.give).map(String).filter(Boolean).forEach(t => {
                    const x = resolvePiece(t, me);
                    if (!x) { addDno('t:' + t, t, 'couldn\'t match it to a player or pick'); userIssues.push(t + ' (not found)'); return; }
                    if (x.kind === 'player' && x.owner_rid !== meRid) { addDno(pieceKey(x), x.label, 'not yours' + (x.owner_rid ? ': ' + teamLabel(x.owner_rid) + ' has him' : ': a free agent')); userIssues.push(x.label + ' is not yours'); return; }
                    if (x.kind === 'pick' && (x.holder == null || String(x.holder) !== meRid)) { addDno(pieceKey(x), x.label, x.holder == null ? 'can\'t confirm you own it (pick ownership not loaded, or no such pick)' : 'not yours: ' + teamLabel(x.holder) + ' holds it'); userIssues.push(x.label + ' is not yours'); return; }
                    const w = withAppeal(x);
                    if (relic(w)) addDno(pieceKey(w), pieceName(w), w.why + ' (worth about ' + w.to_them + ' to them, not ' + w.value + ')');
                    if (lowLiquidity(w)) addDno(pieceKey(w), pieceName(w), 'kickers and defenses don\'t move trades');
                    userGive.push(w);
                });
            }
            assets.filter(x => relic(x) && x.value >= SCALE.DEPTH / 2).sort((p, q) => q.value - p.value).slice(0, 6)
                .forEach(x => addDno(pieceKey(x), pieceName(x), x.why + ' (worth about ' + x.to_them + ' to them, not ' + x.value + ')'));

            const partnerOut = {
                name: label(partner), mode: MODE_WORD[mode], why: intent.evidence, wants: intent.wants,
                wont_take: [...intent.avoids, ...assets.filter(x => relic(x) && x.value >= SCALE.DEPTH / 2).sort((p, q) => q.value - p.value).slice(0, 4).map(x => 'your ' + pieceName(x))],
                posture: read.posture ? read.posture.label : undefined, dna: read.dna ? read.dna.label : undefined,
            };
            const myAssetsOut = {
                picks: myPicks.map(withAppeal).sort((p, q) => p.year - q.year || p.round - q.round).map(x => ({ pick: x.label, year: x.year, round: x.round, original_owner: x.from != null ? teamLabel(x.from) : null, value: x.value, value_to_them: x.to_them, slot_basis: x.slot_basis })),
                players: myPlayers.map(withAppeal).sort((p, q) => q.value - p.value).slice(0, 15).map(x => ({ player: x.label, pos: x.pos, age: x.age, value: x.value, value_to_them: x.to_them, why: x.why || undefined })),
                more_players: Math.max(0, myPlayers.length - 15) || undefined,
                picks_note: picksLoaded ? undefined : 'Pick ownership is not loaded yet; no picks are listed or offered.',
            };
            const rulesApplied = [
                'Partner mode read once (record, this season\'s trades, trade block); the app window is evidence only. A rebuild read wins over panic.',
                'Only assets you verifiably own are listed or offered; a pick with an unknown holder is not yours.',
                'Pieces priced as the partner sees them. A rebuilder: next-draft picks x1.15, the draft after x1.0, later x0.85; players 24 or under x1.15; ' + VET_RULE + ' x0.55 or x0.2.',
                'A listed player costs his owner 15% less; a listed veteran at most half his value.',
                'Next draft: slot projected from current standings (worst team picks 1st), no year discount; later drafts mid-round, less 12% a year.',
                'Acceptance is estimated on value to them, minus 8 points per extra player they must roster; capped at 10% without the headliner.',
                'A rebuilder never gives picks back: balance with veterans they want gone.',
            ];
            const method = 'Read the partner, price each of your assets the way they see it, set the going rate for the target (headliner rule), build offers only from what you own, estimate acceptance on what they value. Precedence: ownership > headliner > what the partner wants > raw value.';
            const base = { partner: partnerOut, my_assets: myAssetsOut };

            if (!target) {
                return Object.assign({ decision: 'no_fit', confidence: 'medium', recommendation: label(partner) + ' has nothing on their trade block; name the player you want from them.' }, base, { price_floor: null, offers: [], do_not_offer: doNot, comparables: await comparablesFor(null, partner), evidence, rules_applied: rulesApplied, method, values_note: SCALE_NOTE });
            }

            // The going rate.
            const rule = headlinerRuleFor(target);
            const tCost = costToOwner(mode, target, !!target.pid && listed.has(target.pid));
            const priceFloor = {
                target: target.label + (target.kind === 'player' ? ' (' + target.pos + ', ' + (target.age || '?') + ', value ' + target.value + ')' : ' (value ' + target.value + ')'),
                headliner_needed: rule ? rule.needed : 'none: not a young front-line starter',
                rule: rule ? rule.rule : 'Not a young front-line starter: match what he is worth to them.',
                their_price: tCost.cost, their_price_why: tCost.why || undefined,
                note: rule ? 'Meeting the headliner is the going rate, not an overpay.' : undefined,
            };
            if (rule) rulesApplied.unshift(rule.rule);

            // Offers, from my assets only.
            const pool = assets.filter(x => !relic(x) && !lowLiquidity(x) && x.to_them >= 150);
            const score = (pieces, tag) => {
                const pv = priceDeal(intent, pieces, [target]);
                const hl = rule ? headlinerMet(rule, target, pieces, meRid, mode) : null;
                const extra = Math.max(0, pieces.filter(p => p.kind === 'player').length - (target.kind === 'player' ? 1 : 0));
                let acc = acceptFor(read, pv.toThem, pv.theirCost, pieces.length + 1, extra);
                if (hl && !hl.ok) acc = Math.min(acc, 10);
                const rawGive = pieces.reduce((n, x) => n + x.value, 0);
                let balance;
                if (!(hl && hl.ok) && pv.toThem > pv.theirCost * 1.35) {
                    if (mode === 'REBUILDING') { const opts = theirVetsToShed(partner, intent, new Set([target.pid].filter(Boolean)), pv.toThem - pv.theirCost); if (opts.length) balance = { optional: true, ask_them_to_add: opts, never: 'Don\'t ask a rebuilder for picks back.' }; }
                    else balance = { optional: true, ask_for: 'a pick or a depth player back, or trim what you send' };
                }
                const v = reconcile({ ownIssues: [], headliner: hl ? { ok: hl.ok, rule: rule.rule } : null, pv, mode, tg: rawGive, tt: target.value, accept: acc, partnerName: label(partner) });
                return {
                    tag, pieces, pv, hl, acc, rawGive,
                    out: withPieceIds({
                        give: pieces.map(pieceName), get: [target.label],
                        accept_chance_pct: acc, headliner_met: hl ? hl.ok : undefined, market_label: v.market_label,
                        value_you_send: rawGive, value_you_get: target.value, worth_to_them: pv.toThem, their_price: pv.theirCost,
                        why: tag + '. Worth about ' + pv.toThem + ' to a ' + MODE_WORD[mode] + ' owner against ' + pv.theirCost + ' for ' + target.label + ' as they see him. ' + pv.priced.map(p => p.piece + ': ' + (p.why || 'full value')).join('; ') + '.',
                        balance,
                    }, pieces, [target]),
                };
            };
            const fill = basePieces => {
                const pieces = basePieces.slice(), used = new Set(pieces.map(pieceKey));
                const gap = () => tCost.cost - pieces.reduce((n, x) => n + x.to_them, 0);
                while (gap() > 0 && pieces.length < 3) {
                    const cands = pool.filter(x => !used.has(pieceKey(x)));
                    if (!cands.length) break;
                    const g = gap();
                    const next = cands.filter(x => x.to_them >= g).sort((p, q) => p.to_them - q.to_them)[0] || cands.sort((p, q) => q.to_them - p.to_them)[0];
                    pieces.push(next); used.add(pieceKey(next));
                }
                return pieces;
            };
            const bases = [];
            if (rule) {
                // A rebuilder wants the nearest 1st; anyone else, the cheapest that does the job.
                const firsts = pool.filter(x => x.kind === 'pick' && x.round === 1).sort(mode === 'REBUILDING' ? (p, q) => q.to_them - p.to_them : (p, q) => p.value - q.value);
                if (firsts.length >= rule.firsts) {
                    bases.push({ tag: 'Leads with ' + (rule.firsts === 2 ? 'two 1sts' : 'a 1st') + ', the headliner ' + (rule.qb ? 'a young starting QB needs' : 'a young starter needs'), base: firsts.slice(0, rule.firsts) });
                    if (firsts.length > rule.firsts) bases.push({ tag: 'Leads with a different 1st', base: firsts.slice(1, 1 + rule.firsts) });
                    // The "little something" on top: the nearest 2nd, or a solid young player they'd want.
                    const sweets = pool.filter(x => (x.kind === 'pick' && x.round === 2) || (x.kind === 'player' && x.value >= SCALE.DEPTH && !(mode === 'REBUILDING' && isVet(x.pos, x.age))))
                        .sort((p, q) => (Number(p.year) || 9999) - (Number(q.year) || 9999) || q.to_them - p.to_them).slice(0, 2);
                    sweets.forEach(sw => bases.push({ tag: 'A 1st plus ' + (sw.kind === 'pick' ? 'a 2nd' : 'a solid young player'), base: firsts.slice(0, rule.firsts).concat([sw]) }));
                }
                const heads = pool.filter(x => x.kind === 'player' && x.value >= target.value * 0.7 && (Number(x.age) || 99) <= 28 && (!rule.qb || x.pos === 'QB')).sort((p, q) => p.value - q.value);
                if (heads[0]) bases.push({ tag: 'Leads with a young ' + heads[0].pos + ' of similar standing', base: [heads[0]] });
                if (rule.qb) {
                    const nearPick = pool.filter(x => x.kind === 'pick').sort((p, q) => (Number(p.year) || 9999) - (Number(q.year) || 9999) || q.to_them - p.to_them)[0];
                    pool.filter(x => x.kind === 'player' && x.pos !== 'QB' && x.value >= target.value * 0.7 && (Number(x.age) || 99) <= 28).sort((p, q) => q.to_them - p.to_them).slice(0, 2)
                        .forEach(tp => { if (nearPick) bases.push({ tag: 'One of your top players plus a pick', base: [tp, nearPick] }); });
                }
            } else {
                const single = pool.filter(x => x.to_them >= tCost.cost).sort((p, q) => p.value - q.value)[0];
                if (single) bases.push({ tag: 'One piece that covers his price', base: [single] });
                const pk = pool.filter(x => x.kind === 'pick' && x !== single).sort((p, q) => Math.abs(p.to_them - tCost.cost) - Math.abs(q.to_them - tCost.cost))[0];
                if (pk) bases.push({ tag: 'Pick-led', base: [pk] });
                const yp = pool.filter(x => x.kind === 'player' && x !== single).sort((p, q) => Math.abs(p.to_them - tCost.cost) - Math.abs(q.to_them - tCost.cost))[0];
                if (yp) bases.push({ tag: 'Player-led', base: [yp] });
            }
            let scored = bases.map(b => score(fill(b.base), b.tag));
            // A lone headliner with a modest chance also gets a sweetened version.
            scored.slice().forEach(s => {
                if (s.pieces.length === 1 && s.acc < 60) {
                    const add = pool.filter(x => pieceKey(x) !== pieceKey(s.pieces[0]) && !(x.kind === 'pick' && x.round === 1)).sort((p, q) => p.to_them - q.to_them).find(x => x.to_them >= 300);
                    if (add) scored.push(score([s.pieces[0], add], s.tag + ', plus a sweetener'));
                }
            });
            const seen = new Set();
            scored = scored.filter(s => { const k = s.pieces.map(pieceKey).sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; })
                .filter(s => !rule || s.hl.ok)
                .sort((p, q) => q.acc - p.acc || p.rawGive - q.rawGive).slice(0, 3);
            const best = scored[0] || null;

            // Their own package, if they named one.
            let yourOffer;
            if (userGive) {
                if (userIssues.length || !userGive.length) yourOffer = { give: [].concat(a.give).map(String), valid: false, problems: userIssues };
                else { const s = score(userGive, 'Your package'); yourOffer = Object.assign({ valid: true }, s.out); yourOffer._s = s; }
            }
            const who = label(partner), mw = MODE_WORD[mode];
            // Owner ruling 2026-10-10: the partner's mode is a read, not a fact.
            const leadWith = mode === 'REBUILDING' ? ' Based on their recent moves, ' + who + ' looks to be rebuilding, likely after picks and younger players.' : mode === 'CONTENDING' ? ' Based on their recent moves, ' + who + ' looks to be contending, so proven starters likely move them more than picks.' : '';
            // A package that takes one of the member's starters costs them lineup strength: say so.
            const meRoster = rosterById(meRid) || {};
            const starterSet = new Set((meRoster.starters || []).map(String));
            const keyPieces = o => (o ? o.pieces : []).filter(x => x.kind === 'player' && (starterSet.has(String(x.pid)) || x.value >= SCALE.STARTER)).map(x => x.label);
            scored.forEach(s => { const k = keyPieces(s); if (k.length) s.out.lineup_cost = 'You\'d be giving up ' + k.join(' and ') + ', a key piece of your lineup.'; });
            let decision, recommendation;
            const ys = yourOffer && yourOffer._s;
            if (ys && (!rule || ys.hl.ok) && ys.acc >= 40 && ys.pv.ratio >= 0.95) {
                decision = 'offer';
                recommendation = 'Send your package (' + yourOffer.give.join(' + ') + ') for ' + target.label + ': about ' + ys.acc + '% to be accepted.' + leadWith;
            } else if (!best) {
                decision = yourOffer ? 'pass' : 'tough';
                const myFirsts = assets.filter(x => x.kind === 'pick' && x.round === 1).map(x => String(x.label).replace(/\s*\(own\)$/, ''));
                const dont = yourOffer ? 'Don\'t send ' + [].concat(a.give).join(' + ') + (ys && rule && !ys.hl.ok ? ' (no headliner)' : '') + '. ' : '';
                // Owner ruling 2026-10-10: never "I can't put a deal together";
                // say it'll be a tough one and why.
                recommendation = dont + 'This will be a tough deal to pull off for ' + target.label + '. ' + (rule ? 'The going rate is ' + rule.needed + (picksLoaded ? '' : ', and your picks aren\'t loaded') : 'What you could spare is worth less to a ' + mw + ' owner than what he costs') + '.'
                    + (rule && myFirsts.length ? ' Your ' + myFirsts.join(' and ') + ' ' + (myFirsts.length > 1 ? 'are' : 'is') + ' probably too far off to lead the deal' + (mode === 'REBUILDING' ? ' for a rebuilding team' : '') + '. The likely paths: pick up a ' + rule.next_draft + ' 1st first (contenders sometimes sell theirs), or build it around one of your top players.' : '') + leadWith;
            } else if (yourOffer) {
                decision = 'counter';
                const whyNot = !yourOffer.valid ? yourOffer.problems.join('; ') : (rule && !ys.hl.ok) ? 'no headliner: it takes ' + rule.needed : ys.pv.ratio < 0.95 ? 'worth only about ' + ys.pv.toThem + ' to ' + who + ' against ' + ys.pv.theirCost : 'too little appeal';
                recommendation = 'Don\'t send ' + [].concat(a.give).join(' + ') + ' (' + whyNot + (yourOffer.valid ? '; about ' + ys.acc + '% to be accepted' : '') + ').' + (best.out.lineup_cost ? ' This will be a tough one: ' + who + ' may consider ' + best.out.give.join(' + ') + ' (about ' + best.acc + '%), but ' + best.out.lineup_cost.replace(/^You'd/, 'you\'d') : ' Offer ' + best.out.give.join(' + ') + ' instead: about ' + best.acc + '% to be accepted.') + leadWith;
            } else if (best.acc < 20) {
                decision = 'pass';
                recommendation = 'The best you can build is ' + best.out.give.join(' + ') + ' at about ' + best.acc + '%: not worth chasing ' + target.label + ' right now.';
            } else if (!rule && best.rawGive > target.value * 1.5) {
                decision = 'pass';
                recommendation = 'It would cost you about ' + best.rawGive + ' in value for ' + target.label + ' (worth ' + target.value + '): too steep.';
            } else if (best.out.lineup_cost) {
                decision = 'tough';
                recommendation = 'This will be a tough deal to pull off. ' + who + ' may consider ' + best.out.give.join(' + ') + ' for ' + target.label + ' (about ' + best.acc + '%), but ' + best.out.lineup_cost.replace(/^You'd/, 'you\'d') + leadWith;
            } else {
                decision = 'offer';
                recommendation = 'Offer ' + best.out.give.join(' + ') + ' for ' + target.label + ': about ' + best.acc + '% to be accepted.' + leadWith;
            }
            if (yourOffer) delete yourOffer._s;
            const confidence = !picksLoaded ? 'low' : (mode === 'NEUTRAL' || !TE() || decision === 'no_fit' || decision === 'tough') ? 'medium' : best && best.acc >= 50 ? 'high' : 'medium';
            return Object.assign({ decision, confidence, recommendation }, base, {
                price_floor: priceFloor,
                offers: scored.map(s => s.out),
                your_offer: yourOffer,
                do_not_offer: doNot,
                comparables: await comparablesFor(target, partner),
                evidence, rules_applied: rulesApplied, method, values_note: SCALE_NOTE,
            });
        },
    });

    // ── find_trade_partners ────────────────────────────────────────
    const IDP = /^(DL|LB|DB|K|DEF)$/;
    const minVal = pos => (IDP.test(pos) ? 500 : 2000);
    const extraAt = (a, pos) => { const x = (a.posAssessment || {})[pos] || {}; return (x.sortedIds || []).map(String).slice(Math.max(1, x.minQuality || 1)); };
    const tradesBetween = (r1, r2) => (LI().tradeHistory || []).filter(t => { const ids = (t.roster_ids || []).map(String); return ids.includes(String(r1)) && ids.includes(String(r2)); }).length;
    const POS_ALIAS = { quarterback: 'QB', 'running back': 'RB', rb: 'RB', receiver: 'WR', 'wide receiver': 'WR', 'tight end': 'TE', kicker: 'K', edge: 'DL', linebacker: 'LB', cornerback: 'DB', safety: 'DB', defense: 'DEF' };
    const normPosArg = p => { if (!p) return null; const t = String(p).trim().toLowerCase(); return POS_ALIAS[t] || t.toUpperCase(); };

    AT.register({
        name: 'find_trade_partners',
        description: 'Who I should trade with: for a position I want (or my needs by default), the teams that have it and need what I have; with no holes, who needs my surplus. Gives each partner\'s needs, players I\'d target, what I could offer, windows, DNA and why.',
        parameters: {
            type: 'object',
            properties: {
                position: { type: 'string', description: 'Position to buy, e.g. "TE". Default: my needs.' },
                mode: { type: 'string', enum: ['buy', 'sell'], description: 'buy = fill a need (default); sell = move my surplus.' },
                limit: { type: 'integer', description: 'Partners to return (default 4, max 8).' },
            },
        },
        async run(a) {
            const me = myRoster(), mine = me ? assess(me.roster_id) : null;
            if (!mine) throw new Error('DHQ is still reading the league; try again in a few seconds.');
            const others = allAssess().filter(x => String(x.rosterId) !== String(me.roster_id));
            if (!others.length) throw new Error('Team assessments are still loading; try again in a few seconds.');
            const limit = clampInt(a.limit, 1, 8, 4), E = TE();
            const pos = normPosArg(a.position);
            const want = pos ? [pos] : (mine.needs || []).map(n => n.pos);
            const sell = a.mode === 'sell' || (!pos && !want.length);
            const lane = x => (mine.window === 'CONTENDING' && x.window === 'REBUILDING') || (mine.window === 'REBUILDING' && x.window === 'CONTENDING');
            const myOffer = theirNeeds => theirNeeds.filter(p => (mine.strengths || []).includes(p)).flatMap(p => extraAt(mine, p).slice(0, 2)).map(pid => pname(pid) + ' (' + ppos(pid) + ', ' + value(pid) + ')');
            let list;
            if (sell) {
                const surplus = pos ? [pos] : (mine.strengths || []);
                list = others.map(x => {
                    const wants = (x.needs || []).map(n => n.pos).filter(p => surplus.includes(p));
                    return { x, wants, score: wants.length * 10 + (lane(x) ? 14 : 0) + Number(x.panic || 0) * 2 };
                }).filter(o => o.wants.length).sort((p, q) => q.score - p.score).slice(0, limit);
                if (!list.length) return { mode: 'sell', my_surplus: surplus, partners: [], note: 'Nobody in the league needs ' + (surplus.join(' or ') || 'what you have extra of') + ' right now.' };
                return {
                    mode: 'sell', my_team: assessSummary(mine), my_surplus: surplus,
                    partners: list.map(o => {
                        const rid = o.x.rosterId, r = rosterById(rid);
                        const offer = o.wants.flatMap(p => extraAt(mine, p).slice(0, 2)).map(pid => pname(pid) + ' (' + ppos(pid) + ', ' + value(pid) + ')');
                        const why = ['needs ' + o.wants.join(', ') + ', where you have extra'];
                        if (lane(o.x)) why.push('opposite windows'); if (Number(o.x.panic) >= 3) why.push('under pressure (panic ' + o.x.panic + '/5)');
                        return { team: r ? label(r) : o.x.teamName, their_needs: (o.x.needs || []).map(n => n.pos), their_window: o.x.window, you_could_offer: offer, dna: dnaBrief(rid), past_trades_with_you: tradesBetween(rid, me.roster_id), why: why.join('; ') };
                    }),
                    ask_for: mine.window === 'CONTENDING' ? 'a starter-level upgrade elsewhere or future picks' : 'picks and young players',
                };
            }
            list = others.map(x => {
                const fit = E && E.calcComplementarity ? Number(E.calcComplementarity(mine, x)) || 0 : 0;
                const hits = want.flatMap(p => (((x.posAssessment || {})[p] || {}).sortedIds || []).map(String).filter(pid => value(pid) >= minVal(p)).slice(0, 2));
                const surplusHits = want.filter(p => ((x.posAssessment || {})[p] || {}).status === 'surplus');
                return { x, hits, surplusHits, fit, score: fit + (lane(x) ? 14 : 0) + hits.length * 10 + surplusHits.length * 8 };
            }).filter(o => o.hits.length).sort((p, q) => q.score - p.score).slice(0, limit);
            if (!list.length) return { mode: 'buy', want, partners: [], note: 'Nobody has a ' + want.join(' or ') + ' worth chasing (value ' + minVal(want[0] || 'WR') + '+) right now.' };
            return {
                mode: 'buy', want, my_team: assessSummary(mine),
                partners: list.map(o => {
                    const rid = o.x.rosterId, r = rosterById(rid);
                    const theirNeeds = (o.x.needs || []).map(n => n.pos);
                    const offer = myOffer(theirNeeds);
                    const why = [];
                    if (o.surplusHits.length) why.push('they have a surplus at ' + o.surplusHits.join(', '));
                    if (offer.length) why.push('they need ' + theirNeeds.filter(p => (mine.strengths || []).includes(p)).join(', ') + ', where you have extra');
                    if (lane(o.x)) why.push('opposite windows');
                    if (Number(o.x.panic) >= 3) why.push('under pressure (panic ' + o.x.panic + '/5)');
                    return {
                        team: r ? label(r) : o.x.teamName, fit_score: o.fit,
                        targets: o.hits.map(pid => ({ name: pname(pid), pos: ppos(pid), age: pl(pid).age || null, value: value(pid), surplus_for_them: extraAt(o.x, ppos(pid)).includes(pid) })),
                        their_needs: theirNeeds, their_window: o.x.window, their_tier: o.x.tier,
                        you_could_offer: offer.length ? offer : undefined,
                        dna: dnaBrief(rid), past_trades_with_you: tradesBetween(rid, me.roster_id),
                        why: why.join('; ') || 'they have the players you want',
                    };
                }),
                pay_with: (mine.strengths || []).length ? 'your ' + mine.strengths.join('/') + ' surplus' : mine.window === 'CONTENDING' ? 'future picks' : 'veterans for picks and youth',
            };
        },
    });

    // ── get_owner_profile ──────────────────────────────────────────
    function activityFor(rid, raw) {
        const mine = raw.filter(t => [...(t.roster_ids || []), ...Object.values(t.adds || {})].map(String).includes(String(rid)));
        const out = { waiver_claims: 0, free_agent_adds: 0, trades: 0, faab_spent: 0, last_move: null };
        mine.forEach(t => {
            if (t.type === 'waiver') { out.waiver_claims++; out.faab_spent += Number(t.settings && t.settings.waiver_bid) || 0; } else if (t.type === 'free_agent') out.free_agent_adds++; else if (t.type === 'trade') out.trades++;
        });
        const last = mine.sort((x, y) => toMs(y.status_updated || y.created) - toMs(x.status_updated || x.created))[0];
        if (last) out.last_move = isoDate(last.status_updated || last.created) + ' (' + last.type + ')';
        return out;
    }
    const tradeBrief = (t, rid) => {
        if (!t) return null;
        const row = histTradeRow(t);
        const other = row._rids.find(x => x !== String(rid));
        const got = row.sides.find(s => String(s.roster_id) === String(rid)) || {};
        const gave = row.sides.find(s => String(s.roster_id) === String(other)) || {};
        return { date: row.date, season: row.season, week: row.week, with: other ? teamLabel(other) : null, got: [...(got.got_players || []).map(p => p.name), ...(got.got_picks || [])], gave: [...(gave.got_players || []).map(p => p.name), ...(gave.got_picks || [])], net_value_now: Math.round((got.value_now || 0) - (gave.value_now || 0)) };
    };

    AT.register({
        name: 'get_owner_profile',
        description: 'What this owner is doing RIGHT NOW (rebuilding, contending or neither, from their record, this season\'s trades and their trade block) and what they want and avoid; plus the owner\'s profile: trading DNA and how to negotiate with them, trade record (won/lost/fair), favourite partners, positions they buy and sell, when they trade, biggest win and loss, recent trades, team read and this season\'s activity.',
        parameters: { type: 'object', properties: { team: { type: 'string', description: 'Team or owner name, roster id, or "me".' } }, required: ['team'] },
        async run(a) {
            const r = findTeam(a.team);
            if (!r) throw new Error(rosters().length ? 'No team in this league matches "' + a.team + '".' : 'League not loaded yet.');
            const rid = r.roster_id, L = LI();
            const p = (L.ownerProfiles || {})[rid] || (L.ownerProfiles || {})[String(rid)] || null;
            const out = { team: label(r), owner: h.ownerName(r), record: record(r), team_read: assessSummary(assess(rid)), dna: dnaBrief(rid) };
            if (p) {
                const top = (o, n) => Object.entries(o || {}).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => k + ' ' + v);
                out.trading = {
                    style: p.dna || null, trades: p.trades || 0, won: p.tradesWon || 0, lost: p.tradesLost || 0, fair: p.tradesFair || 0,
                    avg_value_per_trade_now: p.avgValueDiff || 0,
                    picks_acquired: p.picksAcquired || 0, picks_sold: p.picksSold || 0,
                    positions_bought: top(p.posAcquired, 4), positions_sold: top(p.posSold, 4), most_targeted: p.targetPos || null,
                    partners: Object.entries(p.partners || {}).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([o, n]) => ({ team: teamLabel(o), trades: n })),
                    timing: p.weekTiming ? { 'weeks 1-6': p.weekTiming.early, 'weeks 7-12': p.weekTiming.mid, 'week 13+ / offseason': p.weekTiming.late } : undefined,
                    by_season: p.seasonActivity || undefined,
                    biggest_win: tradeBrief(p.biggestWin, rid), biggest_loss: tradeBrief(p.biggestLoss, rid),
                };
            } else out.trading = { trades: 0, note: L.ownerProfiles ? 'No trades on record for this owner.' : 'DHQ trade history is still loading.' };
            out.recent_trades = (L.tradeHistory || []).filter(t => (t.roster_ids || []).map(String).includes(String(rid))).sort((x, y) => toMs(y.ts) - toMs(x.ts)).slice(0, 5).map(t => tradeBrief(t, rid));
            const me = myRoster();
            if (me && !isMe(r)) out.trades_with_me = tradesBetween(rid, me.roster_id);
            const raw = await rawTxns();
            if (raw.length) out.this_season = activityFor(rid, raw);
            // What they're trying to do right now, from the evidence.
            try { const it = await ownerIntent(r); if (it) out.right_now = { mode: it.mode, evidence: it.evidence, they_want: it.wants, they_avoid: it.avoids.length ? it.avoids : undefined }; } catch (e) { /* optional */ }
            return out;
        },
    });

    // ── get_draft_info ─────────────────────────────────────────────
    AT.register({
        name: 'get_draft_info',
        description: 'Draft picks: who owns which future picks (every team or one), what picks are worth by round and slot, past draft results (who took whom and whether it hit), hit rates by round, and the top upcoming rookie prospects.',
        parameters: {
            type: 'object',
            properties: {
                team: { type: 'string', description: 'One team (default: every team).' },
                section: { type: 'string', enum: ['all', 'picks', 'values', 'results', 'hit_rates', 'prospects'], description: 'Default all.' },
                season: { type: 'string', description: 'Past draft season for results, e.g. "2024".' },
                round: { type: 'integer', description: 'Only this round.' },
                limit: { type: 'integer', description: 'Max rows per list (default 25, max 60).' },
            },
        },
        async run(a) {
            const sec = a.section || 'all', want = s => sec === 'all' || sec === s;
            const limit = clampInt(a.limit, 1, 60, 25);
            let team = null;
            if (a.team) { team = findTeam(a.team); if (!team) throw new Error(rosters().length ? 'No team in this league matches "' + a.team + '".' : 'League not loaded yet.'); }
            const rd = a.round ? Number(a.round) : null;
            const L = LI(), out = { teams: totalTeams(), rounds: draftRounds() }, notes = [];

            if (want('picks')) {
                const own = picksByOwner();
                if (!own) notes.push('Pick ownership is not loaded yet' + (platform() !== 'sleeper' ? ' (only read for Sleeper leagues)' : '') + '.');
                else {
                    const one = rid => (own[rid] || []).filter(x => !rd || x.round === rd).map(x => ({ pick: pickLabel(x.year, x.round, x.originalOwnerRid, rid), value: pickValue(x.year, x.round, null, x.originalOwnerRid) }));
                    if (team) { const list = one(team.roster_id); out.picks = { team: label(team), count: list.length, total_value: list.reduce((s, x) => s + x.value, 0), picks: list.slice(0, 40) }; }
                    else out.picks_by_team = rosters().map(r => { const list = one(r.roster_id); return { team: label(r), count: list.length, total_value: list.reduce((s, x) => s + x.value, 0), picks: list.map(x => x.pick).slice(0, 30) }; }).sort((x, y) => y.total_value - x.total_value);
                    notes.push('Picks in the next draft are valued at their projected slot from current standings (worst team picks 1st), with no year discount; later drafts assume mid-round, less 12% a year.');
                }
            }
            if (want('values')) {
                const yrs = (() => { const own = picksByOwner(); const ys = own ? [...new Set(Object.values(own).flat().map(x => x.year))].sort() : []; return ys.length ? ys : [(parseInt(season(), 10) || new Date().getFullYear()) + 1]; })();
                const n = totalTeams(), mid = Math.ceil(n / 2), dpv = L.dhqPickValues || {};
                out.pick_values = { year: yrs[0], by_round: [] };
                for (let r = 1; r <= draftRounds(); r++) {
                    if (rd && r !== rd) continue;
                    const midNo = (r - 1) * n + mid, hist = dpv[midNo];
                    out.pick_values.by_round.push({ round: r, early: pickValue(yrs[0], r, 1), mid: pickValue(yrs[0], r, mid), late: pickValue(yrs[0], r, n), league_hit_rate_mid_pct: hist && hist.hitRate != null ? hist.hitRate : undefined, league_starter_rate_mid_pct: hist && hist.starterRate != null ? hist.starterRate : undefined });
                }
                if (yrs.length > 1) out.pick_values.later_years = yrs.slice(1).map(y => ({ year: y, mid_1st: pickValue(y, 1, mid), mid_2nd: pickValue(y, 2, mid) }));
            }
            if (want('results')) {
                const outs = L.draftOutcomes || [];
                if (!outs.length) notes.push('No past rookie drafts on record for this league (or DHQ is still loading).');
                else {
                    const n = totalTeams();
                    let rows = outs.filter(d => (!a.season || String(d.season) === String(a.season)) && (!rd || Number(d.round) === rd) && (!team || String(d.roster_id) === String(team.roster_id)));
                    rows = rows.slice().sort((x, y) => Number(y.season) - Number(x.season) || (x.pick_no || 0) - (y.pick_no || 0));
                    out.draft_results = {
                        found: rows.length,
                        rows: rows.slice(0, limit).map(d => {
                            const slot = d.pick_no ? ((d.pick_no - 1) % n) + 1 : null;
                            return { season: String(d.season), pick: d.round + '.' + String(slot || '?').padStart(2, '0'), overall: d.pick_no || null, team: teamLabel(d.roster_id), player: (d.name || pname(d.pid)).trim(), pos: d.pos, value_now: d.pid ? value(d.pid) : null, result: d.isHit ? 'hit (elite season)' : d.isStarter ? 'starter' : (d.seasonsAvailable || 0) < 1 ? 'too early to tell' : 'miss', best_season_pts: d.bestTotal ? round1(d.bestTotal) : 0 };
                        }),
                    };
                    if (rows.length > limit) out.draft_results.more = rows.length - limit;
                    if (team) {
                        const graded = rows.filter(d => (d.seasonsAvailable || 0) >= 1);
                        out.draft_results.team_summary = { picks: rows.length, graded: graded.length, starters: graded.filter(d => d.isStarter).length, hits: graded.filter(d => d.isHit).length };
                    }
                }
            }
            if (want('hit_rates')) {
                const hr = L.hitRateByRound || {};
                const keys = Object.keys(hr).filter(k => !rd || Number(k) === rd);
                if (keys.length) out.hit_rates_by_round = keys.map(k => { const x = hr[k] || {}; return { round: Number(k), picks_graded: x.total || 0, starter_rate_pct: x.rate || 0, elite_rate_pct: x.eliteRate || 0, best_positions: (x.bestPos || []).slice(0, 3).map(p => p.pos + ' ' + p.rate + '% (' + p.starters + '/' + p.total + ')') }; });
                else notes.push('No hit-rate history yet for this league.');
            }
            if (want('prospects')) {
                const g = (root.RookieData && root.RookieData.getProspects) || root.getProspects;
                let list = [];
                try { list = typeof g === 'function' ? (g() || []) : []; } catch (e) { list = []; }
                if (list.length) out.rookie_prospects = list.slice(0, Math.min(limit, 25)).map(p => ({ rank: p.rank, name: p.name, pos: p.pos || p.position, college: p.college || p.school || undefined, tier: p.tierLabel || undefined, consensus_rank: p.consensusRank != null ? p.consensusRank : undefined, dhq_value: p.dynastyValue || p.dhqValue || undefined }));
                else notes.push('Rookie prospect rankings are not loaded on this page.');
            }
            if (notes.length) out.notes = notes;
            return out;
        },
    });

    // ── The league's trade block (owner ruling 2026-10-10: "no assumptions") ──
    // Sleeper's documented API has no trade block, but the GraphQL feed its
    // own app uses answers league_players without a login: each player (and
    // pick) carries settings.otb = 1 and otb_added_at when an owner puts him
    // on the block, plus metadata.likes. Checked 2026-10-10 on the live
    // Psycho League: 65 entries, e.g. bwit13 listed Jordan Love on Oct 9.
    // Browsers may call it (Access-Control-Allow-Origin: *). Pending offers
    // and league notes on that feed need a login, so they stay out of reach.
    // A listing whose player has since changed teams (or been cut) is stale
    // and dropped; picks show only for drafts not yet held.
    const blockCache = {};
    async function leaguePlayers(lid) {
        const c = blockCache[lid];
        if (c && Date.now() - c.at < 5 * 60 * 1000) return c.rows;
        const r = await fetch('https://api.sleeper.app/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ league_players(league_id: "' + String(lid).replace(/[^0-9]/g, '') + '") { player_id metadata settings } }' }) });
        if (!r.ok) throw new Error('Sleeper\'s trade block didn\'t answer (' + r.status + ').');
        const j = await r.json();
        const rows = (j && j.data && j.data.league_players) || [];
        blockCache[lid] = { at: Date.now(), rows };
        return rows;
    }
    AT.register({
        name: 'get_trade_block',
        description: 'Who is on the trade block in this league right now (what owners have listed in Sleeper), by team: players with position, value, age, this week, and when they were listed, plus future draft picks on the block. Filter by team or position. Use it for "who\'s for sale", "is anyone shopping a WR", or before proposing a trade.',
        parameters: { type: 'object', properties: {
            team: { type: 'string', description: 'Only this team\'s block (name, owner, roster id or "me").' },
            position: { type: 'string', description: 'Only this position (QB, RB, WR, TE, K, DL, LB, DB).' },
        } },
        timeoutMs: 20000,
        async run(a, h) {
            if (h.platform() !== 'sleeper') throw new Error('The trade block is only readable for Sleeper leagues.');
            const lg = h.league();
            if (!lg) throw new Error('League not loaded yet.');
            const rows = await h.withTimeout(leaguePlayers(lg.league_id || lg.id), 12000, null);
            if (!rows) throw new Error('Sleeper\'s trade block took too long to answer.');
            const only = a.team ? h.findTeam(a.team) : null;
            if (a.team && !only) throw new Error('No team matches "' + a.team + '".');
            const pos = a.position ? String(a.position).toUpperCase() : null;
            const season = Number(h.season()) || new Date().getFullYear();
            const day = ms => { try { return new Date(Number(ms)).toISOString().slice(0, 10); } catch (e) { return null; } };
            const byTeam = new Map();
            const add = (r, item) => { const k = String(r.roster_id); if (!byTeam.has(k)) byTeam.set(k, { team: h.label(r), roster_id: r.roster_id, players: [], picks: [] }); byTeam.get(k)[item.pick ? 'picks' : 'players'].push(item); };
            let stale = 0;
            rows.filter(x => x && x.settings && x.settings.otb).forEach(x => {
                const id = String(x.player_id), at = x.settings.otb_added_at;
                if (id.includes(',')) {
                    // Picks read "original roster, season, round".
                    const [rid, yr, rd] = id.split(',').map(Number);
                    if (!(yr > season || (yr === season && !(h.S().drafts || []).some(d => String(d.season) === String(yr) && d.status === 'complete')))) { stale++; return; }
                    const orig = h.rosters().find(r => Number(r.roster_id) === rid);
                    if (!orig) return;
                    if (only && String(only.roster_id) !== String(orig.roster_id)) return;
                    add(orig, { pick: true, pick_label: yr + ' round ' + rd + ' (originally ' + h.teamName(orig) + ')', listed: day(at) });
                    return;
                }
                const r = h.rosterOf(id);
                if (!r) { stale++; return; }   // cut or traded since listing
                if (only && String(only.roster_id) !== String(r.roster_id)) return;
                const b = h.playerBrief(id);
                if (pos && b.pos !== pos && !(h.pl(id).fantasy_positions || []).includes(pos)) return;
                add(r, { name: b.name, pos: b.pos, nfl_team: b.nfl_team, age: b.age, value: b.value, injury: b.injury, this_week: b.this_week, listed: day(at), likes: x.metadata && x.metadata.likes ? Number(x.metadata.likes) : undefined });
            });
            const teams = [...byTeam.values()].map(t => Object.assign(t, { players: t.players.sort((x, y) => (y.listed || '').localeCompare(x.listed || '')).slice(0, 15) }))
                .sort((x, y) => (y.players.length + y.picks.length) - (x.players.length + x.picks.length));
            return {
                source: 'Sleeper trade block (what owners listed in Sleeper)',
                teams_shopping: teams.length, listings: teams.reduce((n, t) => n + t.players.length + t.picks.length, 0),
                stale_listings_dropped: stale || undefined,
                teams,
                note: teams.length ? undefined : 'Nobody has anything on the block' + (only ? ' for that team' : '') + (pos ? ' at ' + pos : '') + ' right now.',
            };
        },
    });

    // Test hooks.
    AT._moves = { parsePick, pickValue, computeDNA, blockCache, nextDraftYear, projectedSlot, appealFor, isVet, vetAge, postureFor, costToOwner, headlinerRuleFor, headlinerMet, ownerIntent, evaluateTrade, MOONSHOT_LINE, SCALE };
})(typeof window !== 'undefined' ? window : globalThis);
