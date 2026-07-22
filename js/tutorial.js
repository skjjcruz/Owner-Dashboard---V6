// ============================================================================
// js/tutorial.js - War Room first-launch GM briefing config.
// Shared engine lives in ReconAI shared/assistant-tutorial.js.
// ============================================================================

const WR_TUTORIAL_CONFIG = {
    productKey: 'warroom',
    version: 'gm-brief-v1',
    legacyKeys: ['wr_tutorial_done_v1'],
    accent: 'var(--k-d4af37, #d4af37)',
    title: 'Welcome to the GM Room',
    kicker: 'Alex Ingram / Dynasty HQ Briefing',
    intro: 'I am Alex Ingram, your GM chief of staff. Dynasty HQ is the full football office: roster board, trade desk, waiver desk, draft command, and league ops in one place.',
    openingChips: ['90-second brief', 'Dynasty HQ map', 'Replay in settings'],
    openingBoard: {
        label: 'Mission',
        title: 'Run the room',
        body: 'I will point you to the desks that matter, then stay available when a move needs a second set of eyes.',
    },
    steps: [
        {
            key: 'command-center',
            tabToOpen: 'dashboard',
            target: '[data-tab="dashboard"],.sidebar-item:first-child',
            title: 'Command Center',
            desc: 'Home is your operating board. Alex briefings, team pressure, pinned widgets, and the signals you want to monitor all start here.',
            kicker: 'Main Board',
            chips: ['briefing', 'widgets', 'priorities'],
            board: {
                label: 'GM Habit',
                title: 'Start with signal',
                body: 'Open here first, then move to the desk that matches the problem.',
            },
        },
        {
            key: 'roster-room',
            tabToOpen: 'myteam',
            target: '[data-tab="myteam"]',
            title: 'Roster Room',
            desc: 'This is your personnel department. DHQ values, age and value windows, depth, tags, and player detail give every asset a job on the board.',
            kicker: 'Personnel',
            chips: ['DHQ values', 'age windows', 'depth'],
            board: {
                label: 'Read',
                title: 'Value is contextual',
                body: 'A player only matters in relation to your roster window, position room, and league market.',
            },
        },
        {
            key: 'deal-room',
            tabToOpen: 'trades',
            target: '[data-tab="trades"]',
            title: 'Deal Room',
            desc: 'Trade Center is where we model the room. Owner DNA, partner fit, deal analysis, and negotiation prep help you find the trade before it becomes obvious.',
            kicker: 'Negotiation Desk',
            chips: ['owner DNA', 'partner fit', 'deal checks'],
            board: {
                label: 'Leverage',
                title: 'Trade the owner, not just the player',
                body: 'The best deal usually comes from matching your surplus to their pressure point.',
            },
        },
        {
            key: 'waiver-desk',
            tabToOpen: 'fa',
            target: '[data-tab="fa"]',
            title: 'Waiver Desk',
            desc: 'Free Agency turns waiver chaos into a bid plan. Use FAAB context, target tiers, and league scoring to decide who deserves real budget.',
            kicker: 'Acquisition Desk',
            chips: ['FAAB', 'targets', 'bid plan'],
            board: {
                label: 'Rule',
                title: 'Budget is leverage',
                body: 'Spend when the player changes your weekly ceiling or protects a fragile roster room.',
            },
        },
        {
            key: 'draft-league-ops',
            tabToOpen: 'draft',
            target: '[data-tab="draft"]',
            title: 'Draft And League Ops',
            desc: 'Draft Command, League Map, Analytics, and Trophy Room are the long-game offices. Use them to understand market history, pick value, owner tendencies, and league legacy.',
            kicker: 'Season Office',
            chips: ['draft command', 'league map', 'analytics'],
            board: {
                label: 'Long Game',
                title: 'Know the league memory',
                body: 'Draft capital and owner behavior compound. This is where we keep that context visible.',
            },
        },
    ],
    finishTitle: 'Dynasty HQ Is Ready',
    finishText: 'You have the office map. Start at Home, move to the right desk, and bring me in before a high-leverage decision leaves the building.',
    finishChips: ['Home first', 'Desk second', 'Alex before action'],
    finishBoard: {
        label: 'First Call',
        title: 'Ask for the board',
        body: 'Ask: What are the three moves this roster should consider before the rest of the league catches up?',
    },
};

async function shouldShowWRTutorial() {
    if (window.App?.AssistantTutorial?.shouldShow) {
        return window.App.AssistantTutorial.shouldShow(WR_TUTORIAL_CONFIG);
    }
    return !localStorage.getItem('wr_tutorial_done_v1');
}

function startWRTutorial(options) {
    if (!window.App?.AssistantTutorial?.start) return false;
    return window.App.AssistantTutorial.start(WR_TUTORIAL_CONFIG, options || {});
}

function replayWRTutorial() {
    return startWRTutorial({ force: true });
}

window.WR_TUTORIAL_CONFIG = WR_TUTORIAL_CONFIG;
window.startWRTutorial = startWRTutorial;
window.shouldShowWRTutorial = shouldShowWRTutorial;
window.replayWRTutorial = replayWRTutorial;
