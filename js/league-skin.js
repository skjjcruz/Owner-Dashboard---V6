// league-skin.js
// Central format/phase contract for War Room modules.
(function(root) {
    'use strict';

    const App = root.App = root.App || {};
    const WR = root.WR = root.WR || {};
    const VERSION = 'league-skin-v1';

    const TYPE_ALIASES = {
        0: 'redraft',
        1: 'keeper',
        2: 'dynasty',
        re_draft: 'redraft',
        season_long: 'redraft',
        bestball: 'best_ball',
        best_ball: 'best_ball',
    };
    const IDP_SLOTS = new Set(['IDP', 'IDP_FLEX', 'DL', 'DE', 'DT', 'EDGE', 'LB', 'DB', 'CB', 'S', 'SS', 'FS']);
    const BENCH_SLOTS = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI']);
    const PHASE_LABELS = {
        pre_draft: { label: 'Pre-Draft', short: 'PRE', color: 'var(--k-5dade2, #5dade2)' },
        drafting: { label: 'Draft Live', short: 'LIVE', color: 'var(--k-9b8afb, #9b8afb)' },
        in_season: { label: 'In Season', short: 'SEAS', color: 'var(--k-2ecc71, #2ecc71)' },
        offseason: { label: 'Offseason', short: 'OFF', color: 'var(--k-f0a500, #f0a500)' },
        complete: { label: 'Complete', short: 'DONE', color: 'var(--k-8d887e, #8d887e)' },
        unknown: { label: 'Phase Unknown', short: '?', color: 'var(--k-c7cdd7, #c7cdd7)' },
    };
    const TYPE_META = {
        redraft: { label: 'Redraft', short: 'RD', color: 'var(--k-2ecc71, #2ecc71)', family: 'seasonal' },
        keeper: { label: 'Keeper', short: 'KP', color: 'var(--k-7c6bf8, #7c6bf8)', family: 'hybrid' },
        dynasty: { label: 'Dynasty', short: 'DY', color: 'var(--k-d4af37, #d4af37)', family: 'long_term' },
        best_ball: { label: 'Best Ball', short: 'BB', color: 'var(--k-3498db, #3498db)', family: 'seasonal' },
        dfs: { label: 'DFS', short: 'DFS', color: 'var(--k-3498db, #3498db)', family: 'daily' },
        unknown: { label: 'League Type Unknown', short: '?', color: 'var(--k-c7cdd7, #c7cdd7)', family: 'unknown' },
    };
    const TYPE_THEMES = {
        redraft: {
            id: 'war-room-default',
            className: 'wr-league-skin-default',
            accent: 'var(--k-d4af37, #d4af37)',
            surface: 'var(--k-121217, #121217)',
        },
        best_ball: {
            id: 'seasonal-blue',
            className: 'wr-league-skin-seasonal',
            accent: 'var(--k-3498db, #3498db)',
            surface: 'var(--k-10243f, #10243f)',
        },
        dynasty: {
            id: 'dynasty-war-room',
            className: 'wr-league-skin-dynasty',
            accent: 'var(--k-d4af37, #d4af37)',
            surface: 'var(--k-121217, #121217)',
        },
        keeper: {
            id: 'keeper-hybrid',
            className: 'wr-league-skin-keeper',
            accent: 'var(--k-7c6bf8, #7c6bf8)',
            surface: 'var(--k-1c1830, #1c1830)',
        },
        unknown: {
            id: 'war-room-default',
            className: 'wr-league-skin-default',
            accent: 'var(--k-d4af37, #d4af37)',
            surface: 'var(--k-121217, #121217)',
        },
    };

    const STRATEGY_MODES = {
        dynasty: ['rebuild', 'compete', 'win_now', 'custom'],
        keeper: ['build_core', 'balanced', 'win_now', 'custom'],
        redraft: ['draft_prep', 'balanced', 'aggressive_waivers', 'streaming', 'win_now', 'custom'],
        best_ball: ['draft_prep', 'upside', 'balanced', 'custom'],
        dfs: ['balanced', 'contrarian', 'cash', 'custom'],
        unknown: ['balanced', 'custom'],
    };

    function lower(value) {
        return String(value == null ? '' : value).trim().toLowerCase();
    }

    function normalizeType(value) {
        if (value == null || value === '') return '';
        const raw = lower(value);
        return TYPE_ALIASES[raw] || raw;
    }

    function firstNonEmpty(values) {
        for (const value of values) {
            if (value !== undefined && value !== null && value !== '') return value;
        }
        return '';
    }

    function normalizeSlot(slot) {
        const raw = String(slot || '').trim().toUpperCase();
        if (raw === 'D/ST' || raw === 'DST') return 'DEF';
        if (raw === 'SUPERFLEX') return 'SUPER_FLEX';
        return raw;
    }

    function detectType(league, fallback) {
        // Per-league format override (shared store) wins outright — it is the
        // correction seam for platform mis-detection (e.g. MFL's dynasty-first
        // hardcode). Same store shared detectLeagueType consults, so the two
        // detectors can't disagree on an overridden league.
        const override = normalizeType(window.App?.Intelligence?.getLeagueTypeOverride?.(league) || '');
        if (override) return override;
        const explicit = normalizeType(firstNonEmpty([
            league?.type,
            league?.league_type,
            league?.settings?.type,
            league?.metadata?.type,
            league?.metadata?.league_type,
            fallback,
        ]));
        if (explicit) return explicit;
        if (Number(league?.settings?.max_keepers || league?.settings?.keeper_count || league?.metadata?.keeper_count || 0) > 0) return 'keeper';
        return 'unknown';
    }

    function buildFallbackProfile(input) {
        const data = input || {};
        const league = data.league || data.currentLeague || {};
        const positions = league.roster_positions || data.rosterPositions || [];
        const normalizedPositions = positions.map(normalizeSlot);
        const rosters = data.rosters || league.rosters || [];
        const scoring = league.scoring_settings || data.scoring || {};
        const idpSlots = normalizedPositions.filter(pos => IDP_SLOTS.has(pos)).length;
        const starterSlots = normalizedPositions.filter(pos => !BENCH_SLOTS.has(pos)).length;
        return {
            schemaVersion: VERSION + '-fallback-profile',
            leagueId: String(league.league_id || league.id || ''),
            name: league.name || data.name || '',
            platform: data.platform || league._platform || (league._mfl ? 'mfl' : league._espn ? 'espn' : league._yahoo ? 'yahoo' : 'sleeper'),
            type: detectType(league, data.type),
            teams: rosters.length || Number(data.teams || league.total_rosters || league.settings?.num_teams || 0),
            scoring: {
                raw: scoring,
                ppr: Number(scoring.rec || scoring.reception || 0),
                idp: idpSlots > 0,
                dst: normalizedPositions.includes('DEF'),
                kicker: normalizedPositions.includes('K'),
            },
            roster: {
                positions: positions.slice(),
                starters: starterSlots,
                idpSlots,
                benchSlots: normalizedPositions.filter(pos => pos === 'BN' || pos === 'BE' || pos === 'BENCH').length,
                taxiSlots: normalizedPositions.filter(pos => pos === 'TAXI').length,
            },
            formatTags: [],
        };
    }

    function buildProfile(input) {
        const data = input || {};
        if (data.profile && data.profile.schemaVersion) return data.profile;
        if (typeof App.Intelligence?.buildLeagueProfile === 'function') {
            try {
                return App.Intelligence.buildLeagueProfile(data);
            } catch (err) {
                root.wrLog?.('leagueSkin.profile', err);
            }
        }
        return buildFallbackProfile(data);
    }

    function rosterPlayerCount(rosters) {
        return (rosters || []).reduce((sum, roster) => {
            const ids = []
                .concat(roster?.players || [])
                .concat(roster?.starters || [])
                .concat(roster?.reserve || [])
                .concat(roster?.taxi || [])
                .filter(id => id && String(id) !== '0');
            return sum + new Set(ids.map(String)).size;
        }, 0);
    }

    function rosterDraftSlotCount(league, profile) {
        const rawPositions = league?.roster_positions || profile?.roster?.positions || [];
        const positions = rawPositions.map(normalizeSlot).filter(Boolean);
        return positions.filter(pos => pos !== 'IR' && pos !== 'TAXI').length;
    }

    function positiveNumber(value) {
        const num = Number(value);
        return Number.isFinite(num) && num > 0 ? num : 0;
    }

    function resolveDraftRounds(input = {}) {
        const data = input || {};
        const league = data.league || data.currentLeague || {};
        const skin = data.leagueSkin || data.skin || getCurrent();
        const profile = skin?.profile || buildProfile({ ...data, league });
        const type = normalizeType(skin?.type || profile?.type || detectType(league, data.type));
        const seasonal = !!skin?.state?.isSeasonal || TYPE_META[type]?.family === 'seasonal' || TYPE_META[type]?.family === 'daily';
        const season = String(data.season || league?.season || root.S?.season || new Date().getFullYear());
        const drafts = []
            .concat(data.draft ? [data.draft] : [])
            .concat(data.drafts || league?.drafts || root.S?.drafts || [])
            .filter(Boolean);
        const scheduledDraft = drafts.find(d => String(d?.season || '') === season && ['pre_draft', 'drafting'].includes(lower(d?.status)))
            || drafts.find(d => ['pre_draft', 'drafting'].includes(lower(d?.status)))
            || drafts.find(d => String(d?.season || '') === season)
            || drafts[0]
            || null;
        const draftRounds = positiveNumber(scheduledDraft?.settings?.rounds || scheduledDraft?.settings?.round_count || scheduledDraft?.rounds);
        const leagueRounds = positiveNumber(league?.settings?.draft_rounds || league?.settings?.rounds);
        const fallbackRounds = positiveNumber(data.fallbackRounds || data.defaultRounds);
        const rosterSlots = rosterDraftSlotCount(league, profile);

        if (seasonal && rosterSlots > 0) {
            return Math.max(rosterSlots, draftRounds, fallbackRounds || 0);
        }
        return draftRounds || leagueRounds || fallbackRounds || rosterSlots || 5;
    }

    function detectPhase(input) {
        const data = input || {};
        const league = data.league || data.currentLeague || {};
        const draft = data.draft || data.draftInfo || data.briefDraftInfo || null;
        const draftStatus = lower(draft?.status);
        if (draftStatus === 'drafting') return 'drafting';
        if (draftStatus === 'pre_draft') return 'pre_draft';

        const status = lower(firstNonEmpty([
            league.status,
            league.metadata?.status,
            data.status,
        ]));
        if (status === 'drafting') return 'drafting';
        if (status === 'pre_draft') return 'pre_draft';
        if (status === 'in_season') return 'in_season';
        if (status === 'complete') return 'complete';
        if (status === 'offseason' || status === 'post_season') return 'offseason';

        const week = Number(data.nflState?.display_week || data.nflState?.week || root.S?.currentWeek || league.settings?.leg || 0);
        if (week > 0 && week <= 18) return 'in_season';
        return 'unknown';
    }

    function buildFeatureFlags(type, phase, profile, league, rosters) {
        const positions = (profile?.roster?.positions || league?.roster_positions || []).map(normalizeSlot);
        const settings = league?.settings || {};
        const hasTaxi = positions.includes('TAXI') || Number(settings.taxi_slots || league?.taxi_slots || 0) > 0;
        const hasIDP = !!profile?.scoring?.idp || Number(profile?.roster?.idpSlots || 0) > 0 || positions.some(pos => IDP_SLOTS.has(pos));
        const maxKeepers = Number(settings.max_keepers || settings.keeper_count || league?.metadata?.keeper_count || 0);
        const seasonal = type === 'redraft' || type === 'best_ball' || type === 'dfs';
        const longTerm = type === 'dynasty' || type === 'keeper';
        const preDraft = phase === 'pre_draft' || phase === 'drafting';
        // Redraft-era features hide only in DYNASTY leagues (owner directive
        // 2026-07-05, fail-open: keeper/unknown keep everything). Game Day
        // Central + lineup-check + bye planner are exempt per ruling E1.
        const allowRedraft = type !== 'dynasty';
        return {
            showTaxi: hasTaxi,
            showIDP: hasIDP,
            showKeepers: type === 'keeper' || maxKeepers > 0,
            showKeeperControls: type === 'keeper' || maxKeepers > 0,
            showFuturePicks: longTerm,
            showDynastyValue: type === 'dynasty',
            showAgeCurve: longTerm,
            showDraftPrep: preDraft || phase === 'offseason',
            showDraftPrepWhenRosterEmpty: (seasonal || type === 'keeper') && preDraft,
            showStartSit: seasonal && phase === 'in_season',
            // Game Day Central (start/sit + opponent + season schedule + bye watch)
            // applies to ANY in-season league (dynasty plays weekly H2H too), AND
            // to any drafted roster in the offseason so you can build your Week 1
            // lineup and plan byes before the schedule is posted. Hidden only for
            // pre-draft empty rosters (nothing to build yet).
            showGameDay: phase === 'in_season' || rosterPlayerCount(rosters) > 0,
            // REDEFINED from `seasonal && in_season` (zero consumers before this
            // pass): keeper leagues keep the streaming card they see today.
            showStreaming: allowRedraft && phase === 'in_season',
            // My Roster Wk START/SIT badge + redraft preset (E2).
            showWeeklyVerdict: allowRedraft,
            // Draft Gameplan blueprint (E5) — dynasty startups included.
            showDraftGameplan: allowRedraft,
            showWaiverPlanner: seasonal || type === 'keeper',
            showRestOfSeasonValue: seasonal || type === 'keeper',
            hasRosteredPlayers: rosterPlayerCount(rosters) > 0,
        };
    }

    function buildVocabulary(type, phase) {
        const seasonal = type === 'redraft' || type === 'best_ball' || type === 'dfs';
        const keeper = type === 'keeper';
        const valueLabel = type === 'dynasty'
            ? 'DHQ Dynasty Value'
            : keeper
                ? 'Keeper-Adjusted Value'
                : type === 'redraft'
                    ? 'Rest-of-Season Value'
                    : seasonal
                        ? 'Format Value'
                        : 'Player Value';
        return {
            appLabel: 'Dynasty HQ',
            teamLabel: seasonal ? 'Team' : 'Roster',
            assetLabel: type === 'dynasty' ? 'Asset' : 'Player',
            valueLabel,
            valueShortLabel: type === 'dynasty' ? 'DHQ' : type === 'redraft' ? 'ROS' : 'Value',
            pickLabel: seasonal ? 'Draft Pick' : 'Future Pick',
            marketLabel: seasonal ? 'Rest-of-Season Market' : 'Trade Market',
            rosterEmptyLabel: phase === 'pre_draft' ? 'Roster Not Drafted Yet' : 'Roster Data Pending',
            strategyLabel: seasonal ? 'Team Plan' : 'GM Mode',
        };
    }

    function buildCopy(type, phase, features) {
        const preDraftEmpty = features.showDraftPrepWhenRosterEmpty;
        return {
            rosterData: {
                emptyRosterTitle: preDraftEmpty ? 'Pre-draft mode' : 'Roster sync incomplete',
                emptyRosterMessage: preDraftEmpty
                    ? 'This league has not drafted rosters yet.'
                    : 'League rosters loaded with zero player IDs.',
                emptyRosterDetail: preDraftEmpty
                    ? 'Roster-dependent recommendations stay paused until the draft, but draft prep, pick planning, league history, and settings can use this format skin now.'
                    : 'Refresh league data or re-sync the platform before acting on roster, trade, waiver, draft, or analytics recommendations.',
                emptyRosterBrief: preDraftEmpty
                    ? 'Pre-draft mode is active. I am using draft prep and league setup until rosters exist.'
                    : 'Roster sync incomplete. I paused roster, trade, waiver, and league-rank recommendations until player IDs finish loading.',
                actionLabel: preDraftEmpty ? 'Open Draft' : 'Refresh',
                actionTarget: preDraftEmpty ? 'draft' : 'refresh',
            },
        };
    }

    function buildModuleModes(skin) {
        const modes = {};
        const modules = ['dashboard', 'myteam', 'compare', 'trades', 'fa', 'draft', 'analytics', 'alex', 'trophies', 'calendar', 'settings', 'legend'];
        modules.forEach(moduleId => {
            modes[moduleId] = { state: 'active', surface: moduleId, reason: '' };
        });
        if (skin.state.isPreDraftRosterEmpty) {
            ['dashboard', 'myteam', 'compare', 'trades', 'fa', 'analytics'].forEach(moduleId => {
                modes[moduleId] = {
                    state: 'alternate',
                    surface: moduleId + ':pre_draft',
                    reason: 'pre_draft_empty_rosters',
                };
            });
            modes.draft = { state: 'active', surface: 'draft:pre_draft', reason: 'pre_draft_ready' };
            modes.alex = { state: 'active', surface: 'alex:league_history', reason: 'format_ready' };
        }
        return modes;
    }

    function build(input) {
        const data = input || {};
        const league = data.league || data.currentLeague || {};
        const rosters = data.rosters || league.rosters || [];
        const profile = buildProfile({
            ...data,
            league,
            rosters,
        });
        const type = normalizeType(profile?.type) || detectType(league, data.type) || 'unknown';
        const phase = detectPhase({ ...data, league });
        const features = buildFeatureFlags(type, phase, profile, league, rosters);
        const count = rosterPlayerCount(rosters);
        const typeMeta = TYPE_META[type] || { ...TYPE_META.unknown, label: type.replace(/_/g, ' ') };
        const phaseMeta = PHASE_LABELS[phase] || PHASE_LABELS.unknown;
        const skin = {
            schemaVersion: VERSION,
            key: [type, phase, count ? 'with_rosters' : 'empty_rosters'].join(':'),
            type,
            family: typeMeta.family,
            phase,
            typeMeta,
            phaseMeta,
            profile,
            features,
            vocabulary: buildVocabulary(type, phase),
            copy: buildCopy(type, phase, features),
            theme: TYPE_THEMES[type] || TYPE_THEMES.unknown,
            state: {
                rosterPlayerCount: count,
                isPreDraft: phase === 'pre_draft',
                isDrafting: phase === 'drafting',
                isSeasonal: typeMeta.family === 'seasonal' || typeMeta.family === 'daily',
                isLongTerm: typeMeta.family === 'long_term',
                isPreDraftRosterEmpty: features.showDraftPrepWhenRosterEmpty && count === 0,
            },
            strategyModes: STRATEGY_MODES[type] || STRATEGY_MODES.unknown,
        };
        skin.moduleModes = buildModuleModes(skin);
        return skin;
    }

    let currentSkin = null;

    function setCurrent(skin) {
        currentSkin = skin || null;
        App.currentLeagueSkin = currentSkin;
        if (root.S) root.S.leagueSkin = currentSkin;
        try {
            root.dispatchEvent?.(new CustomEvent('wr:league-skin-changed', { detail: currentSkin }));
        } catch (_) { /* no-op for tests */ }
        return currentSkin;
    }

    function getCurrent() {
        return currentSkin || App.currentLeagueSkin || root.S?.leagueSkin || null;
    }

    function resolve(input) {
        if (input?.schemaVersion === VERSION) return input;
        return input ? build(input) : getCurrent();
    }

    function getModuleMode(skinOrInput, moduleId) {
        const skin = resolve(skinOrInput) || {};
        return skin.moduleModes?.[moduleId] || { state: 'active', surface: moduleId, reason: '' };
    }

    function label(path, fallback, skinOrInput) {
        const skin = resolve(skinOrInput) || {};
        const parts = String(path || '').split('.').filter(Boolean);
        let value = skin;
        for (const part of parts) value = value?.[part];
        return value == null || value === '' ? fallback : value;
    }

    const api = {
        VERSION,
        TYPE_META,
        PHASE_LABELS,
        STRATEGY_MODES,
        TYPE_THEMES,
        build,
        buildProfile,
        detectPhase,
        resolveDraftRounds,
        normalizeType,
        setCurrent,
        getCurrent,
        resolve,
        getModuleMode,
        label,
    };

    App.LeagueSkin = api;
    WR.LeagueSkin = api;
})(window);
