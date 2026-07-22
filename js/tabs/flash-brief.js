// ══════════════════════════════════════════════════════════════════
// js/tabs/flash-brief.js — IntelligenceBriefWidget + FieldNotesWidget
// These are dashboard widget components, consumed by DashboardPanel
// in js/tabs/dashboard.js via window.IntelligenceBriefWidget /
// window.FieldNotesWidget. The old FlashBriefPanel 2×2 tab was
// removed — ticker/standings now render only from dashboard.js.
// ══════════════════════════════════════════════════════════════════

function ordinal(n) { const s = ['th','st','nd','rd']; const v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); }

// Phone tier (≤767, plan Phase 2 item 11 wave 1): the xl brief splits into
// two ~160px columns at 375 (prose | 2×2 action grid) and the xxl KPI /
// position strips cut ~343px of content into 6–8 cells of ~40-50px. Stack
// the xl split and re-wrap the strips to 3×2 / 4×2. Injected once at load;
// !important beats the inline grid styles. ≥768 (tablet/desktop) unchanged.
(function injectBriefPhoneCss() {
    if (typeof document === 'undefined' || document.getElementById('wr-brief-phone-css')) return;
    const st = document.createElement('style');
    st.id = 'wr-brief-phone-css';
    st.textContent = '@media(max-width:767px){' +
        '.wr-ib-xl-body{grid-template-columns:minmax(0,1fr) !important;}' +
        '.wr-ib-xl-actions{grid-template-columns:minmax(0,1fr) !important;}' +
        '.wr-ib-kpi-strip{grid-template-columns:repeat(3,1fr) !important;}' +
        '.wr-ib-pos-strip{grid-template-columns:repeat(4,1fr) !important;}' +
        '}';
    document.head.appendChild(st);
})();

// The four tier-message keys (elite/contender/crossroads/rebuilding) are
// POOLS — AlexVoice.pick chooses one per league+week seed, so the read is
// stable across re-renders but the phrasing rolls when the week does.
// Greeting/waiver/trade/draft/rank stay single-variant by design (owner
// call, de-busying plan Q4 — wider seeding waits for the hybrid-AI voice).
// One canonical Alex voice (owner ruling 2026-07-08): the 7-preset
// BRIEF_PERSONALITY table (selected via wr_alex_style / GM alexPersonality
// through GM_VOICE_TO_BRIEF) is retired — this is the single voice for
// everyone. Stored wr_alex_style / strategy alexPersonality values are
// ignored here: tolerated, never migrated.
const BRIEF_VOICE = {
    greeting: (t, name) => (t < 12 ? 'Good morning' : t < 17 ? 'Good afternoon' : 'Good evening') + ', ' + name + '.',
    elite: [
        (rank, hs) => "Your roster is elite — top of the food chain right now.",
        (rank, hs) => "This roster is the class of the league — the target's on your back now.",
        (rank, hs) => "Elite territory. Everyone else is chasing you.",
    ],
    contender: [
        (rank, hs) => "Your roster's sitting in solid shape — " + ordinal(rank) + " in the league with a health score of " + hs + ". You're right in the mix.",
        (rank, hs) => "You're a legit contender — " + ordinal(rank) + " with a health score of " + hs + ", well within striking distance.",
        (rank, hs) => "Sitting " + ordinal(rank) + " with a health score of " + hs + " — one sharp move could tip this your way.",
    ],
    crossroads: [
        (rank, hs) => "You're at a crossroads — ranked " + ordinal(rank) + " with a health score of " + hs + ". Some decisions coming up that'll define your direction.",
        (rank, hs) => "Ranked " + ordinal(rank) + ", health score " + hs + " — you could push in or pull back, and I'd rather we choose than drift.",
        (rank, hs) => "This is a fork-in-the-road roster — " + ordinal(rank) + ", health score " + hs + ". The next move sets your direction.",
    ],
    rebuilding: [
        (rank, hs) => "Rebuilding mode — ranked " + ordinal(rank) + ". Health score is " + hs + ". But that's where the opportunity is.",
        (rank, hs) => "You're rebuilding from " + ordinal(rank) + " with a health score of " + hs + " — the goal right now is assets, not wins.",
        (rank, hs) => "Ranked " + ordinal(rank) + ", health score " + hs + ". Rebuilds reward patience — stack picks and youth.",
    ],
    waiver: (name, pos, dhq) => "I've been watching the wire — " + name + " is sitting out there unclaimed.",
    trade: (count) => "I've mapped out the owners in your league. A few look ripe for a deal.",
    draft: (days, date) => "Draft is " + days + " day" + (days !== 1 ? 's' : '') + " out. Time to sharpen your board.",
    rank: (rank, tier) => "You're #" + rank + " in the league pecking order right now.",
};

// ══════════════════════════════════════════════════════════════════
// IntelligenceBriefWidget — Alex's greeting + action CTAs
// Renders as a dashboard widget at md / lg / xl sizes. The xl size
// spans the full dashboard grid width for the premium landing look.
// ══════════════════════════════════════════════════════════════════
function IntelligenceBriefWidget({
  size = 'xl',
  myRoster,
  rankedTeams,
  sleeperUserId,
	  currentLeague,
	  briefDraftInfo,
	  playersData,
	  statsData,
	  prevStatsData,
	  timeRecomputeTs,
	  setActiveTab,
	  navigateWidget,
	}) {
    // GM Strategy is the single source of truth for plan substance — drives
    // the strategy-frame lead line and the fallback waiver filters (faFilters).
    // Its legacy alexPersonality field no longer selects a voice — one
    // canonical Alex (owner ruling 2026-07-08).
    const gm = window.WR.GmMode.useGmEffects(currentLeague);

    const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: currentLeague?.rosters }) || { isUsable: true };
    const myAssess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null;
    const tier = (myAssess?.tier || 'UNKNOWN').toUpperCase();
    const hs = myAssess?.healthScore || 0;
    const needs = rosterState.isUsable ? (myAssess?.needs || []) : [];
    const elites = rosterState.isUsable && typeof window.App?.countElitePlayers === 'function' ? window.App.countElitePlayers(myRoster?.players || []) : 0;
    // Read powerRank DIRECTLY from the one engine — the same value the elites
    // badge shows — so the pecking-order line can't drift from it. A team's
    // position in rankedTeams can differ by one from its true powerRank on a
    // tie or a mid-load recompute; that drift produced "#8 pecking order" next
    // to "#7 elites badge". Fall back to the list position only if the engine
    // hasn't produced a rank yet.
    const myRank = rosterState.isUsable
        ? ((myAssess && myAssess.powerRank) || ((rankedTeams || []).findIndex(t => t.userId === sleeperUserId) + 1))
        : 0;
    const scores = window.App?.LI?.playerScores || {};
    const ownerProfiles = window.App?.LI?.ownerProfiles || {};

    // FAAB
    const budget = currentLeague?.settings?.waiver_budget || 0;
    const spent = myRoster?.settings?.waiver_budget_used || 0;
    const faabRemaining = Math.max(0, budget - spent);

	    // free-agency.js is a deferred module group (see js/module-loader.js); it owns
	    // getFreeAgencyBriefTarget. Kick off the load and recompute once it lands so the
	    // brief upgrades from the rough waiver heuristic to the real action target.
	    const [faModuleTick, setFaModuleTick] = useState(0);
	    useEffect(() => {
	        if (typeof window.App?.getFreeAgencyBriefTarget === 'function') return;
	        if (!window.wrLoadModuleGroup) return;
	        let alive = true;
	        window.wrLoadModuleGroup('fa').then(() => { if (alive) setFaModuleTick(1); }).catch(() => {});
	        return () => { alive = false; };
	    }, []);

	    // Best waiver target
	    const waiverTarget = useMemo(() => {
	        if (!rosterState.isUsable) return null;
	        const hasActionTargetHelper = typeof window.App?.getFreeAgencyBriefTarget === 'function';
	        const actionTarget = hasActionTargetHelper ? window.App.getFreeAgencyBriefTarget({
	            playersData,
	            statsData,
	            prevStatsData,
	            myRoster,
	            currentLeague,
	            briefDraftInfo,
	            rosterState,
	        }) : null;
	        if (actionTarget) {
	            return {
	                pid: actionTarget.pid,
	                name: actionTarget.name || actionTarget.p?.full_name || '',
	                dhq: actionTarget.dhq || 0,
	                pos: actionTarget.pos || '',
	                team: actionTarget.p?.team || actionTarget.team || '',
	                why: actionTarget.why,
	                faab: actionTarget.faab,
	            };
	        }
	        if (hasActionTargetHelper) return null;
	        if (!needs.length) return null;
	        const normPos = window.App?.normPos || (p => p);
        const rostered = new Set();
        (currentLeague?.rosters || []).forEach(r => (r.players || []).concat(r.taxi || [], r.reserve || []).forEach(pid => rostered.add(String(pid))));
        // GM Strategy FA filters — keep this rough fallback consistent with the FA tab.
        const faF = gm.faFilters || null;
        const faMinDhq = Number(faF?.minDhq) || 0;
        const faMaxAge = Number(faF?.maxAge) || 0;
        const faExclude = new Set((Array.isArray(faF?.excludePositions) ? faF.excludePositions : [])
            .map(x => String(normPos(x) || x).toUpperCase()).filter(Boolean));
        const passesGmFa = (pid, p, pos) => {
            if (faMinDhq && (scores[pid] || 0) < faMinDhq) return false;
            if (faExclude.has(String(pos).toUpperCase())) return false;
            if (faMaxAge && Number(p.age) && Number(p.age) > faMaxAge) return false;
            return true;
        };
        const needPos = typeof needs[0] === 'string' ? needs[0] : needs[0]?.pos;
        if (!needPos) return null;
        const candidates = Object.entries(playersData || {})
            .filter(([pid, p]) => !rostered.has(pid) && normPos(p.position) === needPos && p.team && p.active !== false && (scores[pid] || 0) >= 1500 && passesGmFa(pid, p, needPos))
            .map(([pid, p]) => ({ pid, name: p.full_name || '', dhq: scores[pid] || 0, pos: needPos, team: p.team }))
            .sort((a, b) => b.dhq - a.dhq);
        if (!candidates.length && needs.length > 1) {
            for (let i = 1; i < Math.min(needs.length, 4); i++) {
                const altPos = typeof needs[i] === 'string' ? needs[i] : needs[i]?.pos;
                if (!altPos) continue;
                const alt = Object.entries(playersData || {})
                    .filter(([pid, p]) => !rostered.has(pid) && normPos(p.position) === altPos && p.team && p.active !== false && (scores[pid] || 0) >= 1500 && passesGmFa(pid, p, altPos))
                    .map(([pid, p]) => ({ pid, name: p.full_name || '', dhq: scores[pid] || 0, pos: altPos, team: p.team }))
                    .sort((a, b) => b.dhq - a.dhq);
                if (alt.length) return alt[0];
            }
        }
        return candidates[0] || null;
	    }, [rosterState.isUsable, needs, playersData, statsData, prevStatsData, myRoster, currentLeague, briefDraftInfo, scores, timeRecomputeTs, faModuleTick, gm.faFilters]);

    // Sell-rule trips — rostered players whose position/age trips a GM sell
    // rule or sell-position (untouchables excluded). Feeds the 'GM plan says
    // move them' action below; same parse the My Roster nudge uses.
    const sellRuleTrips = useMemo(() => {
        if (!gm.hasStrategy || !rosterState.isUsable) return [];
        const normPos = window.App?.normPos || (p => p);
        const parseRule = window.GMStrategy?.parseSellRule;
        const rules = (gm.sellRules || [])
            .map(r => { try { return parseRule ? parseRule(r) : null; } catch (_) { return null; } })
            .filter(r => r && (r.pos || r.ageAbove));
        const sellPos = gm.sellPositions instanceof Set ? gm.sellPositions : new Set();
        const unt = gm.untouchable instanceof Set ? gm.untouchable : new Set();
        if (!rules.length && !sellPos.size) return [];
        return (myRoster?.players || []).map(pid => {
            if (unt.has(String(pid))) return null;
            const p = playersData?.[pid];
            if (!p) return null;
            const pos = normPos(p.position) || p.position;
            const trips = sellPos.has(pos) || rules.some(r => (!r.pos || r.pos === pos) && (!r.ageAbove || (Number(p.age) && Number(p.age) >= r.ageAbove)));
            if (!trips) return null;
            return { pid, name: p.full_name || pid, pos, dhq: scores[pid] || 0 };
        }).filter(Boolean).sort((a, b) => b.dhq - a.dhq).slice(0, 3);
    }, [gm.hasStrategy, gm.sellRules, gm.sellPositions, gm.untouchable, myRoster, playersData, scores, rosterState.isUsable]);

    // Key drops (high-value players dropped in last 3 weeks)
    const keyDrops = useMemo(() => {
        const drops = [];
        const transactions = window.S?.transactions || {};
        const curWeek = window.S?.currentWeek || 1;
        for (let w = curWeek; w >= Math.max(1, curWeek - 2); w--) {
            ((transactions['w' + w]) || []).forEach(t => {
                if (t.type !== 'free_agent' && t.type !== 'waiver') return;
                Object.keys(t.drops || {}).forEach(pid => {
                    const dhq = scores[pid] || 0;
                    if (dhq >= 1500) drops.push({ pid, name: playersData?.[pid]?.full_name || '?', dhq, pos: playersData?.[pid]?.position || '?' });
                });
            });
        }
        return drops.sort((a, b) => b.dhq - a.dhq).slice(0, 3);
    }, [scores, playersData]);

    // Draft countdown
    const draftCountdown = useMemo(() => {
        if (!briefDraftInfo?.start_time || briefDraftInfo.status !== 'pre_draft') return null;
        const diff = briefDraftInfo.start_time - Date.now();
        if (diff <= 0) return null;
        const days = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        return { days, hours, date: new Date(briefDraftInfo.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
    }, [briefDraftInfo]);

    // Active trades in league — the brief says "recently", so window to the
    // last ~3 week buckets and skip DHQ-merged historical trades (_fromDHQ),
    // which can span prior seasons.
    const activeTrades = useMemo(() => {
        const txns = window.S?.transactions || {};
        const curWeek = window.S?.currentWeek || 1;
        let n = 0;
        for (let w = curWeek; w >= Math.max(0, curWeek - 2); w--) {
            ((txns['w' + w]) || []).forEach(t => { if (t.type === 'trade' && !t._fromDHQ) n++; });
        }
        return n;
    }, []);

    // Greeting based on time of day — one canonical Alex voice (2026-07-08):
    // the GM_VOICE_TO_BRIEF / wr_alex_style persona selection is retired.
    const hour = new Date().getHours();
    const userName = window.S?.user?.display_name || window.S?.user?.username || 'Commander';
    const p = BRIEF_VOICE;
    const greetingText = p.greeting(hour, userName);
    // Date stamp for the brief header (owner's living-brief template).
    let briefDate = '';
    try { briefDate = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(); } catch (e) { briefDate = ''; }

    // Build Alex's conversational briefing
    const needPos = needs.length ? (typeof needs[0] === 'string' ? needs[0] : needs[0]?.pos) : '';
    // Seeded tier read: stable within a league+week (no flicker across
    // re-renders), fresh phrasing when the week rolls over.
    const tierSeed = String(currentLeague?.league_id || currentLeague?.id || 'wr') + ':w' + (window.S?.currentWeek || 0) + ':' + tier;
    const pickTier = (pool) => {
        const arr = Array.isArray(pool) ? pool : [pool];
        const fn = (window.AlexVoice && typeof window.AlexVoice.pick === 'function') ? window.AlexVoice.pick(tierSeed, arr) : arr[0];
        return typeof fn === 'function' ? fn(myRank, hs) : String(fn || '');
    };
    // UNKNOWN tier = assessment hasn't loaded — never let it fall through to
    // the rebuilding copy ('ranked 0th, health score 0' as fact). Same for a
    // known tier with no rank yet: don't interpolate ordinal(0).
    const tierMsg = !rosterState.isUsable ? (rosterState.brief || 'Roster sync incomplete. I paused roster, trade, waiver, and league-rank recommendations until player IDs finish loading.')
        : (!myAssess || tier === 'UNKNOWN') ? 'Still syncing your league read — I’ll have your tier, rank, and health score once the data lands.'
        : tier === 'ELITE' ? pickTier(p.elite)
        : myRank <= 0 ? ('Your roster reads ' + tier + ' with a health score of ' + hs + ' — league rank is still syncing.')
        : tier === 'CONTENDER' ? pickTier(p.contender)
        : tier === 'CROSSROADS' ? pickTier(p.crossroads)
        : pickTier(p.rebuilding);

    // AlexSettings focus areas — the narrative fragments are gated by whichever
    // areas the user has enabled, so turning off "trades" or "waivers" in
    // Alex Insights quiets those lines here too.
    const alexFocus = (window.WR?.AlexSettings?.get?.()?.focus) || { trades: true, waivers: true, gmStyle: true };

    // ONE strategy-frame lead sentence (owner rule: frame only — never restate
    // adjacent KPIs). Built from the committed GM plan, not the roster grade.
    const TIMELINE_FRAME = { '1_year': 'all-in on this season', '2_3_years': 'building for a 2-3 year window', 'dynasty_long': 'playing the long game' };
    const strategyFrame = gm.hasStrategy
        ? 'Your plan: ' + (gm.modeLabel || gm.mode) + ', ' + (TIMELINE_FRAME[gm.timeline] || 'on your timeline') + ' — everything below is read against that.'
        : '';

    // Three-sentence summary — fits a 160px-tall md row, no scroll
    const threeSentence = (() => {
        if (!rosterState.isUsable) return tierMsg + ' ' + rosterState.message;
        const parts = [];
        if (strategyFrame) parts.push(strategyFrame);
        parts.push(tierMsg);
        if (needPos && alexFocus.gmStyle !== false) parts.push(`Biggest gap: ${needPos}.`);
        else if (elites > 0) parts.push(`${elites} elite anchor${elites > 1 ? 's' : ''}.`);
        if (waiverTarget && alexFocus.waivers !== false) parts.push(`${waiverTarget.name} (${waiverTarget.pos}) sitting on the wire.`);
        else if (draftCountdown) parts.push(draftCountdown.days === 0 ? 'Draft is today.' : `Draft in ${draftCountdown.days} day${draftCountdown.days !== 1 ? 's' : ''}.`);
        else if (activeTrades > 0 && alexFocus.trades !== false) parts.push(`${activeTrades} recent trade${activeTrades > 1 ? 's' : ''} in your league.`);
        else if (myRank > 0) parts.push(`Ranked ${ordinal(myRank)} in the league.`);
        else parts.push('League rank still syncing.');
        return parts.slice(0, 3).join(' ');
    })();

    // One-sentence headline — used at lg
    const oneSentence = tierMsg;

    // Header avatar renders via the canonical AlexAvatar component
    // (components.js photo/badge vocabulary). Legacy emoji ids stored on
    // wr_alex_avatar fall back to the default badge inside the renderer —
    // no broken images.

    const cardStyle = { background: 'var(--black)', border: 'var(--card-border, 1px solid var(--acc-line1, rgba(212,175,55,0.2)))', borderRadius: 'var(--card-radius, 10px)', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
    const goTo = (target) => {
        if (navigateWidget) navigateWidget(target);
        else if (setActiveTab) setActiveTab(target);
    };
    // Power Rankings is a widget on this same dashboard (not a tab), so a click
    // scrolls to it. Falls back to the analytics tab if it isn't on the board.
    const scrollToPowerRankings = () => {
        try {
            const heading = Array.from(document.querySelectorAll('*'))
                .find(e => e.childElementCount === 0 && /^power rankings$/i.test(String(e.textContent || '').trim()));
            if (heading) {
                let card = heading;
                for (let i = 0; i < 8 && card.parentElement; i++) { card = card.parentElement; if (card.offsetHeight > 200) break; }
                if (card && typeof card.scrollIntoView === 'function') { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
            }
        } catch (e) { /* fall through */ }
        goTo('analytics');
    };
    // Trade news links to the Transaction Ticker widget on this same dashboard
    // (heading renders as "📰 TRANSACTION TICKER"). Falls back to Power Rankings.
    const scrollToTransactions = () => {
        try {
            // The ticker card carries a stable anchor (dashboard.js).
            let card = document.querySelector('[data-wr-widget="transaction-ticker"]');
            if (!card) {
                const heading = Array.from(document.querySelectorAll('*'))
                    .find(e => /transaction ticker/i.test(String(e.textContent || '').trim()) && e.querySelectorAll('*').length < 4);
                if (heading) { card = heading; for (let i = 0; i < 8 && card.parentElement; i++) { card = card.parentElement; if (card.offsetHeight > 200) break; } }
            }
            if (card && typeof card.scrollIntoView === 'function') { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        } catch (e) { /* fall through */ }
        scrollToPowerRankings();
    };

    // ── Action list (priority-ordered, focus-gated) ─────────────────
    let actions = [];
    if (!rosterState.isUsable) {
        const rosterCopy = rosterState.leagueSkin?.copy?.rosterData || {};
        const isPreDraftEmpty = !!rosterState.isPreDraftRosterEmpty;
        actions.push({
            icon: isPreDraftEmpty ? '📋' : '↻',
            tab: rosterCopy.actionTarget === 'draft' ? 'draft' : 'myteam',
            title: isPreDraftEmpty ? 'Open draft prep while rosters are empty.' : 'Re-sync roster data before making a move.',
            detail: rosterState.message + ' ' + rosterState.detail,
        });
    } else {
    // GM Strategy annotation: flag the waiver target when it fills a position
    // the plan says to acquire (same tag FA's priority adds compute).
    const waiverIsGmTarget = !!(waiverTarget && gm.hasStrategy && gm.targetPositions instanceof Set && gm.targetPositions.has(String(waiverTarget.pos)));
    if (alexFocus.waivers !== false && waiverTarget) {
        actions.push({
            icon: '🎯', tab: 'fa',
	            title: p.waiver(waiverTarget.name, waiverTarget.pos, waiverTarget.dhq),
	            detail: [
	                React.createElement('span', { key: 'n', style: { color: 'var(--gold)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }, onClick: e => { e.stopPropagation(); if (typeof window.openPlayerModal === 'function' && waiverTarget.pid) window.openPlayerModal(waiverTarget.pid); } }, waiverTarget.name),
	                ` · ${waiverTarget.pos} · DHQ ${waiverTarget.dhq.toLocaleString()} · ${waiverTarget.why || ('Fills your ' + waiverTarget.pos + ' gap.')}${waiverIsGmTarget ? ' · GM plan: target position' : ''}`,
	            ],
	        });
    }
    if (alexFocus.waivers !== false && keyDrops.length > 0) {
        actions.push({
            icon: '⚠️', tab: 'fa',
            title: `Heads up — ${keyDrops.length > 1 ? 'some high-value players hit' : 'a high-value player hit'} the wire recently.`,
            detail: [
                ...keyDrops.map((d, i) => [
                    i > 0 ? ', ' : '',
                    React.createElement('span', { key: d.pid || i, style: { color: 'var(--gold)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }, onClick: e => { e.stopPropagation(); if (typeof window.openPlayerModal === 'function' && d.pid) window.openPlayerModal(d.pid); } }, `${d.name} (${d.pos}, ${d.dhq.toLocaleString()})`),
                ]).flat(),
                '. Might be worth scooping up before someone else does.',
            ],
        });
    }
    // Sell-rule action — the GM plan's own move. Rebuild / sell-high plans
    // act on sells FIRST (front of the queue); otherwise it slots ahead of
    // the generic trade CTA.
    if (alexFocus.trades !== false && sellRuleTrips.length > 0) {
        const sellAction = {
            icon: '📉', tab: 'myteam',
            title: sellRuleTrips.length + ' rostered player' + (sellRuleTrips.length > 1 ? 's trip' : ' trips') + ' your sell rules.',
            detail: sellRuleTrips.map(t => t.name + ' (' + t.pos + ')').join(', ') + ' — your GM plan says move ' + (sellRuleTrips.length > 1 ? 'them' : 'him') + ' while the value holds.',
        };
        if (gm.mode === 'rebuild' || gm.marketPosture === 'sell_high') actions.unshift(sellAction);
        else actions.push(sellAction);
    }
    if (alexFocus.trades !== false) {
        actions.push({
            icon: '🔄', tab: 'trades',
            title: p.trade(Object.keys(ownerProfiles).length),
            detail: 'Let me show you who needs what — and what you could get in return.',
        });
    }
    if (alexFocus.draft !== false && draftCountdown) {
        actions.push({
            icon: '📋', tab: 'draft',
            // '0 days out' reads wrong — inside 24h the draft is today.
            title: draftCountdown.days === 0 ? 'Draft is today. Time to lock in your board.' : p.draft(draftCountdown.days, draftCountdown.date),
            detail: `${draftCountdown.date} · I've got your scouting report ready when you are.`,
        });
    }
    actions.push({
        icon: '🏆', tab: 'analytics',
        // No rank/tier claims until the assessment has actually landed.
        title: (myRank > 0 && tier !== 'UNKNOWN') ? p.rank(myRank, tier) : 'League standings still syncing — see how the field stacks up.',
        detail: (tier !== 'UNKNOWN' ? `${tier} tier · ` : '') + 'See where everyone else stands.',
    });
    }

    // ── Reusable action button ───────────────────────────────────────
    const baseBtn = { background: 'var(--acc-fill1, rgba(212,175,55,0.05))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', borderRadius: '10px', color: 'var(--gold)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 500, textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: '10px', transition: 'all 0.15s', lineHeight: 1.4 };
    function renderActionBtn(a, key, opts = {}) {
        const compact = !!opts.compact;
        const btnStyle = {
            ...baseBtn,
            padding: compact ? '6px 10px' : '12px 16px',
            minHeight: '44px',
            fontSize: compact ? '0.72rem' : '0.82rem',
            ...(opts.style || {}),
        };
        return React.createElement('button', {
            key,
            onClick: () => goTo(a.tab), style: btnStyle,
            onMouseEnter: e => e.currentTarget.style.background = 'var(--acc-fill3, rgba(212,175,55,0.15))',
            onMouseLeave: e => e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.05))',
        },
            React.createElement('span', { style: { fontSize: compact ? '0.85rem' : '1rem', flexShrink: 0 } }, a.icon),
            React.createElement('div', { style: { minWidth: 0, flex: 1 } },
                React.createElement('div', { style: { fontWeight: 600, color: 'var(--white)', fontSize: compact ? '0.74rem' : '0.85rem' } }, a.title),
                !compact && React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: '2px' } },
                    Array.isArray(a.detail) ? a.detail : a.detail
                ),
            ),
        );
    }

    // ── Reusable header ─────────────────────────────────────────────
    function header(opts = {}) {
        const tight = !!opts.tight;
        return React.createElement('div', { style: { padding: tight ? '8px 14px 6px' : '20px 20px 0', borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))', paddingBottom: tight ? '6px' : '12px', flexShrink: 0 } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: tight ? '2px' : '4px' } },
                React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: tight ? '0.62rem' : '0.72rem', color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' } },
                    window.AlexAvatar ? React.createElement(window.AlexAvatar, { size: tight ? 14 : 16 }) : null,
                    'INTELLIGENCE BRIEFING',
                ),
                // Living-brief date stamp (owner's template) — right-aligned.
                React.createElement('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: tight ? '0.6rem' : '0.68rem', color: 'var(--silver)', opacity: 0.7, letterSpacing: '0.04em', whiteSpace: 'nowrap' } }, briefDate),
            ),
            React.createElement('div', { style: { fontSize: tight ? '0.92rem' : '1.2rem', fontWeight: 700, color: 'var(--white)' } }, greetingText),
            // AI Conductor — Situation Room "what changed" line. Renders only
            // when the flag is on AND something material changed since last
            // visit; otherwise returns null. Suppressed (noPulse) on the sizes
            // whose body carries the structured brief, which leads with its own
            // quiet 24-hour line.
            (!opts.noPulse && window.WR && window.WR.BriefPulse && window.WR.BriefPulse.Line)
                ? React.createElement(window.WR.BriefPulse.Line, { league: currentLeague, roster: myRoster, playersData: playersData, tight: tight })
                : null,
        );
    }

    // ── 24-hour lead read (owner's line 1) ──────────────────────────
    // Compute the "what changed since last visit" read once, read-only, then
    // acknowledge it via an effect (save the snapshot) so a real change shows
    // once and then settles back to the steady line. Mirrors BriefPulse.Line's
    // internals, but lets us render line 1 as a full bullet like the others.
    let leadChangeText = 'No change in League rankings or posture over the past 24 hours.';
    let _leadCurr = null, _leadLeagueId = null, _leadMaterial = false, _leadEyes = false;
    try {
        if (window.WR && window.WR.SituationRoom && typeof window.WR.SituationRoom.enabled === 'function' && window.WR.SituationRoom.enabled() && window.WR.BriefPulse && window.WR.BriefPulse.readNow && rosterState.isUsable && currentLeague && myRoster) {
            // readNow attaches the league-trade radar (a rival blockbuster the
            // roster-only diff can't see) before diffing against last visit.
            const rd = window.WR.BriefPulse.readNow(currentLeague, myRoster, playersData);
            _leadCurr = rd.curr; _leadLeagueId = rd.leagueId;
            if (rd.material && rd.line) { leadChangeText = rd.line; _leadMaterial = true; _leadEyes = !!rd.eyes; }
        }
    } catch (e) { /* keep the steady no-change line */ }
    useEffect(() => {
        if (!_leadMaterial || !_leadCurr || !(window.WR && window.WR.BriefPulse && window.WR.BriefPulse.saveSnapshot)) return;
        try { window.WR.BriefPulse.saveSnapshot(_leadLeagueId, { fingerprint: _leadCurr.fingerprint, players: _leadCurr.players, record: _leadCurr.record, tier: _leadCurr.tier, draftPhase: _leadCurr.draftPhase, rank: _leadCurr.rank }); } catch (e) {}
    }, [_leadMaterial, _leadCurr && _leadCurr.fingerprint]);

    // ── Structured "living brief" body (owner's template) ───────────
    // Each line fills from live data and is OMITTED entirely when its data
    // isn't available (never a blank / "___"). Every data line carries a
    // tappable source that jumps to the tab it's pulled from. The cutdown-date
    // line is intentionally left out — Sleeper doesn't expose it (owner call).
    function renderIntelBody(opts = {}) {
        const compact = !!opts.compact;
        const bodyFs = compact ? '0.82rem' : 'var(--text-body, 1rem)';

        const val = (t, col) => React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: col } }, t);
        const chip = (t) => React.createElement('span', { key: t, style: { display: 'inline-block', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82em', fontWeight: 700, padding: '0 6px', borderRadius: '4px', margin: '0 3px 0 0', background: 'rgba(232,106,90,0.13)', color: 'var(--bad, #e86a5a)', border: '1px solid rgba(232,106,90,0.28)' } }, t);

        // Roster capacity — read live from the league + your roster.
        const rosterPositions = currentLeague?.roster_positions || [];
        const activeCap = rosterPositions.length;
        const taxiCap = currentLeague?.settings?.taxi_slots || 0;
        const irCap = currentLeague?.settings?.reserve_slots || 0;
        const totalCap = activeCap + taxiCap + irCap;
        const taxiCount = (myRoster?.taxi || []).length;
        const irCount = (myRoster?.reserve || []).length;
        const totalPlayers = (myRoster?.players || []).length;
        const activeCount = Math.max(0, totalPlayers - taxiCount - irCount);

        const weakPos = needs.map(n => (typeof n === 'string' ? n : n?.pos)).filter(Boolean).slice(0, 4);
        const hasWaiverNames = !!(waiverTarget || (keyDrops && keyDrops.length));

        // Each line leads with its own emoji instead of a shared ◆ bullet
        // (owner's brief spec 2026-07-21). The lead read is 📰 on a quiet day
        // and flips to 👀 whenever ANY material change or trade surfaces.
        const lines = [];
        // Line 1 — 24-hour lead read. A fresh league trade links to the
        // Transaction Ticker; otherwise it scrolls to Power Rankings.
        lines.push({ key: 'lead', icon: _leadMaterial ? '👀' : '📰', pr: !_leadEyes, txn: _leadEyes, src: _leadEyes ? 'Transaction Ticker' : 'Power Rankings', body: [leadChangeText] });
        // Line 2 — rank + health → Analytics tab.
        if (myRank > 0 && tier !== 'UNKNOWN') {
            lines.push({ key: 'rank', icon: '🎯', target: 'analytics', src: 'Analytics',
                body: ["You're ranked ", val(ordinal(myRank), 'var(--bad, #e86a5a)'), ' with an overall Health score of ', val(String(hs), 'var(--white)'), ' — ', React.createElement('strong', { key: 't', style: { color: 'var(--white)' } }, tier), ' tier.'] });
        }
        // Line 3 — roster count → My Roster.
        if (activeCap > 0) {
            const detail = taxiCap > 0
                ? [' — ', val(activeCount + '/' + activeCap, 'var(--silver)'), ' active · ', val(taxiCount + '/' + taxiCap, 'var(--silver)'), ' taxi']
                : [];
            lines.push({ key: 'roster', icon: '💪', target: 'myteam', src: 'My Roster',
                body: ['Roster: ', val(String(totalPlayers), 'var(--white)'), ' of ', val(String(totalCap), 'var(--white)'), ...detail] });
        }
        // Line 4 — positional weaknesses → My Roster.
        if (weakPos.length) {
            lines.push({ key: 'weak', icon: '🤔', target: 'myteam', src: 'My Roster',
                body: ['Key positional weaknesses: ', ...weakPos.map(chip)] });
        }
        // Line 5 — FAAB → Free Agency.
        if (budget > 0) {
            lines.push({ key: 'faab', icon: '💵', target: 'fa', src: 'Free Agency',
                body: ["You've got ", val('$' + faabRemaining.toLocaleString(), 'var(--k-7c6bf8, #7c6bf8)'), ' FAAB left' + (hasWaiverNames ? ', with names available on waivers.' : '.')] });
        }

        // Each line is a full, tappable bullet — click anywhere on it to jump
        // to the tab it's pulled from. The "↳ source →" hint shows the target.
        const kids = lines.map((ln, i) => React.createElement('div', {
            key: ln.key,
            onClick: () => (ln.txn ? scrollToTransactions() : ln.pr ? scrollToPowerRankings() : goTo(ln.target)),
            onMouseEnter: (e) => { e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.05))'; },
            onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent'; },
            style: { display: 'grid', gridTemplateColumns: '20px 1fr', gap: '10px', padding: compact ? '8px' : '11px 8px', borderTop: i === 0 ? 'none' : '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '6px', alignItems: 'start', cursor: 'pointer', transition: 'background 0.12s' },
        },
            React.createElement('div', { 'aria-hidden': 'true', style: { marginTop: '2px', fontSize: '14px', lineHeight: 1 } }, ln.icon || '◆'),
            React.createElement('div', { style: { minWidth: 0 } },
                React.createElement('div', { style: { fontSize: bodyFs, color: '#cdd3de', lineHeight: 1.5 } }, ...ln.body),
                React.createElement('div', { style: { marginTop: '3px', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem', letterSpacing: '0.03em', color: 'var(--gold-dim, #b8912f)' } }, '↳ ' + ln.src + ' →'),
            ),
        ));

        // Natural height (no flex-grow) so the action CTAs sit directly beneath
        // the last line instead of being pushed to the card's bottom edge.
        return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flexShrink: 0 } }, ...kids);
    }

    // ── Countdown to NFL Opening Day / fantasy kickoff (owner's Sep 9) ──
    // Pinned to the very bottom of the brief (marginTop: auto in the flex
    // column). Recomputes every render, rolls to next year once Sep 9 passes.
    function renderCountdown() {
        let days = null;
        try {
            const now = new Date();
            let t = new Date(now.getFullYear(), 8, 9);
            if (t.getTime() - now.getTime() < 0) t = new Date(now.getFullYear() + 1, 8, 9);
            days = Math.max(0, Math.ceil((t.getTime() - now.getTime()) / 86400000));
        } catch (e) { return null; }
        if (days == null) return null;
        return React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '9px', flexShrink: 0, marginTop: 'auto', padding: '11px 4px', borderTop: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))', background: 'linear-gradient(180deg, transparent, rgba(212,175,55,0.05))' },
        },
            React.createElement('span', { style: { fontSize: '1.15rem' } }, '🏈'),
            React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: '1.1rem', color: 'var(--gold)' } }, days === 0 ? 'KICKOFF' : String(days)),
            React.createElement('span', { style: { fontSize: '0.8rem', color: 'var(--silver)' } }, days === 0 ? 'NFL Opening Day is here!' : ((days === 1 ? 'day' : 'days') + ' to NFL Opening Day & fantasy kickoff')),
            React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem', color: 'var(--gold-dim, #b8912f)', letterSpacing: '0.04em', whiteSpace: 'nowrap' } }, '· SEP 9'),
        );
    }

    // ── Intel Brief is FREE for every tier (owner call 2026-07-11) ───
    // The full brief — tier read, action recs, CTAs — renders for free
    // users as the showcase that pulls them toward Pro. The teaser branch
    // below is kept for a future re-gate but never taken.
    const briefPro = true;
    if (!briefPro) {
        const tight = size === 'md' || size === 'lg' || size === 'xl';
        const teaserRows = [
            { label: "Alex's read", count: '1 briefing' },
            { label: 'Action items', count: actions.length + ' queued' },
        ];
        return React.createElement('div', { style: cardStyle },
            header({ tight }),
            React.createElement('div', { style: { padding: tight ? '10px 14px' : '14px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' } },
                ...teaserRows.map((r, i) => React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '7px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '2px', flexShrink: 0 } },
                    React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em' } }, r.label),
                    React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, fontFamily: "'JetBrains Mono', monospace" } }, r.count),
                )),
                typeof window.WrGatedMoreRow === 'function'
                    ? React.createElement(window.WrGatedMoreRow, {
                        title: 'Unlock the full brief',
                        sub: "Alex's roster read + " + actions.length + ' prioritized action' + (actions.length === 1 ? '' : 's'),
                        feature: 'briefing_reasoning',
                    })
                    : null,
            ),
        );
    }

    // ── md (2×1, 160px tall) — 3 sentences, no scroll ────────────────
    if (size === 'md') {
        return React.createElement('div', { onClick: () => goTo('alex'), style: { ...cardStyle, cursor: 'pointer' } },
            header({ tight: true }),
            React.createElement('div', { style: { padding: '10px 14px', flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden' } },
                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' } }, threeSentence),
            ),
        );
    }

    // ── lg (2×2, 320px tall) — 1 sentence + 3 actions, no scroll ─────
    if (size === 'lg') {
        const top3 = actions.slice(0, 3);
        return React.createElement('div', { style: cardStyle },
            header({ tight: true }),
            React.createElement('div', { style: { padding: '10px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' } },
                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', flexShrink: 0 } }, oneSentence),
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minHeight: 0 } },
                    ...top3.map((a, i) => renderActionBtn(a, 'lg-' + i, { compact: true, titleClamp: 1 })),
                ),
            ),
        );
    }

    // ── tall — living brief; fills its (3-row) slot, countdown pinned bottom
    if (size === 'tall') {
        return React.createElement('div', { style: cardStyle },
            header({ noPulse: true }),
            React.createElement('div', { style: { padding: '12px 18px 14px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '10px' } },
                renderIntelBody(),
                // Action cards moved off the board for now (owner call) — the
                // brief is the intel lines + kickoff countdown.
                renderCountdown(),
            ),
        );
    }

    // ── xl — living brief, single column (fills its slot) ──
    if (size === 'xl') {
        return React.createElement('div', { style: cardStyle },
            header({ tight: true, noPulse: true }),
            React.createElement('div', { style: { padding: '10px 16px 14px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '10px' } },
                renderIntelBody(),
                renderCountdown(),
            ),
        );
    }

    // ── xxl (4×4, ~640×640) — full real-estate dashboard ─────────────
    if (size === 'xxl') {
        const posBars = (window.App?.calcPosGrades?.(myRoster?.roster_id, currentLeague?.rosters, playersData) || []);

        const myDHQ = (myRoster?.players || []).reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0);
        const kpis = [
            { label: 'HEALTH', value: hs, col: hs >= 80 ? 'var(--good)' : hs >= 60 ? 'var(--gold)' : hs >= 40 ? 'var(--warn)' : 'var(--bad)' },
            { label: 'RANK', value: '#' + (myRank || '—'), col: 'var(--gold)' },
            { label: 'TIER', value: tier, col: tier === 'ELITE' ? 'var(--good)' : tier === 'CONTENDER' ? 'var(--gold)' : tier === 'CROSSROADS' ? 'var(--warn)' : 'var(--bad)' },
            { label: 'ELITES', value: elites, col: 'var(--good)' },
            { label: 'DHQ', value: myDHQ >= 1000 ? Math.round(myDHQ / 1000) + 'k' : myDHQ, col: 'var(--gold)' },
            { label: 'FAAB', value: budget > 0 ? '$' + faabRemaining : '—', col: 'var(--k-7c6bf8, #7c6bf8)' },
        ];

        return React.createElement('div', { style: cardStyle },
            header(),
            React.createElement('div', { style: { padding: '14px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' } },
                React.createElement('div', { className: 'wr-ib-kpi-strip', style: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px', flexShrink: 0 } },
                    ...kpis.map((k, i) => React.createElement('div', {
                        key: i,
                        style: { background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '6px', padding: '8px 6px', textAlign: 'center' },
                    },
                        React.createElement('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '1.1rem', fontWeight: 700, color: k.col, lineHeight: 1.1 } }, String(k.value)),
                        React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '3px' } }, k.label),
                    )),
                ),
                React.createElement('div', { style: { flexShrink: 0 } },
                    React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' } }, 'Position Health'),
                    React.createElement('div', { className: 'wr-ib-pos-strip', style: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '6px' } },
                        ...posBars.map((pb, i) => React.createElement('div', { key: i, style: { textAlign: 'center' } },
                            React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--silver)' } }, pb.pos),
                            React.createElement('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '1rem', fontWeight: 700, color: pb.col, lineHeight: 1, margin: '2px 0' } }, pb.grade),
                            React.createElement('div', { style: { height: 4, background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 2, overflow: 'hidden' } },
                                React.createElement('div', { style: { width: pb.pct + '%', height: '100%', background: pb.col } }),
                            ),
                            React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginTop: '2px', fontFamily: 'JetBrains Mono, monospace' } }, '#' + pb.rank + '/' + pb.totalTeams),
                        )),
                    ),
                ),
                // "Alex's Read" column dropped (de-busying Q2): its prose only
                // restated the KPI row above. Actions stand alone, full width,
                // non-compact so the detail lines carry the specifics.
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minHeight: 0, overflow: 'hidden' } },
                    React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em' } }, 'Action Items'),
                    ...actions.slice(0, 5).map((a, i) => renderActionBtn(a, 'xxl-' + i)),
                ),
            ),
        );
    }

    // Default: living-brief layout (same as tall)
    return React.createElement('div', { style: cardStyle },
        header({ noPulse: true }),
        React.createElement('div', { style: { padding: '12px 18px 14px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '10px' } },
            renderIntelBody(),
            // Action cards moved off the board for now (owner call).
            renderCountdown(),
        ),
    );
}

// ══════════════════════════════════════════════════════════════════
// FieldNotesWidget — Scout/War Room session log feed (v2)
// Groups entries by type (icon-derived) so users see a clear breakdown.
// All sizes are no-scroll: smaller sizes show counts/last entry, larger
// sizes show grouped sections with cap on entries per group.
// ══════════════════════════════════════════════════════════════════
function FieldNotesWidget({ size = 'lg', navigateWidget }) {
    const [fieldEntries, setFieldEntries] = useState([]);
    useEffect(() => {
        const fallback = () => {
            try {
                const raw = localStorage.getItem('scout_field_log_v1');
                if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) setFieldEntries(parsed.slice(0, 30)); }
            } catch {}
        };
        if (window.OD?.loadFieldLog) {
            window.OD.loadFieldLog(null, 30).then(data => {
                if (data && data.length) setFieldEntries(data);
                else fallback();
            }).catch(fallback);
        } else {
            fallback();
        }
    }, []);

    // Group entries by their `category` field (set when the action is logged).
    // Fall back to source-based grouping when category is missing.
    const CATEGORY_META = {
        roster:    { label: 'Roster moves',  color: 'var(--good)' },
        trade:     { label: 'Trade activity', color: 'var(--k-7c6bf8, #7c6bf8)' },
        waiver:    { label: 'Waiver moves',  color: 'var(--k-00c8b4, #00c8b4)' },
        draft:     { label: 'Draft prep',     color: 'var(--warn)' },
        research:  { label: 'Research',       color: 'var(--gold)' },
        league:    { label: 'League intel',   color: 'var(--info)' },
        scout:     { label: 'Scout sessions', color: 'var(--k-00c8b4, #00c8b4)' },
        warroom:   { label: 'Dynasty HQ',     color: 'var(--gold)' },
    };
    const classify = (e) => {
        const cat = (e.category || '').toLowerCase();
        if (cat && CATEGORY_META[cat]) return { key: cat, ...CATEGORY_META[cat] };
        // Fallback by source
        const fallback = e.source === 'warroom' ? 'warroom' : 'scout';
        return { key: fallback, ...CATEGORY_META[fallback] };
    };

    // Group entries by type, sorted by recency within
    const groups = useMemo(() => {
        const out = {};
        (fieldEntries || []).forEach(e => {
            const r = classify(e);
            if (!out[r.key]) out[r.key] = { key: r.key, label: r.label, color: r.color, entries: [] };
            out[r.key].entries.push(e);
        });
        Object.values(out).forEach(g => g.entries.sort((a, b) => (b.ts || 0) - (a.ts || 0)));
        return Object.values(out).sort((a, b) => b.entries.length - a.entries.length);
    }, [fieldEntries]);

    const totalCount = fieldEntries.length;
    const monoFont = "'JetBrains Mono', monospace";
    const cardStyle = { background: 'var(--black)', border: 'var(--card-border, 1px solid var(--acc-line1, rgba(212,175,55,0.2)))', borderRadius: 'var(--card-radius, 10px)', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
    const openNotes = () => navigateWidget && navigateWidget('fieldNotes');
    const noteCardStyle = { ...cardStyle, cursor: navigateWidget ? 'pointer' : 'default' };

    function fmtTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function renderEntry(e, i) {
        return React.createElement('div', { key: e.id || i, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', fontSize: 'var(--text-label, 0.75rem)', fontFamily: monoFont, borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))' } },
            React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)' } }, e.icon || '📋'),
            React.createElement('span', { style: { flex: 1, color: 'var(--silver)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, e.text || ''),
            React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--ov-8, rgba(255,255,255,0.4))' } }, fmtTime(e.ts)),
        );
    }

	    function emptyState(opts = {}) {
	        const tight = !!opts.tight;
	        return React.createElement('div', { style: { textAlign: 'center', padding: tight ? '12px 0' : '28px 16px', color: 'var(--silver)', fontFamily: monoFont, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: tight ? '4px' : '8px', height: '100%', boxSizing: 'border-box' } },
	            React.createElement('div', { style: { fontSize: tight ? '1.1rem' : '1.8rem', opacity: 0.55 } }, '📋'),
	            React.createElement('div', { style: { fontSize: tight ? '0.68rem' : '0.82rem', fontWeight: 800, color: 'var(--white)' } }, 'No decisions logged yet'),
	            React.createElement('div', { style: { fontSize: tight ? '0.58rem' : '0.7rem', lineHeight: 1.45, maxWidth: '24ch', opacity: 0.72 } },
	                tight ? 'Notes appear after saved GM actions.' : 'Saved trade, waiver, draft, and Alex decisions will appear here.'),
	            !tight && React.createElement('button', {
	                type: 'button',
	                onClick: e => { e.stopPropagation(); openNotes(); },
	                style: { marginTop: '4px', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)', borderRadius: '6px', padding: '7px 10px', minHeight: '44px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: monoFont, fontWeight: 800, letterSpacing: '0.04em', cursor: navigateWidget ? 'pointer' : 'default' },
	            }, 'OPEN GM OFFICE'),
	        );
	    }

    // ── SLIM (1×2, ~80×160): big number + proportional category bars ──
    if (size === 'slim') {
        const maxCount = Math.max(...groups.map(g => g.entries.length), 1);
        return React.createElement('div', { onClick: openNotes, title: 'Open GM\'s Office', style: noteCardStyle },
            React.createElement('div', { style: { padding: '8px 8px 4px', textAlign: 'center', flexShrink: 0, borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.08))' } },
                React.createElement('div', { style: { fontFamily: monoFont, fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '1px' } }, 'NOTES'),
                React.createElement('div', { style: { fontSize: '1.5rem', fontWeight: 700, color: 'var(--white)', fontFamily: monoFont, lineHeight: 1 } }, totalCount),
            ),
            React.createElement('div', { style: { flex: 1, padding: '6px 6px', display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' } },
                groups.length === 0
                    ? React.createElement('div', { style: { textAlign: 'center', color: 'var(--silver)', opacity: 0.5, fontSize: 'var(--text-label, 0.75rem)', fontFamily: monoFont, padding: '8px 0' } }, 'No notes yet')
                    : groups.slice(0, 5).map(g => {
                        const pct = (g.entries.length / maxCount) * 100;
                        return React.createElement('div', { key: g.key, style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--text-label, 0.75rem)', fontFamily: monoFont } },
                                React.createElement('span', { style: { color: g.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, g.label.split(' ')[0]),
                                React.createElement('span', { style: { color: 'var(--white)', fontWeight: 700 } }, g.entries.length),
                            ),
                            React.createElement('div', { style: { height: 4, background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 2, overflow: 'hidden' } },
                                React.createElement('div', { style: { width: pct + '%', height: '100%', background: g.color, transition: '0.3s' } }),
                            ),
                        );
                    }),
            ),
        );
    }

    // ── NARROW (1×4): vertical type counts + a few latest entries ──
    if (size === 'narrow') {
        const latest = fieldEntries.slice(0, 5);
        return React.createElement('div', { onClick: openNotes, title: 'Open GM\'s Office', style: noteCardStyle },
            React.createElement('div', { style: { padding: '8px 8px 6px', borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))', flexShrink: 0 } },
                React.createElement('div', { style: { fontFamily: monoFont, fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 } }, 'FIELD NOTES'),
                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: '1px', fontFamily: monoFont } }, totalCount + ' total'),
            ),
            React.createElement('div', { style: { flex: 1, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' } },
                groups.length === 0 ? emptyState({ tight: true }) : React.createElement(React.Fragment, null,
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
                        ...groups.slice(0, 6).map(g => React.createElement('div', { key: g.key, style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: monoFont } },
                            React.createElement('div', { style: { width: 4, height: 4, borderRadius: 2, background: g.color, flexShrink: 0 } }),
                            React.createElement('span', { style: { color: 'var(--silver)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, g.label),
                            React.createElement('span', { style: { fontWeight: 700, color: 'var(--white)' } }, g.entries.length),
                        )),
                    ),
                    React.createElement('div', { style: { borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))', paddingTop: '4px', flex: 1, minHeight: 0, overflow: 'hidden' } },
                        React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '3px', fontFamily: monoFont } }, 'Recent'),
                        ...latest.map((e, i) => React.createElement('div', { key: i, style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontFamily: monoFont, padding: '1px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (e.icon || '·') + ' ' + (e.text || ''))),
                    ),
                ),
            ),
        );
    }

    // ── LG (2×2): grouped sections — top 2 groups, top 3 each ──
    if (size === 'lg') {
        return React.createElement('div', { onClick: openNotes, title: 'Open GM\'s Office', style: noteCardStyle },
            React.createElement('div', { style: { padding: '12px 16px 8px', borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))', flexShrink: 0 } },
                React.createElement('div', { style: { fontFamily: monoFont, fontSize: '1rem', color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 } }, 'FIELD NOTES'),
                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontFamily: monoFont, marginTop: '2px' } }, totalCount + ' entries · ' + groups.length + ' types'),
            ),
            React.createElement('div', { style: { padding: '8px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' } },
                groups.length === 0 ? emptyState() :
                    groups.slice(0, 3).map(g => React.createElement('div', { key: g.key, style: { borderLeft: '2px solid ' + g.color, paddingLeft: '8px' } },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' } },
                            React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: g.color, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: monoFont } }, g.label),
                            React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--ov-8, rgba(255,255,255,0.4))', fontFamily: monoFont } }, g.entries.length),
                        ),
                        ...g.entries.slice(0, 2).map((e, i) => renderEntry(e, i)),
                    )),
            ),
        );
    }

    // ── TALL (2×4): all groups, more entries each, no scroll ──
    if (size === 'tall') {
        return React.createElement('div', { onClick: openNotes, title: 'Open GM\'s Office', style: noteCardStyle },
            React.createElement('div', { style: { padding: '14px 18px 10px', borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))', flexShrink: 0 } },
                React.createElement('div', { style: { fontFamily: monoFont, fontSize: '1.1rem', color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 } }, 'FIELD NOTES'),
                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontFamily: monoFont, marginTop: '2px' } }, 'Intel grouped by type · ' + totalCount + ' entries'),
            ),
            React.createElement('div', { style: { padding: '10px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' } },
                groups.length === 0 ? emptyState() :
                    groups.slice(0, 5).map(g => React.createElement('div', { key: g.key, style: { borderLeft: '2px solid ' + g.color, paddingLeft: '8px' } },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' } },
                            React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: g.color, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: monoFont } }, g.label),
                            React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--ov-8, rgba(255,255,255,0.4))', fontFamily: monoFont } }, g.entries.length),
                        ),
                        ...g.entries.slice(0, 3).map((e, i) => renderEntry(e, i)),
                    )),
            ),
        );
    }

    return null;
}

// Expose globally so dashboard.js can render them as widgets
window.IntelligenceBriefWidget = IntelligenceBriefWidget;
window.FieldNotesWidget = FieldNotesWidget;
