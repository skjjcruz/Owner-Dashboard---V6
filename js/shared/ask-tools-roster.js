// ══════════════════════════════════════════════════════════════════
// js/shared/ask-tools-roster.js — roster spots, cuts, IR and taxi for
// App.AskTools (Lab)
//
// Loads AFTER js/shared/ask-tools.js (and after ask-tools-players.js, whose
// get_waiver_plan reads the drop list from here at run time).
//
//   roster_plan   who to cut (one ordered list), who to keep despite a low
//                 number, IR and taxi moves, roster counts vs the limits.
//
// App.AskRoster — the ONE drop rule both roster_plan and get_waiver_plan
// use (research 2026-10-10 found two conflicting drop lists: My Team's
// DROP? chip protected starters/rookies/role players; Free Agency's list
// was the six lowest values, taxi and IR included). The single rule:
//   1. Only ACTIVE roster players can be drops (taxi and IR free no spot).
//   2. Never a starter, a locked player, a player the member tagged
//      untouchable/trade, a handcuff to the member's own starting RB/QB, a
//      young riser (≤1 year in the league, or ≤24 with 3+ peak years; not
//      kickers), the
//      last healthy active body at a dedicated slot, an injured player
//      worth 500+ (a stash), or anyone whose 0 is an engine gap (see below)
//      while he holds an NFL role.
//   3. No NFL team goes first (dead roster spot), then a member "cut" tag,
//      then lowest keep score: value + 50 × this week's projection + 300
//      upside, kickers excluded (dynasty); projection only in redraft.
//
// IR / Inactive fallback value (the shared engine is read-only here):
// Sleeper marks injured-reserve players status 'Inactive', and the DHQ
// engine (reconai-shared/dhq-engine.js _dhqStatusAdjustment) treats
// Inactive like Retired: value capped to 0. The engine still keeps the
// player's dynasty points-per-game (playerMeta.ppg), age and position, so
// the fallback is the MEDIAN DHQ VALUE OF THE FIVE ACTIVE PLAYERS AT HIS
// POSITION CLOSEST TO HIM in dynasty ppg (relative gap) and age (gap ÷ 6).
// Same scale as every other value, labeled value_source 'ir_fallback', and
// the peers are named so the AI can show its work. No ppg → 'unknown'.
// A player the engine never scored at all (not in playerScores — e.g. a
// veteran with no recent seasons) is 'unscored': value unknown, never 0.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const AT = App.AskTools;
    if (!AT || typeof AT.register !== 'function' || !AT.h) {
        if (root.console && root.console.warn) root.console.warn('ask-tools-roster: App.AskTools missing; load ask-tools.js first.');
        return;
    }
    const h = AT.h;
    const { round1 } = h;
    const PEERS = 5, MIN_PEERS = 3, AGE_SPAN = 6;
    const STASH_VALUE = 500;          // injured players at/above this are stashes, not cuts
    const UPSIDE_BONUS = 300, PROJ_WEIGHT = 50;
    const INJ_OUT = new Set(['OUT', 'DOUBTFUL', 'IR', 'PUP', 'SUS', 'NA', 'COV', 'DNR']);
    const IR_KEYS = { OUT: 'reserve_allow_out', DOUBTFUL: 'reserve_allow_doubtful', SUS: 'reserve_allow_sus', NA: 'reserve_allow_na', COV: 'reserve_allow_cov', DNR: 'reserve_allow_dnr' };
    const S = h.S, LI = h.LI;
    const scores = () => LI().playerScores || {};
    const ids = r => ((r && r.players) || []).map(String);
    const inList = (list, pid) => (list || []).map(String).includes(String(pid));
    const injOf = pid => String(h.pl(pid).injury_status || '').toUpperCase();
    // Owner test 2026-10-10: Ryan Fitzgerald was a cut "because he projects
    // zero this week" when he was on a bye. A bye week says nothing about a
    // player: use his season points per game instead.
    const onBye = pid => { const g = h.lock(pid); if (g && g.status === 'bye') return true; const z = App.AskTools && App.AskTools._zeroReason; try { return !!z && z(pid) === 'bye'; } catch (e) { return false; } };
    const projOf = pid => { const t = h.thisWeek(pid); if (t.scored != null) return t.scored; if (onBye(pid)) { const m = h.meta(pid); return m.ppg != null ? Number(m.ppg) : null; } return t.proj != null ? t.proj : null; };
    const tagOf = pid => { try { const t = root._playerTags && root._playerTags[String(pid)]; return t ? String(t).toLowerCase() : null; } catch (e) { return null; } };
    const isDynasty = () => { const t = Number((h.settings() || {}).type); return !(t === 0); };   // Sleeper: 0 redraft, 1 keeper, 2 dynasty

    // ── Value with the IR fallback ─────────────────────────────────
    function isInactive(pid) {
        const p = h.pl(pid), m = h.meta(pid);
        if (String(p.status || '').toLowerCase() === 'retired') return false;
        return /inactive/i.test(String(p.status || '')) || m.statusCode === 'inactive';
    }
    function peerValue(pid) {
        const m = h.meta(pid), p = h.pl(pid);
        const pos = h.ppos(pid);
        const ppg = Number(m.ppg) || 0;
        const age = Number(m.age || p.age) || 0;
        if (!(ppg > 0) || !(age > 0) || !pos) return null;
        const sc = scores(), meta = LI().playerMeta || {};
        const rows = [];
        for (const q in sc) {
            const v = Number(sc[q]);
            if (!(v > 0) || q === String(pid)) continue;
            const mq = meta[q];
            if (!mq || (mq.statusCode && mq.statusCode !== 'active')) continue;
            if (h.ppos(q) !== pos) continue;
            const qp = Number(mq.ppg) || 0, qa = Number(mq.age || h.pl(q).age) || 0;
            if (!(qp > 0) || !(qa > 0)) continue;
            rows.push({ pid: q, v, d: Math.abs(qp - ppg) / Math.max(1, ppg) + Math.abs(qa - age) / AGE_SPAN });
        }
        if (rows.length < MIN_PEERS) return null;
        rows.sort((a, b) => a.d - b.d || b.v - a.v);
        const near = rows.slice(0, PEERS);
        const vals = near.map(r => r.v).sort((a, b) => a - b);
        const mid = vals.length % 2 ? vals[(vals.length - 1) / 2] : Math.round((vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2);
        return { value: mid, ppg: round1(ppg), age, peers: near.map(r => h.pname(r.pid) + ' ' + r.v) };
    }
    // { value, value_source: 'dhq' | 'ir_fallback' | 'unknown' | 'unscored', basis? }
    function valueRead(pid) {
        pid = String(pid);
        const sc = scores();
        const v = Math.round(Number(sc[pid]) || 0);
        if (v > 0) return { value: v, value_source: 'dhq' };
        if (isInactive(pid)) {
            const f = peerValue(pid);
            if (f) return { value: f.value, value_source: 'ir_fallback', basis: 'engine shows 0 because Sleeper lists him Inactive (IR); healthy-equivalent = median of the ' + f.peers.length + ' active ' + h.ppos(pid) + 's closest in dynasty ppg (' + f.ppg + ') and age (' + f.age + '): ' + f.peers.join(', ') };
            return { value: null, value_source: 'unknown', basis: 'engine shows 0 because Sleeper lists him Inactive (IR), and there is no production on file to rebuild a value from' };
        }
        if (!(pid in sc)) return { value: null, value_source: 'unscored', basis: 'the value engine has no number for him (not scored), which is not the same as worthless' };
        return { value: 0, value_source: 'dhq' };
    }

    // ── League rules ───────────────────────────────────────────────
    function irEligibility(pid) {
        const st = h.settings() || {};
        const s = injOf(pid);
        if (s === 'IR') return { eligible: true, why: 'Listed IR' };
        if (IR_KEYS[s]) {
            const ok = Number(st[IR_KEYS[s]]) === 1;
            return { eligible: ok, why: ok ? 'League allows ' + s + ' on IR' : s + ' is not IR-eligible in this league (' + IR_KEYS[s] + ' = 0)' };
        }
        if (s === 'PUP') return { eligible: null, why: 'PUP: IR eligibility on Sleeper not verified' };
        return { eligible: false, why: s ? 'Listed ' + h.pl(pid).injury_status + ', not an IR designation' : 'Healthy' };
    }
    function rosterCounts(r) {
        const lg = h.league() || {}, st = lg.settings || {};
        const all = ids(r), taxi = (r.taxi || []).map(String), ir = (r.reserve || []).map(String);
        const active = all.filter(pid => !taxi.includes(pid) && !ir.includes(pid));
        const max = (lg.roster_positions || []).filter(s => !/^(IR|TAXI)$/i.test(String(s))).length || null;
        return { active: active.length, max, open: max != null ? max - active.length : null, taxi: taxi.length, taxi_max: Number(st.taxi_slots) || 0, ir: ir.length, ir_max: Number(st.reserve_slots) || 0, activeIds: active, taxiIds: taxi, irIds: ir };
    }
    // Dedicated starting slots per position (FLEX slots don't count: a flex
    // can be filled from several positions, so they never make a player the
    // "last body").
    function dedicatedSlots() {
        const out = {};
        ((h.league() || {}).roster_positions || []).forEach(s => {
            const k = String(s).toUpperCase();
            const pos = String((App.normPos && App.normPos(k)) || k).toUpperCase();
            if (/FLEX|^BN$|^IR$|^TAXI$/.test(k)) return;
            out[pos] = (out[pos] || 0) + 1;
        });
        return out;
    }

    // ── Handcuffs: the NFL backup to each of my starting RBs / QBs ──
    let _depthIdx = null;
    function depthIndex() {
        const players = S().players || {};
        if (_depthIdx && _depthIdx.src === players) return _depthIdx.map;
        const map = {};
        for (const pid in players) {
            const p = players[pid];
            if (!p || !p.team || p.active === false || p.depth_chart_order == null) continue;
            const pos = h.ppos(pid);
            if (pos !== 'RB' && pos !== 'QB') continue;
            const k = p.team + '|' + pos + '|' + Number(p.depth_chart_order);
            (map[k] = map[k] || []).push(pid);
        }
        _depthIdx = { src: players, map };
        return map;
    }
    function handcuffs(r) {
        const out = [];
        const idx = depthIndex();
        (r.starters || []).map(String).filter(x => x && x !== '0').forEach(sid => {
            const p = h.pl(sid), pos = h.ppos(sid);
            if ((pos !== 'RB' && pos !== 'QB') || !p.team || Number(p.depth_chart_order) !== 1) return;
            (idx[p.team + '|' + pos + '|2'] || []).forEach(bid => {
                const holder = h.rosterOf(bid);
                out.push({ starter: sid, backup: bid, pos, nfl_team: p.team, owner: holder ? (h.isMe(holder) ? 'me' : h.label(holder)) : 'free agent' });
            });
        });
        return out;
    }

    // ── Next man up (owner ruling 2026-10-10: "Davis is a keeper, Breece
    // Hall is out this week, he's up as an RB2"). A backup whose NFL team's
    // starter at his position is out moves up the depth chart: he's not a cut.
    const NEXT_UP_DEPTH = { QB: 1, RB: 2, WR: 3, TE: 1 };
    let _teamPos = null;
    function teamPosIndex() {
        const players = S().players || {};
        if (_teamPos && _teamPos.src === players) return _teamPos.map;
        const map = {};
        for (const pid in players) {
            const p = players[pid];
            if (!p || !p.team || p.depth_chart_order == null) continue;
            const pos = h.ppos(pid);
            if (!NEXT_UP_DEPTH[pos]) continue;
            (map[p.team + '|' + pos] = map[p.team + '|' + pos] || []).push(pid);
        }
        Object.values(map).forEach(list => list.sort((a, b) => Number(players[a].depth_chart_order) - Number(players[b].depth_chart_order)));
        _teamPos = { src: players, map };
        return map;
    }
    function nextManUp(pid) {
        const p = h.pl(pid), pos = h.ppos(pid);
        if (!p.team || !NEXT_UP_DEPTH[pos] || INJ_OUT.has(injOf(pid))) return null;
        const list = teamPosIndex()[p.team + '|' + pos] || [];
        const at = list.indexOf(String(pid));
        if (at <= 0) return null;
        // Sleeper moves an injured starter DOWN its depth chart (live: Breece
        // Hall sits at NYJ depth 5 while out), so "above him" also means a
        // teammate who is clearly the bigger player (worth more).
        const v = x => Number(valueRead(x).value) || 0;
        const outAbove = list.filter((x, i) => x !== String(pid) && INJ_OUT.has(injOf(x)) && (i < at || v(x) > Math.max(v(pid), 500)));
        if (!outAbove.length) return null;
        const healthyRank = list.slice(0, at + 1).filter(x => !INJ_OUT.has(injOf(x))).length;
        if (healthyRank > NEXT_UP_DEPTH[pos]) return null;
        return { out: outAbove.map(x => h.pname(x) + ' (' + (h.pl(x).injury_status || 'out') + ')'), role: pos + healthyRank };
    }

    // ── The one drop list ──────────────────────────────────────────
    function keepScore(pid, vr) {
        const proj = Number(projOf(pid)) || 0;
        if (!isDynasty()) return round1(proj * 100);
        const m = h.meta(pid), p = h.pl(pid);
        const upside = h.ppos(pid) !== 'K' && (Number(p.years_exp) <= 1 || Number(m.peakYrsLeft) >= 3) ? UPSIDE_BONUS : 0;
        return Math.round((vr.value || 0) + proj * PROJ_WEIGHT + upside);
    }
    // Kickers are excluded: a young kicker carries no dynasty upside.
    function youngRiser(pid) {
        const p = h.pl(pid), m = h.meta(pid);
        if (h.ppos(pid) === 'K') return false;
        return Number(p.years_exp) <= 1 || (Number(p.age) > 0 && Number(p.age) <= 24 && Number(m.peakYrsLeft) >= 3);
    }
    function row(pid, extra) {
        const vr = valueRead(pid);
        return Object.assign({ player: h.pname(pid), pos: h.ppos(pid), nfl_team: h.pl(pid).team || 'FA', value: vr.value, value_source: vr.value_source }, vr.basis ? { value_basis: vr.basis } : {}, extra || {});
    }
    // cutPlan(r) → { candidates:[{pid, ...row, why, keep_score}], keep:[{pid,...row, reason}], counts, cuffs }
    function cutPlan(r) {
        const counts = rosterCounts(r);
        const starters = new Set((r.starters || []).map(String));
        const cuffs = handcuffs(r).filter(c => c.owner === 'me');
        const cuffOf = {};
        cuffs.forEach(c => { cuffOf[c.backup] = c.starter; });
        const A = h.assess(r.roster_id) || {};
        const contending = /CONTEND/i.test(String(A.window || ''));
        const slots = dedicatedSlots();
        const healthyAt = {};
        counts.activeIds.forEach(pid => { if (!INJ_OUT.has(injOf(pid))) { const pos = h.ppos(pid); healthyAt[pos] = (healthyAt[pos] || 0) + 1; } });
        const candidates = [], keep = [];
        counts.activeIds.forEach(pid => {
            const vr = valueRead(pid);
            const p = h.pl(pid);
            const tag = tagOf(pid);
            const proj = projOf(pid);
            const g = h.lock(pid);
            const inj = injOf(pid);
            const keepIf = reason => { keep.push(Object.assign({ pid }, row(pid, { reason }))); };
            const noTeam = !p.team;
            if (tag === 'untouchable' || tag === 'trade') return keepIf('You tagged him ' + tag + '.');
            if (noTeam) return candidates.push(Object.assign({ pid, rank_key: -2 }, row(pid, { why: 'No NFL team' + (inj ? ' (' + p.injury_status + ')' : '') + ': a dead roster spot.', keep_score: keepScore(pid, vr) })));
            if (tag === 'cut') return candidates.push(Object.assign({ pid, rank_key: -1 }, row(pid, { why: 'You tagged him cut.', keep_score: keepScore(pid, vr) })));
            if (starters.has(pid)) return;                                        // starters are never drops
            if (g && g.locked) return keepIf('His game has started; he can\'t be dropped until it ends.');
            if (cuffOf[pid]) return keepIf('Handcuff: backs up your starter ' + h.pname(cuffOf[pid]) + ' (' + p.team + ' ' + h.ppos(pid) + '2)' + (contending ? '; you\'re contending, so keep the insurance.' : '.'));
            if (vr.value_source === 'ir_fallback' || vr.value_source === 'unknown') {
                const el = irEligibility(pid);
                return keepIf('Injured stash (' + (p.injury_status || 'Inactive') + '): the engine\'s 0 is an IR gap, not his worth' + (el.eligible ? '; move him to IR instead of cutting.' : '.'));
            }
            if (vr.value_source === 'unscored' && (Number(p.depth_chart_order) === 1 || (proj != null && proj >= 3))) {
                return keepIf('No engine value, but he has an NFL role (' + p.team + (p.depth_chart_order != null ? ' depth #' + p.depth_chart_order : '') + (proj != null ? ', projects ' + round1(proj) : '') + '). Unknown value is not zero.');
            }
            const nmu = nextManUp(pid);
            if (nmu) return keepIf('Next man up: ' + nmu.out.join(' and ') + ' ' + (nmu.out.length > 1 ? 'are' : 'is') + ' out, so he moves up to ' + p.team + ' ' + nmu.role + '.');
            if (youngRiser(pid)) return keepIf('Young upside (age ' + (p.age || '?') + ', ' + (p.years_exp != null ? p.years_exp + ' yrs in the NFL' : 'rookie') + ').');
            if (INJ_OUT.has(inj) && (vr.value || 0) >= STASH_VALUE) return keepIf('Injured (' + p.injury_status + ') but worth ' + vr.value + ': hold him through it' + (irEligibility(pid).eligible === false ? ' (' + irEligibility(pid).why + ').' : '.'));
            const pos = h.ppos(pid);
            if (slots[pos] && !INJ_OUT.has(inj) && (healthyAt[pos] || 0) - 1 < slots[pos]) return keepIf('Last healthy active ' + pos + ' for your ' + slots[pos] + ' ' + pos + ' slot' + (slots[pos] > 1 ? 's' : '') + '.');
            const why = [];
            if (vr.value_source === 'unscored') why.push('no engine value and no NFL role');
            else why.push('value ' + (vr.value || 0));
            why.push(onBye(pid) ? 'on bye this week' + (proj != null ? ' (averages ' + round1(proj) + ' a game)' : '') : proj != null ? 'projects ' + round1(proj) + ' this week' : 'no projection this week');
            if (pos === 'K' && (healthyAt.K || 0) > (slots.K || 1)) why.push('a backup kicker: you start ' + (slots.K || 1));
            if (Number(h.meta(pid).trend) <= -30) why.push('trend ' + h.meta(pid).trend + '%');
            if (inj) why.push(p.injury_status);
            candidates.push(Object.assign({ pid, rank_key: 0 }, row(pid, { why: why.join(', ') + '.', keep_score: keepScore(pid, vr) })));
        });
        candidates.sort((a, b) => a.rank_key - b.rank_key || a.keep_score - b.keep_score);
        return { candidates, keep, counts, cuffs, window: A.window || null };
    }
    const strip = x => { const o = Object.assign({}, x); delete o.pid; delete o.rank_key; return o; };

    App.AskRoster = { valueRead, peerValue, irEligibility, rosterCounts, handcuffs, cutPlan, keepScore, strip, dedicatedSlots };

    // ── roster_plan ────────────────────────────────────────────────
    const METHOD = 'Roster plan: (1) count active, taxi and IR against the league limits; (2) use free moves before any cut: IR for players the league lets go there, activate anyone on IR who is no longer eligible (Sleeper blocks adds until you do); (3) one drop list from the active roster only, never taxi or IR; (4) never cut a starter, a handcuff to your own starter, a young riser, an injured stash, the last body at a slot, or a player whose 0 is an engine gap; (5) players with no NFL team go first, then lowest keep score (dynasty value + this week\'s projection + upside; projection only in redraft). An injured player on IR is valued on his healthy-equivalent (ir_fallback), never as 0.';
    AT.register({
        name: 'roster_plan',
        description: 'Roster spots, cuts, IR and taxi for my team: active/taxi/IR counts vs the league limits, IR and taxi moves that free a spot (with this league\'s eligibility rules), the ordered cut list from the active roster, and who to keep despite a low value (IR stashes, handcuffs, young upside). Use for any "who should I cut", "do I have room", "can he go on IR/taxi" question.',
        parameters: { type: 'object', properties: {} },
        async run() {
            const lg = h.league(), me = h.myRoster();
            if (!lg || !me) throw new Error('League not loaded yet.');
            const st = lg.settings || {};
            const plan = cutPlan(me);
            const c = plan.counts;
            const wk = h.week();
            // IR moves: active players who can go to IR now, and IR players who
            // must come off before Sleeper allows any add.
            const ir_moves = [];
            const irRoom = c.ir_max - c.ir;
            c.activeIds.forEach(pid => {
                if (!INJ_OUT.has(injOf(pid))) return;
                const el = irEligibility(pid);
                const room = irRoom > 0;
                ir_moves.push(Object.assign(row(pid), { to: 'IR', eligible: el.eligible === true ? room : el.eligible, why: el.why + (el.eligible === true ? (room ? '; frees an active spot' : '; but IR is full (' + c.ir + '/' + c.ir_max + ')') : '') + '.' }));
            });
            c.irIds.forEach(pid => {
                const el = irEligibility(pid);
                if (el.eligible === false) ir_moves.push(Object.assign(row(pid), { to: 'active', eligible: true, why: 'On IR but no longer IR-eligible (' + el.why + '): Sleeper blocks adds until he is activated or dropped.' }));
            });
            // Taxi: young bench players who could stash there.
            const taxi_moves = [];
            const deadline = Number(st.taxi_deadline) || 0;
            const years = Number(st.taxi_years) || 0;
            const taxiRoom = c.taxi_max - c.taxi;
            const pastDeadline = deadline > 0 && wk > deadline;
            const starters = new Set((me.starters || []).map(String));
            c.activeIds.filter(pid => !starters.has(pid)).forEach(pid => {
                const p = h.pl(pid);
                const yrsOk = years > 0 ? Number(p.years_exp) < years : false;
                if (!c.taxi_max || !yrsOk) return;
                const eligible = yrsOk && taxiRoom > 0 && !pastDeadline;
                taxi_moves.push(Object.assign(row(pid), { to: 'taxi', eligible, why: (pastDeadline ? 'Taxi deadline was week ' + deadline + ' (now week ' + wk + '), so no new taxi stashes' : taxiRoom <= 0 ? 'Taxi is full (' + c.taxi + '/' + c.taxi_max + ')' : 'Fits the taxi rules (' + p.years_exp + ' yrs, limit under ' + years + ') and frees an active spot') + '.' }));
            });
            // Keep despite low value: active keeps under 1,000 or with a
            // non-engine value, plus IR stashes and taxi players (they cost no
            // active spot).
            const keep = plan.keep.filter(k => k.value == null || k.value < 1000 || k.value_source !== 'dhq').map(strip);
            c.irIds.forEach(pid => { const r = row(pid); if (r.value == null || r.value < 1000 || r.value_source !== 'dhq') keep.push(Object.assign(r, { reason: 'IR stash: he uses an IR slot, not an active spot' + (r.value_source === 'ir_fallback' ? '; the engine\'s 0 is an IR gap (healthy-equivalent ' + r.value + ')' : '') + '.' })); });
            c.taxiIds.forEach(pid => { const r = row(pid); if (r.value == null || r.value < 1000) keep.push(Object.assign(r, { reason: 'Taxi: he uses a taxi slot, not an active spot; cutting him frees nothing on the active roster' + (h.pl(pid).team ? '' : ' (no NFL team: cut him if you need the taxi slot)') + '.' })); });
            const cuts = plan.candidates.slice(0, 8).map(strip);
            const fixIR = ir_moves.filter(m => m.to === 'active');
            const toIR = ir_moves.filter(m => m.to === 'IR' && m.eligible === true);
            let decision, recommendation;
            const first = cuts[0];
            if (fixIR.length) { decision = 'activate_from_ir'; recommendation = 'Activate ' + fixIR.map(m => m.player).join(', ') + ' from IR first: Sleeper won\'t process adds while an ineligible player sits there.'; }
            else if (c.max != null && c.open < 0) { decision = 'cut_now'; recommendation = 'You\'re ' + (-c.open) + ' over the active limit (' + c.active + '/' + c.max + ')' + (toIR.length ? ': move ' + toIR.map(m => m.player).join(', ') + ' to IR' : '') + (first ? (toIR.length ? ', then cut ' : ': cut ') + first.player + ' (' + first.why.replace(/\.$/, '') + ')' : '') + '.'; }
            else if (toIR.length) { decision = 'use_ir_first'; recommendation = 'Move ' + toIR.map(m => m.player).join(', ') + ' to IR to free ' + (toIR.length > 1 ? toIR.length + ' active spots' : 'an active spot') + ' before cutting anyone.'; }
            else if (c.max != null && c.open === 0) { decision = 'full'; recommendation = 'Your active roster is full (' + c.active + '/' + c.max + '), so any add needs a drop' + (first ? '; the first safe drop is ' + first.player + ' (' + first.why.replace(/\.$/, '') + ').' : ', and nobody on it is a safe cut right now.'); }
            else if (c.max != null) { decision = 'open_spots'; recommendation = 'You have ' + c.open + ' open active spot' + (c.open > 1 ? 's' : '') + ' (' + c.active + '/' + c.max + '): no cut needed to add.'; }
            else { decision = 'unknown_limit'; recommendation = 'This league\'s roster limit isn\'t in the settings, so check the cut list only if you need a spot.'; }
            const depth = {};
            const slots = dedicatedSlots();
            Object.keys(slots).forEach(pos => { depth[pos] = { slots: slots[pos], active_healthy: c.activeIds.filter(pid => h.ppos(pid) === pos && !INJ_OUT.has(injOf(pid))).length }; });
            const evidence = [
                'Active ' + c.active + '/' + (c.max != null ? c.max : '?') + ', taxi ' + c.taxi + '/' + c.taxi_max + ', IR ' + c.ir + '/' + c.ir_max + '.',
                'IR allows: IR' + Object.keys(IR_KEYS).filter(k => Number(st[IR_KEYS[k]]) === 1).map(k => ', ' + k).join('') + '. Not allowed: ' + (Object.keys(IR_KEYS).filter(k => Number(st[IR_KEYS[k]]) !== 1).join(', ') || 'none') + '.',
                deadline ? 'Taxi: ' + c.taxi_max + ' slots, players under ' + years + ' years in the league, deadline week ' + deadline + '.' : 'No taxi deadline set.',
                'Depth counts active, healthy players only (taxi and IR are not depth).',
            ];
            if (plan.window) evidence.push('Team window: ' + plan.window + '.');
            return {
                decision, confidence: c.max != null ? 'high' : 'low', recommendation,
                cut_candidates: cuts,
                keep_despite_low_value: keep.slice(0, 15),
                ir_moves, taxi_moves: taxi_moves.slice(0, 8),
                roster_count: { active: c.active, max: c.max, open: c.open, taxi: c.taxi, taxi_max: c.taxi_max, ir: c.ir, ir_max: c.ir_max },
                depth,
                evidence,
                rules_applied: [
                    'Only active-roster players are drops; taxi and IR never are (they don\'t free an active spot).',
                    'Free moves (IR, activation) before any cut.',
                    'IR eligibility follows this league\'s reserve_allow_* settings; IR status is always eligible.',
                    'Never cut: starters, locked players, untouchable/trade tags, handcuffs to your own starters, young risers, injured players worth ' + STASH_VALUE + '+, the last healthy body at a slot, or a 0 that is an engine gap.',
                    'Engine 0 for an Inactive (IR) player is replaced by a healthy-equivalent peer value (value_source ir_fallback); a player the engine never scored is unknown, not 0.',
                    isDynasty() ? 'Dynasty keep score = value + 50 x this week\'s projection + 300 upside (rookie/2nd year or 3+ peak years; not kickers).' : 'Redraft: keep score = this week\'s projection only.',
                    'Taxi deadline read as: no new taxi moves after that week (Sleeper\'s exact rule not verified).',
                ],
                method: METHOD,
            };
        },
    });

    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.AskRoster;
})(typeof window !== 'undefined' ? window : globalThis);
