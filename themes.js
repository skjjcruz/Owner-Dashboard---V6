// ============================================================
// Owner Dashboard — NFL Team Themes
// Loaded by every HTML page via <script src="themes.js">
//
// Each theme maps to CSS custom properties:
//   --gold       → team primary accent color
//   --dark-gold  → darker variant (hover states, gradients)
//   --silver     → team secondary color (borders, secondary text)
//
// Backgrounds (--black, --off-black, --charcoal) stay dark
// across all themes for readability.
// ============================================================

window.NFL_THEMES = [
    // ── Default ──────────────────────────────────────────────
    {
        id: 'default',
        name: 'Default',
        city: 'Owner Dashboard',
        abbr: 'OD',
        primary: '#D4AF37',
        primaryDark: '#B8941E',
        secondary: '#C0C0C0',
    },

    // ── AFC WEST ─────────────────────────────────────────────
    {
        id: 'raiders',
        name: 'Raiders',
        city: 'Las Vegas',
        abbr: 'LV',
        primary: '#A5ACAF',
        primaryDark: '#8B9195',
        secondary: '#D4D8DB',
    },
    {
        id: 'chiefs',
        name: 'Chiefs',
        city: 'Kansas City',
        abbr: 'KC',
        primary: '#E31837',
        primaryDark: '#B5102B',
        secondary: '#FFB81C',
    },
    {
        id: 'chargers',
        name: 'Chargers',
        city: 'Los Angeles',
        abbr: 'LAC',
        primary: '#0080C6',
        primaryDark: '#005E93',
        secondary: '#FFC20E',
    },
    {
        id: 'broncos',
        name: 'Broncos',
        city: 'Denver',
        abbr: 'DEN',
        primary: '#FB4F14',
        primaryDark: '#C83D0F',
        secondary: '#7B92B2',
    },

    // ── AFC NORTH ────────────────────────────────────────────
    {
        id: 'ravens',
        name: 'Ravens',
        city: 'Baltimore',
        abbr: 'BAL',
        primary: '#9E7C0C',
        primaryDark: '#7D6209',
        secondary: '#C0C0C0',
    },
    {
        id: 'steelers',
        name: 'Steelers',
        city: 'Pittsburgh',
        abbr: 'PIT',
        primary: '#FFB612',
        primaryDark: '#D4960E',
        secondary: '#C0C0C0',
    },
    {
        id: 'browns',
        name: 'Browns',
        city: 'Cleveland',
        abbr: 'CLE',
        primary: '#FF3C00',
        primaryDark: '#CC3000',
        secondary: '#C0C0C0',
    },
    {
        id: 'bengals',
        name: 'Bengals',
        city: 'Cincinnati',
        abbr: 'CIN',
        primary: '#FB4F14',
        primaryDark: '#C83D0F',
        secondary: '#C0C0C0',
    },

    // ── AFC EAST ─────────────────────────────────────────────
    {
        id: 'patriots',
        name: 'Patriots',
        city: 'New England',
        abbr: 'NE',
        primary: '#C60C30',
        primaryDark: '#9E0A26',
        secondary: '#B0B7BC',
    },
    {
        id: 'dolphins',
        name: 'Dolphins',
        city: 'Miami',
        abbr: 'MIA',
        primary: '#008E97',
        primaryDark: '#006B72',
        secondary: '#FC4C02',
    },
    {
        id: 'bills',
        name: 'Bills',
        city: 'Buffalo',
        abbr: 'BUF',
        primary: '#00338D',
        primaryDark: '#00256B',
        secondary: '#C60C30',
    },
    {
        id: 'jets',
        name: 'Jets',
        city: 'New York',
        abbr: 'NYJ',
        primary: '#125740',
        primaryDark: '#0D3F2E',
        secondary: '#C0C0C0',
    },

    // ── AFC SOUTH ────────────────────────────────────────────
    {
        id: 'texans',
        name: 'Texans',
        city: 'Houston',
        abbr: 'HOU',
        primary: '#C41230',
        primaryDark: '#9B0E26',
        secondary: '#A2AAAD',
    },
    {
        id: 'colts',
        name: 'Colts',
        city: 'Indianapolis',
        abbr: 'IND',
        primary: '#002C5F',
        primaryDark: '#001E40',
        secondary: '#A2AAAD',
    },
    {
        id: 'jaguars',
        name: 'Jaguars',
        city: 'Jacksonville',
        abbr: 'JAX',
        primary: '#C5A028',
        primaryDark: '#9E8020',
        secondary: '#006778',
    },
    {
        id: 'titans',
        name: 'Titans',
        city: 'Tennessee',
        abbr: 'TEN',
        primary: '#4B92DB',
        primaryDark: '#3A70A8',
        secondary: '#C0C0C0',
    },

    // ── NFC WEST ─────────────────────────────────────────────
    {
        id: '49ers',
        name: '49ers',
        city: 'San Francisco',
        abbr: 'SF',
        primary: '#AA0000',
        primaryDark: '#880000',
        secondary: '#B3995D',
    },
    {
        id: 'seahawks',
        name: 'Seahawks',
        city: 'Seattle',
        abbr: 'SEA',
        primary: '#69BE28',
        primaryDark: '#53981F',
        secondary: '#A5ACAF',
    },
    {
        id: 'rams',
        name: 'Rams',
        city: 'Los Angeles',
        abbr: 'LAR',
        primary: '#FFA300',
        primaryDark: '#CC8200',
        secondary: '#B0B7BC',
    },
    {
        id: 'cardinals',
        name: 'Cardinals',
        city: 'Arizona',
        abbr: 'ARI',
        primary: '#97233F',
        primaryDark: '#751A30',
        secondary: '#FFB612',
    },

    // ── NFC NORTH ────────────────────────────────────────────
    {
        id: 'bears',
        name: 'Bears',
        city: 'Chicago',
        abbr: 'CHI',
        primary: '#C83803',
        primaryDark: '#A02D02',
        secondary: '#C0C0C0',
    },
    {
        id: 'lions',
        name: 'Lions',
        city: 'Detroit',
        abbr: 'DET',
        primary: '#0076B6',
        primaryDark: '#005A8A',
        secondary: '#B0B7BC',
    },
    {
        id: 'packers',
        name: 'Packers',
        city: 'Green Bay',
        abbr: 'GB',
        primary: '#FFB612',
        primaryDark: '#D4960E',
        secondary: '#C0C0C0',
    },
    {
        id: 'vikings',
        name: 'Vikings',
        city: 'Minnesota',
        abbr: 'MIN',
        primary: '#4F2683',
        primaryDark: '#3B1B62',
        secondary: '#FFC62F',
    },

    // ── NFC EAST ─────────────────────────────────────────────
    {
        id: 'cowboys',
        name: 'Cowboys',
        city: 'Dallas',
        abbr: 'DAL',
        primary: '#003594',
        primaryDark: '#002370',
        secondary: '#869397',
    },
    {
        id: 'eagles',
        name: 'Eagles',
        city: 'Philadelphia',
        abbr: 'PHI',
        primary: '#004C54',
        primaryDark: '#003840',
        secondary: '#A5ACAF',
    },
    {
        id: 'giants',
        name: 'Giants',
        city: 'New York',
        abbr: 'NYG',
        primary: '#0B2265',
        primaryDark: '#08194D',
        secondary: '#CC0000',
    },
    {
        id: 'commanders',
        name: 'Commanders',
        city: 'Washington',
        abbr: 'WSH',
        primary: '#773141',
        primaryDark: '#5C2532',
        secondary: '#FFB612',
    },

    // ── NFC SOUTH ────────────────────────────────────────────
    {
        id: 'falcons',
        name: 'Falcons',
        city: 'Atlanta',
        abbr: 'ATL',
        primary: '#A71930',
        primaryDark: '#831324',
        secondary: '#A5ACAF',
    },
    {
        id: 'panthers',
        name: 'Panthers',
        city: 'Carolina',
        abbr: 'CAR',
        primary: '#0085CA',
        primaryDark: '#0066A0',
        secondary: '#BFC0BF',
    },
    {
        id: 'saints',
        name: 'Saints',
        city: 'New Orleans',
        abbr: 'NO',
        primary: '#D3BC8D',
        primaryDark: '#B09A70',
        secondary: '#C0C0C0',
    },
    {
        id: 'buccaneers',
        name: 'Buccaneers',
        city: 'Tampa Bay',
        abbr: 'TB',
        primary: '#D50A0A',
        primaryDark: '#AA0808',
        secondary: '#C0C0C0',
    },
];

// ── Apply a theme by team ID ──────────────────────────────────
// Overrides CSS custom properties on :root instantly
window.applyNFLTheme = function(teamId) {
    const theme = window.NFL_THEMES.find(t => t.id === teamId) || window.NFL_THEMES[0];
    const root = document.documentElement;
    root.style.setProperty('--gold', theme.primary);
    root.style.setProperty('--dark-gold', theme.primaryDark);
    root.style.setProperty('--silver', theme.secondary);
    root.setAttribute('data-theme', theme.id);
    return theme;
};

// ── Get theme object by ID ────────────────────────────────────
window.getNFLTheme = function(teamId) {
    return window.NFL_THEMES.find(t => t.id === teamId) || window.NFL_THEMES[0];
};

// ── Apply theme from localStorage immediately (no async) ──────
// Called inline in each page <head> to prevent flash of default theme
window.applyStoredTheme = function() {
    try {
        const raw = localStorage.getItem('od_theme');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data && data.teamId) {
            window.applyNFLTheme(data.teamId);
        }
    } catch {}
};
