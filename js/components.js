// ══════════════════════════════════════════════════════════════════
// components.js — Shared UI components (UpgradeGate, GMMessage, etc.)
// ══════════════════════════════════════════════════════════════════
    const COMPONENTS_WR_KEYS  = window.App.WR_KEYS;
    const ComponentsStorage = window.App.WrStorage;
    function UpgradeGate({ feature, title, description, targetTier, children, onClose }) {
        const tier = getUserTier();
        const hasAccess = canAccess(feature);

        if (hasAccess) return children || null;

        // Check one-time taste
        const [tasteUsed, setTasteUsed] = React.useState(false);
        if (children && hasTasteLeft() && !tasteUsed) {
            return React.createElement(React.Fragment, null,
                children,
                React.createElement('div', { style: { textAlign:'center', padding:'12px', background:'var(--acc-fill1, rgba(212,175,55,0.06))', border:'1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius:'8px', marginTop:'12px' } },
                    React.createElement('div', { style: { fontSize:'var(--text-body, 1rem)', color:'var(--gold)', fontWeight:700, marginBottom:'4px' } }, 'Free preview — upgrade to keep using this feature'),
                    React.createElement('button', { onClick: () => setTasteUsed(true), style: { padding:'6px 16px', background:'var(--gold)', color:'var(--black)', border:'none', borderRadius:'6px', fontFamily:'Rajdhani, sans-serif', fontSize:'var(--text-body, 1rem)', cursor:'pointer' } }, 'Got it')
                )
            );
        }

        const tierLabel = targetTier === 'scout' ? 'Scout' : 'Dynasty HQ';
        const tierPrice = targetTier === 'scout' ? '$4.99/mo' : '$9.99/mo';

        return React.createElement('div', { style: { background:'linear-gradient(135deg, var(--off-black), var(--charcoal))', border:'1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius:'var(--card-radius)', padding:'24px', textAlign:'center', maxWidth:'480px', margin:'24px auto' } },
            React.createElement('div', { style: { fontFamily:'Rajdhani, sans-serif', fontSize:'1.6rem', color:'var(--gold)', letterSpacing:'0.06em', marginBottom:'8px' } }, title || 'UPGRADE TO UNLOCK'),
            React.createElement('div', { style: { fontSize:'var(--text-body, 1rem)', color:'var(--silver)', lineHeight:1.7, marginBottom:'16px' } }, description || 'This feature requires a paid subscription.'),
            React.createElement('div', { style: { display:'flex', gap:'10px', justifyContent:'center', marginBottom:'12px' } },
                React.createElement('button', { onClick: () => { window.location.href = 'landing.html'; }, style: { padding:'10px 24px', background:'var(--gold)', color:'var(--black)', border:'none', borderRadius:'6px', fontFamily:'Rajdhani, sans-serif', fontSize:'1.1rem', letterSpacing:'0.05em', cursor:'pointer' } }, 'Unlock ' + tierLabel + ' — ' + tierPrice),
            ),
            React.createElement('div', { style: { fontSize:'var(--text-body, 1rem)', color:'var(--silver)', opacity:0.5 } }, 'Currently on Scout (free) plan'),
            onClose ? React.createElement('button', { onClick: onClose, style: { marginTop:'10px', background:'none', border:'none', color:'var(--silver)', cursor:'pointer', fontSize:'var(--text-body, 1rem)' } }, 'Maybe later') : null
        );
    }
    window.UpgradeGate = UpgradeGate;
    // canAccess lives in core.js closure; do NOT re-assign to window
    // (overwrites shared/tier.js and causes infinite recursion via _sharedCanAccess)
    window.getUserTier = getUserTier;

    // ===== GATED "SEE ALL N" TEASER ROW =====
    // Locked teaser row appended to gated list sections (Intel Brief, Market
    // Radar, Empire queue, GM's Office). Free renders the section shell with
    // real rows sliced to zero — rows.slice(0, gated ? 0 : N) — plus this row;
    // no real recommendations reach the DOM. Port of reconai's
    // _scoutGatedMoreRow (js/scout-ui.js) in warroom terminal trim.
    function WrGatedMoreRow({ title, sub, feature }) {
        const openUpsell = () => {
            if (window.showProLaunchPage) window.showProLaunchPage();
            else if (window.showUpgradePrompt) window.showUpgradePrompt(feature || '');
        };
        return React.createElement('button', {
                onClick: openUpsell,
                style: { display:'flex', alignItems:'center', gap:'10px', width:'100%', textAlign:'left', padding:'10px 12px', background:'var(--off-black)', border:'1px solid var(--charcoal)', borderRadius:'2px', cursor:'pointer' }
            },
            React.createElement('span', { 'aria-hidden': true, style: { fontSize:'0.9rem' } }, '🔒'),
            React.createElement('span', { style: { flex:1, minWidth:0 } },
                React.createElement('div', { style: { fontFamily:'Rajdhani, sans-serif', fontSize:'0.95rem', fontWeight:600, color:'var(--white)', letterSpacing:'.03em' } }, title),
                sub ? React.createElement('div', { style: { fontSize:'var(--text-label, 0.75rem)', color:'var(--silver)', marginTop:'2px' } }, sub) : null
            ),
            React.createElement('span', { style: { fontFamily:'JetBrains Mono, monospace', fontSize:'var(--text-label, 0.75rem)', letterSpacing:'.08em', textTransform:'uppercase', color:'var(--gold)', border:'1px solid var(--acc-line3, rgba(212,175,55,0.4))', borderRadius:'2px', padding:'2px 6px' } }, 'Pro')
        );
    }
    window.WrGatedMoreRow = WrGatedMoreRow;

    // ===== PLAYER INLINE CARD (bottom-right, non-blocking) =====
    function PlayerInlineCard({ pid, playersData, statsData, onClose, onFullProfile }) {
        // Live viewport (shared seam, js/shared/viewport.js) — replaces the
        // render-time innerWidth read that went stale on rotation. Hook must
        // run before the !p early return (rules of hooks).
        const viewportWidth = window.WR.useViewport().width;
        const p = playersData?.[pid];
        if (!p) return null;
        const pos = p.position || '?';
        const name = p.full_name || ((p.first_name||'') + ' ' + (p.last_name||'')).trim();
        const dhq = window.App?.LI?.playerScores?.[pid] || 0;
        const meta = window.App?.LI?.playerMeta?.[pid] || {};
        const leagueSkin = window.App?.LeagueSkin?.getCurrent?.() || null;
        const valueShortLabel = leagueSkin?.vocabulary?.valueShortLabel || 'DHQ';
        const st = statsData?.[pid] || {};
        const nPos = ['DE','DT','NT'].includes(pos)?'DL':['CB','S','SS','FS'].includes(pos)?'DB':['OLB','ILB','MLB'].includes(pos)?'LB':pos;
        const curve = typeof window.App?.getAgeCurve === 'function'
            ? window.App.getAgeCurve(nPos)
            : { build: [22, 24], peak: (window.App.peakWindows || {})[nPos] || [24, 29], decline: [30, 32] };
        const [pLo, pHi] = curve.peak;
        const declineHi = curve.decline[1];
        const age = p.age || 0;
        // Unknown age (0) must not read as 29 peak years / 'Rising' — mirror the '—' guard used by My Roster / League Map.
        const peakYrs = age ? Math.max(0, pHi - age) : 0;
        const valueYrs = age ? Math.max(0, declineHi - age) : 0;
        const peakLabel = !age ? '—' : age < pLo ? 'Rising' : age <= pHi ? 'Prime' : age <= declineHi ? 'Veteran' : 'Post-Window';
        const peakCol = !age ? 'var(--k-d0d0d0, #d0d0d0)' : age < pLo ? 'var(--k-2ecc71, #2ecc71)' : age <= pHi ? 'var(--k-d4af37, #d4af37)' : age <= declineHi ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';
        const dhqCol = dhq >= 7000 ? 'var(--k-2ecc71, #2ecc71)' : dhq >= 4000 ? 'var(--k-3498db, #3498db)' : dhq >= 2000 ? 'var(--k-d0d0d0, #d0d0d0)' : 'var(--ov-8, rgba(255,255,255,0.3))';
        // Use league scoring_settings for PPG (matches roster table calculation)
        const scoring = window.S?.leagues?.[0]?.scoring_settings;
        const ppgRaw = window.App.calcPPG(st, scoring);
        const ppg = ppgRaw > 0 ? +ppgRaw.toFixed(1) : (meta.ppg || 0);
        const trend = meta.trend || 0;
        // Use shared getPlayerAction if available (ownership-aware)
        const pa = typeof window.getPlayerAction === 'function' ? window.getPlayerAction(pid) : null;
        const rec = pa ? pa.label.toUpperCase() : !age ? 'HOLD' : (peakYrs <= 0 && trend <= -10 ? 'SELL NOW' : peakYrs <= 0 ? 'SELL' : peakYrs <= 2 ? 'SELL' : dhq >= 7000 && peakYrs >= 3 ? 'HOLD CORE' : 'HOLD');
        const recCol = rec.includes('SELL') ? 'var(--k-e74c3c, #e74c3c)' : rec.includes('BUY') ? 'var(--k-2ecc71, #2ecc71)' : 'var(--k-d4af37, #d4af37)';
        // Verdict chip is Pro at this render seam; getPlayerAction itself stays
        // callable for engine logic. Fail-open when pro-gate.js isn't loaded.
        const inlinePro = typeof window.wrIsPro !== 'function' || window.wrIsPro();
        const initials = ((p.first_name||'?')[0] + (p.last_name||'?')[0]).toUpperCase();

        // Smart positioning: ensure card is fully visible
        const isMobile = viewportWidth < 440; // sheet threshold unchanged (D4 owns the ≤767 raise)
        const cardStyle = isMobile
            ? { position:'fixed', bottom:0, left:0, right:0, width:'100%', maxHeight:'85vh', overflowY:'auto', background:'var(--black)', border:'none', borderTop:'2px solid var(--acc-line3, rgba(212,175,55,0.4))', borderRadius:'14px 14px 0 0', zIndex:250, boxShadow:'0 -12px 48px rgba(0,0,0,0.7)', animation:'wrFadeIn 0.2s ease', paddingBottom:'calc(12px + var(--sab, env(safe-area-inset-bottom, 0px)))' }
            : { position:'fixed', bottom:'80px', right:'24px', width:'360px', maxHeight:'calc(100vh - 100px)', overflowY:'auto', background:'var(--black)', border:'2px solid var(--acc-line3, rgba(212,175,55,0.4))', borderRadius:'14px', zIndex:250, boxShadow:'0 12px 48px rgba(0,0,0,0.7)', animation:'wrFadeIn 0.2s ease' };

        return React.createElement('div', { style: cardStyle },
            // Header with photo
            React.createElement('div', { style:{ padding:'14px 16px', background:'linear-gradient(135deg, var(--acc-fill2, rgba(212,175,55,0.08)), transparent)', borderBottom:'1px solid var(--acc-fill3, rgba(212,175,55,0.15))', display:'flex', gap:'12px', alignItems:'center' } },
                React.createElement('div', { className: 'wr-ring wr-ring-' + nPos, style:{ width:'48px', height:'48px', borderRadius:'10px', overflow:'hidden', background:'var(--acc-fill2, rgba(212,175,55,0.1))', border:'1px solid var(--acc-line1, rgba(212,175,55,0.2))', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 } },
                    React.createElement('img', { src:'https://sleepercdn.com/content/nfl/players/'+pid+'.jpg', style:{width:'48px',height:'48px',objectFit:'cover'}, onError:function(e){ e.target.style.display='none'; const s=document.createElement('span'); s.style.cssText='font-size:16px;font-weight:700;color:var(--k-d4af37, #d4af37)'; s.textContent=initials; e.target.after(s);; } })
                ),
                React.createElement('div', { style:{flex:1} },
                    React.createElement('div', { style:{ fontFamily:'Rajdhani, sans-serif', fontSize:'1.2rem', color: 'var(--text-primary)', letterSpacing:'0.02em' } }, name),
                    React.createElement('div', { style:{ fontSize:'var(--text-body, 1rem)', color:'var(--silver)' } }, nPos+' \u00B7 '+(p.team||'FA')+' \u00B7 Age '+(age||'?')+(p.college ? ' \u00B7 '+p.college : ''))
                ),
                React.createElement('button', { onClick:onClose, style:{ background:'none', border:'none', color: 'var(--text-muted)', cursor:'pointer', fontSize:'1.1rem', padding:'2px', minWidth:'44px', minHeight:'44px', display:'flex', alignItems:'center', justifyContent:'center' } }, '\u2715')
            ),
            // Stats row \u2014 ACTION verdict cell is Pro; free gets the raw 3-cell row.
            React.createElement('div', { style:{ display:'grid', gridTemplateColumns:'repeat('+(inlinePro?4:3)+',1fr)', gap:'4px', padding:'10px 16px', borderBottom:'1px solid var(--ov-4, rgba(255,255,255,0.06))' } },
                ...[
                    { val:dhq>0?dhq.toLocaleString():'\u2014', lbl:valueShortLabel, col:dhqCol, gauge:true },
                    { val:ppg||'\u2014', lbl:'PPG', col:ppg>=10?'var(--k-2ecc71, #2ecc71)':'var(--k-d0d0d0, #d0d0d0)' },
                    { val:!age?'—':peakYrs>0?peakYrs+'yr':valueYrs+'yr', lbl:peakYrs>0?'PEAK':'VALUE', col:peakCol },
                    ...(inlinePro ? [{ val:rec, lbl:'ACTION', col:recCol }] : [])
                ].map(function(s,i){ var dhqFilled=s.gauge?Math.round(Math.min(10,dhq/1000)):0; var gCol=dhq>=7000?'filled-green':dhq>=4000?'filled':'filled-red'; return React.createElement('div', { key:i, style:{textAlign:'center'} },
                    React.createElement('div', { style:{ fontFamily:'JetBrains Mono, monospace', fontSize:'1rem', fontWeight:600, color:s.col } }, s.val),
                    s.gauge ? React.createElement('div', { className:'wr-gauge', style:{marginTop:'2px'} }, Array.from({length:10}, function(_,gi){ return React.createElement('div', { key:gi, className:'wr-gauge-seg'+(gi<dhqFilled?' '+gCol:'') }); })) : null,
                    React.createElement('div', { style:{ fontSize:'var(--text-label, 0.75rem)', color: 'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em' } }, s.lbl)
                ); })
            ),
            // Age curve visualization
            React.createElement('div', { style:{ padding:'8px 16px' } },
                React.createElement('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' } },
                    React.createElement('div', { style:{ fontSize:'var(--text-label, 0.75rem)', color: 'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:700 } }, 'Age Curve'),
                    React.createElement('div', { style:{ fontSize:'var(--text-label, 0.75rem)', color:peakCol } }, !age ? 'Age unknown' : peakLabel+' \u00B7 '+(peakYrs > 0 ? peakYrs+'yr peak left' : valueYrs > 0 ? valueYrs+'yr value left' : 'Past value window'))
                ),
                React.createElement('div', { style:{ display:'flex', height:'16px', borderRadius:'4px', overflow:'hidden', gap:'1px' } },
                    ...Array.from({length:17}, function(_,i){ var a=i+20; var col=a<pLo-3?'rgba(96,165,250,0.3)':a<pLo?'rgba(46,204,113,0.45)':(a>=pLo&&a<=pHi)?'rgba(46,204,113,0.75)':a<=declineHi?'var(--acc-line3, rgba(212,175,55,0.45))':'rgba(231,76,60,0.35)'; return React.createElement('div', { key:a, style:{ flex:1, background:col, opacity:a===age?1:0.55, outline:a===age?'2px solid var(--k-d4af37, #d4af37)':'none', outlineOffset:'-1px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'var(--text-label, 0.75rem)', fontWeight:700, color:a===age?'var(--text-primary)':'transparent' } }, a===age?String(age):''); })
                ),
                React.createElement('div', { style:{ display:'flex', justifyContent:'space-between', fontSize:'var(--text-label, 0.75rem)', color: 'var(--text-muted)', marginTop:'2px' } },
                    React.createElement('span', null, '20'),
                    React.createElement('span', null, 'Peak '+pLo+'\u2013'+pHi),
                    React.createElement('span', null, '36')
                )
            ),
            // Action buttons
            React.createElement('div', { style:{ padding:'10px 16px', display:'flex', gap:'6px', borderTop:'1px solid var(--ov-4, rgba(255,255,255,0.06))' } },
                React.createElement('button', { onClick:onFullProfile, style:{ flex:1, padding:'8px', minHeight:'44px', background:'var(--k-d4af37, #d4af37)', color:'var(--k-0a0a0a, #0a0a0a)', border:'none', borderRadius:'6px', fontFamily:'Rajdhani, sans-serif', fontSize:'var(--text-body, 1rem)', cursor:'pointer' } }, 'FULL PROFILE'),
                React.createElement('button', { onClick:onClose, style:{ padding:'8px 14px', minHeight:'44px', background:'transparent', border:'1px solid var(--acc-line2, rgba(212,175,55,0.3))', color:'var(--k-d4af37, #d4af37)', borderRadius:'6px', fontFamily:'Rajdhani, sans-serif', fontSize:'var(--text-body, 1rem)', cursor:'pointer' } }, 'CLOSE')
            )
        );
    }

    // ===== GLOBAL UI COMPONENTS =====
    function Tip({ children }) {
        const [open, setOpen] = React.useState(false);
        const ref = React.useRef(null);

        React.useEffect(() => {
            if (!open) return;
            const close = () => setOpen(false);
            setTimeout(() => document.addEventListener('click', close), 10);
            return () => document.removeEventListener('click', close);
        }, [open]);

        return React.createElement('span', { ref: ref, style: { position: 'relative', display: 'inline-flex' } },
            React.createElement('span', {
                className: 'wr-tip-icon',
                onClick: function(e) { e.stopPropagation(); setOpen(!open); },
                onMouseEnter: function() { setOpen(true); },
            }, '?'),
            open ? React.createElement('div', {
                className: 'wr-tip-box show',
                onClick: function(e) { e.stopPropagation(); },
                onMouseEnter: function() { setOpen(true); },
                onMouseLeave: function() { setTimeout(function() { setOpen(false); }, 2000); },
                style: { position: 'fixed', top: (ref.current?.getBoundingClientRect()?.bottom || 0) + 6 + 'px', left: Math.min(ref.current?.getBoundingClientRect()?.left || 0, window.innerWidth - 240) + 'px', width: '220px', zIndex: 9999, whiteSpace: 'normal' }
            }, children) : null
        );
    }

    // ===== ALEX INGRAM AVATAR SYSTEM =====
    const ALEX_AVATARS = [
        { id: 'badge', label: 'Gold Badge', src: null },
        { id: 'exec', label: 'The Executive', src: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&crop=face' },
        { id: 'analyst', label: 'The Analyst', src: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=120&h=120&fit=crop&crop=face' },
        { id: 'coach', label: 'The Coach', src: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=120&h=120&fit=crop&crop=face' },
        { id: 'scout', label: 'The Scout', src: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=120&h=120&fit=crop&crop=face' },
    ];
    function getAlexAvatar() {
        const id = ComponentsStorage.get(COMPONENTS_WR_KEYS.ALEX_AVATAR, 'badge') || 'badge';
        // Tolerate legacy emoji-picker ids (brain/target/chart/football/bolt/
        // fire/medal/trophy — the retired settings.js vocabulary) and anything
        // else unknown: fall back to the default badge, never a broken image.
        // Stored legacy values are ignored, not migrated.
        return ALEX_AVATARS.some(a => a.id === id) ? id : 'badge';
    }
    function setAlexAvatar(id) {
        ComponentsStorage.set(COMPONENTS_WR_KEYS.ALEX_AVATAR, id);
    }
    // Owner ask (2026-07-12): retire the stock-photo avatars — Alex is always the
    // "AI" badge, but its COLOR is user-configurable. Stored id → gradient/text.
    const ALEX_BADGE_COLORS = [
        { id: 'gold',   label: 'Gold',   from: '#d4af37', to: '#b8941e', text: '#0a0a0a' },
        { id: 'blue',   label: 'Blue',   from: '#5dade2', to: '#2e86c1', text: '#0a0a0a' },
        { id: 'violet', label: 'Violet', from: '#9b8afb', to: '#7c6bf8', text: '#ffffff' },
        { id: 'green',  label: 'Green',  from: '#2ecc71', to: '#239b56', text: '#07100b' },
        { id: 'red',    label: 'Red',    from: '#e5534b', to: '#c0392b', text: '#ffffff' },
        { id: 'teal',   label: 'Teal',   from: '#4ecdc4', to: '#2c9c94', text: '#07100b' },
    ];
    function getAlexBadgeColor() {
        let id;
        try { id = localStorage.getItem('wr_alex_badge_color') || 'gold'; } catch (e) { id = 'gold'; }
        return ALEX_BADGE_COLORS.find(c => c.id === id) || ALEX_BADGE_COLORS[0];
    }
    function setAlexBadgeColor(id) {
        try { localStorage.setItem('wr_alex_badge_color', id); } catch (e) { /* no-op */ }
    }
    function AlexAvatar({ size }) {
        const sz = size || 28;
        const c = getAlexBadgeColor();
        return React.createElement('div', { style: { width: sz+'px', height: sz+'px', borderRadius: sz > 24 ? '8px' : '6px', background: 'linear-gradient(135deg, ' + c.from + ', ' + c.to + ')', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: (sz * 0.024) + 'rem', fontWeight: 800, color: c.text, fontFamily: 'Rajdhani, sans-serif' } }, 'AI');
    }
    window.AlexAvatar = AlexAvatar;
    window.ALEX_AVATARS = ALEX_AVATARS;
    window.ALEX_BADGE_COLORS = ALEX_BADGE_COLORS;
    window.getAlexBadgeColor = getAlexBadgeColor;
    window.setAlexBadgeColor = setAlexBadgeColor;

    // ===== ALEX INGRAM — AI GM MESSAGE COMPONENT (Slack-style) =====
    function GMMessage({ children, timestamp, compact, title }) {
        const now = timestamp || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        if (compact) {
            return React.createElement('div', { style: {
                display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '4px 10px',
                background: 'var(--acc-fill1, rgba(212,175,55,0.04))', borderRadius: '8px', marginBottom: '6px',
                border: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))'
            }},
                React.createElement(AlexAvatar, { size: 20 }),
                React.createElement('div', { style: { flex: 1 } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '1px' } },
                        React.createElement('span', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', letterSpacing: '0.03em' } }, 'Alex Ingram')
                    ),
                    React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.4 } }, children)
                )
            );
        }
        return React.createElement('div', { style: {
            background: 'var(--acc-fill1, rgba(212,175,55,0.03))', border: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))',
            borderRadius: '8px', padding: '10px 14px', marginBottom: '8px'
        }},
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } },
                React.createElement(AlexAvatar, { size: 28 }),
                React.createElement('div', { style: { flex: 1 } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                        React.createElement('span', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', letterSpacing: '0.03em' } }, 'Alex Ingram')
                    ),
                    React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.35 } }, now)
                )
            ),
            title && React.createElement('div', { style: { fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' } }, title),
            React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.4 } }, children)
        );
    }
    window.GMMessage = GMMessage;

    // ===== INLINE CAREER STATS (for expanded player card) =====
    function InlineCareerStats({ pid, pos, player, scoringSettings, statsData }) {
        const [html, setHtml] = React.useState(null);
        const [collegeHtml, setCollegeHtml] = React.useState(null);
        const [loading, setLoading] = React.useState(true);
        React.useEffect(() => {
            let cancelled = false;
            const sc = scoringSettings || {};
            const curYear = parseInt(window.S?.season) || new Date().getFullYear();
            const exp = player?.years_exp || 0;

            // Check for college stats first
            if (typeof window.buildCollegeStatsTable === 'function') {
                const cHtml = window.buildCollegeStatsTable(pid);
                if (cHtml) setCollegeHtml(cHtml);
            }

            // Show immediate data from statsData while fetching career
            const quickData = {};
            const st = statsData?.[pid];
            if (st && Object.keys(st).length > 1) quickData[curYear] = st;

            if (typeof window.fwBuildCareerTable === 'function' && Object.keys(quickData).length) {
                setHtml(window.fwBuildCareerTable(pid, quickData, pos, sc, player));
                setLoading(false);
            }

            // Fetch full career in background
            if (typeof window.fwFetchCareerStats === 'function') {
                window.fwFetchCareerStats(pid, curYear, exp).then(careerData => {
                    if (cancelled) return;
                    if (Object.keys(careerData).length && typeof window.fwBuildCareerTable === 'function') {
                        setHtml(window.fwBuildCareerTable(pid, careerData, pos, sc, player));
                    }
                    setLoading(false);
                }).catch(() => setLoading(false));
            } else {
                setLoading(false);
            }
            return () => { cancelled = true; };
        }, [pid]);

        const collegeData = window.COLLEGE_STATS?.[pid];
        const sections = [];

        // College stats section
        if (collegeHtml) {
            sections.push(React.createElement('div', { key: 'college', style: { marginBottom: html ? '14px' : 0 } },
                React.createElement('div', { style: { fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' } },
                    'College Stats',
                    collegeData && React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.5, textTransform: 'none', fontFamily: 'inherit', letterSpacing: 0 } }, collegeData.school + ' \u00B7 ' + collegeData.conf + ' \u00B7 ' + collegeData.years)
                ),
                React.createElement('div', { dangerouslySetInnerHTML: { __html: collegeHtml }, style: { fontSize: 'var(--text-body, 1rem)' } })
            ));
        }

        // NFL stats section — skip for rookies (no NFL production yet)
        const isRookie = (player?.years_exp || 0) === 0;
        if (html && !isRookie) {
            sections.push(React.createElement('div', { key: 'nfl' },
                React.createElement('div', { style: { fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' } }, 'NFL Stats'),
                React.createElement('div', { dangerouslySetInnerHTML: { __html: html }, style: { fontSize: 'var(--text-body, 1rem)' } })
            ));
        } else if (loading && !isRookie) {
            sections.push(React.createElement('div', { key: 'loading', style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.5 } }, 'Loading stats...'));
        }

        if (!sections.length) {
            sections.push(React.createElement('div', { key: 'empty' },
                React.createElement('div', { style: { fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' } }, 'Career Stats'),
                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.5 } }, 'No stats available')
            ));
        }

        return React.createElement('div', { style: { background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' } }, ...sections);
    }

    function SkeletonRows({ count, cols }) {
        const rows = [];
        for (let i = 0; i < (count||6); i++) {
            rows.push(React.createElement('div', { key:i, className:'skel-row' },
                React.createElement('div', { className:'skel skel-circle' }),
                React.createElement('div', { style:{flex:1} },
                    React.createElement('div', { className:'skel skel-line', style:{width:(60+Math.random()*30)+'%'} })
                ),
                React.createElement('div', { className:'skel skel-line', style:{width:'50px',marginBottom:0} })
            ));
        }
        return React.createElement('div', null, rows);
    }

    function SkeletonKPI() {
        return React.createElement('div', { className:'skel-card', style:{textAlign:'center',minWidth:'120px'} },
            React.createElement('div', { className:'skel skel-line', style:{width:'60%',margin:'0 auto 8px'} }),
            React.createElement('div', { className:'skel skel-line', style:{width:'40%',height:'24px',margin:'0 auto 6px'} }),
            React.createElement('div', { className:'skel skel-line', style:{width:'50%',margin:'0 auto'} })
        );
    }

    // ===== CONTEXTUAL AI ANNOTATION ENGINE =====
    // Pre-computed insights from DHQ data — no API calls needed.
    // Returns short text annotations for roster, matchup, and analytics views.
    function getPlayerAnnotation(pid) {
        const LI = window.App?.LI || {};
        const meta = LI.playerMeta?.[pid];
        const dhq = LI.playerScores?.[pid] || 0;
        if (!meta || !dhq) return null;
        const age = meta.age || 0;
        const pos = meta.pos || '';
        const curve = typeof window.App?.getAgeCurve === 'function'
            ? window.App.getAgeCurve(pos)
            : { build: [22, 24], peak: (window.App.peakWindows || {})[pos] || [24, 29], decline: [30, 32] };
        const [pLo, pHi] = curve.peak;
        const declineHi = curve.decline[1];
        const peakYrsLeft = meta.peakYrsLeft || Math.max(0, pHi - age);
        const valueYrsLeft = Math.max(0, declineHi - age);
        const trend = meta.trend || 0;

        if (age > declineHi && dhq >= 2000) return { text: 'Sell high \u2014 past value window', color: 'var(--k-e74c3c, #e74c3c)', rec: 'SELL' };
        if (age > pHi && age <= declineHi && dhq >= 3000 && trend <= -10) return { text: 'Veteran decline band \u2014 monitor closely', color: 'var(--k-f0a500, #f0a500)', rec: 'HOLD' };
        if (peakYrsLeft >= 5 && dhq >= 3000) return { text: peakYrsLeft + ' peak yrs ahead \u2014 cornerstone', color: 'var(--k-2ecc71, #2ecc71)', rec: 'HOLD' };
        if (peakYrsLeft >= 3 && trend >= 15) return { text: 'Breakout trajectory +' + trend + '%', color: 'var(--k-2ecc71, #2ecc71)', rec: 'HOLD' };
        if (age >= pLo && age <= pHi && dhq >= 5000) return { text: 'Prime window \u2014 maximize now', color: 'var(--gold)', rec: 'HOLD' };
        if (valueYrsLeft <= 1 && dhq >= 2000) return { text: 'Window closing \u2014 sell or ride', color: 'var(--k-f0a500, #f0a500)', rec: 'HOLD' };
        return null;
    }

    function getMatchupAnnotation(myPPG, oppPPG, pos) {
        const diff = myPPG - oppPPG;
        if (diff > 5) return { text: 'Strong edge +' + diff.toFixed(1), color: 'var(--k-2ecc71, #2ecc71)' };
        if (diff > 2) return { text: 'Slight edge', color: 'var(--k-2ecc71, #2ecc71)' };
        if (diff < -5) return { text: 'Vulnerable \u2014 ' + diff.toFixed(1), color: 'var(--k-e74c3c, #e74c3c)' };
        if (diff < -2) return { text: 'Disadvantage', color: 'var(--k-e74c3c, #e74c3c)' };
        return { text: 'Even matchup', color: 'var(--silver)' };
    }

    function getKpiAnnotation(kpiKey, value) {
        const LI = window.App?.LI || {};
        const S = window.App?.S || window.S || {};
        const scores = LI.playerScores || {};
        const rosters = S.rosters || [];
        if (!rosters.length) return '';

        const myTotal = (rosters.find(r => r.roster_id === S.myRosterId)?.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0);
        const avgTotal = rosters.reduce((s, r) => s + (r.players || []).reduce((ps, pid) => ps + (scores[pid] || 0), 0), 0) / rosters.length;

        if (kpiKey === 'portfolio' || kpiKey === 'value-rank') {
            const pct = avgTotal > 0 ? Math.round((myTotal - avgTotal) / avgTotal * 100) : 0;
            return pct > 0 ? '\u2191 ' + pct + '% above league avg' : pct < 0 ? '\u2193 ' + Math.abs(pct) + '% below league avg' : '\u2192 At league average';
        }
        if (kpiKey === 'health-score') {
            const v = parseInt(value);
            if (isNaN(v)) return ''; // value renders '\u2014' before assessment loads \u2014 no verdict from missing data
            return v >= 85 ? '\u2191 Championship caliber' : v >= 70 ? '\u2192 Playoff contender' : v >= 55 ? '\u2193 Work to do' : '\u2193 Rebuild mode';
        }
        if (kpiKey === 'aging-cliff') {
            const v = parseInt(value);
            if (isNaN(v)) return '';
            // Bands match computeKpiValue's colors (league-detail): green \u226420 / amber \u226435 / red >35
            return v > 35 ? '\u26A0 High risk \u2014 sell aging assets' : v > 20 ? '\u2192 Moderate \u2014 monitor closely' : '\u2191 Sustainable roster age';
        }
        return '';
    }
    window.getPlayerAnnotation = getPlayerAnnotation;
    window.getMatchupAnnotation = getMatchupAnnotation;
    window.getKpiAnnotation = getKpiAnnotation;

    // Error Boundary — catches render crashes and shows recovery UI
    class ErrorBoundary extends React.Component {
        constructor(props) {
            super(props);
            this.state = { hasError: false, error: null };
        }
        static getDerivedStateFromError(error) {
            return { hasError: true, error };
        }
        componentDidCatch(error, info) {
            console.error('[War Room] Render crash:', error, info.componentStack);
            window.DHQBugCapture?.captureError?.(error, { source: 'react_error_boundary', app: 'warroom' }, {
                componentStack: info?.componentStack || '',
            });
        }
        render() {
            if (this.state.hasError) {
                return React.createElement('div', {
                    style: {
                        padding: '40px 20px', textAlign: 'center', maxWidth: '500px',
                        margin: '80px auto', background: 'var(--black)', border: '1px solid rgba(231,76,60,0.3)',
                        borderRadius: '10px'
                    }
                },
                    React.createElement('div', { style: { fontSize: '2rem', marginBottom: '12px' } }, '\u26A0\uFE0F'),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.4rem', color: 'var(--white)', marginBottom: '8px' } }, 'Something went wrong'),
                    React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.6, marginBottom: '16px' } },
                        'Dynasty HQ encountered an error. This usually fixes itself on reload.'),
                    React.createElement('button', {
                        onClick: () => { this.setState({ hasError: false, error: null }); },
                        style: { padding: '10px 24px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '6px', fontFamily: 'var(--font-body)', fontSize: '1rem', cursor: 'pointer', marginRight: '8px' }
                    }, 'Try Again'),
                    React.createElement('button', {
                        onClick: () => window.location.reload(),
                        style: { padding: '10px 24px', background: 'transparent', color: 'var(--gold)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '6px', fontFamily: 'var(--font-body)', fontSize: '1rem', cursor: 'pointer' }
                    }, 'Reload Page'),
                    React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.5, marginTop: '12px' } },
                        String(this.state.error?.message || '').substring(0, 100))
                );
            }
            return this.props.children;
        }
    }
    window.ErrorBoundary = ErrorBoundary;

    // ===== DEV MODE =====
    const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const DEV_MODE = new URLSearchParams(window.location.search).has('dev') || window.location.hostname.includes('sandbox') || IS_LOCAL;
    const DEV_DEBUG = new URLSearchParams(window.location.search).get('dev') === 'true';
    if (DEV_MODE) {
        console.log('%c[DEV MODE] All features unlocked, auth bypassed','color:var(--k-d4af37, #d4af37);font-weight:bold;font-size:var(--text-body, 1rem)');
        document.documentElement.style.setProperty('--wr-dev-banner-height', '18px');
        const b = document.createElement('div');
        b.className = 'wr-dev-banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;height:18px;box-sizing:border-box;z-index:99999;background:var(--k-d4af37, #d4af37);color:var(--k-000000, #000000);font-size:var(--text-label, 0.75rem);font-weight:700;text-align:center;padding:3px;letter-spacing:.05em;font-family:monospace;line-height:12px;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        b.textContent = IS_LOCAL ? '⚡ LOCAL DEV — bigloco auto-logged in, all features unlocked' : 'SANDBOX — changes here do not affect production';
        document.body.prepend(b);
    }

    // ===== AUTHENTICATION CHECK =====
    const AUTH_KEY    = 'od_auth_v1';
    const SESSION_KEY = 'fw_session_v1';

    const legacyAuth   = localStorage.getItem(AUTH_KEY);
    const newSession   = (() => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } })();
    const isAuthed     = !!(legacyAuth || newSession?.token || DEV_MODE);

    // Franchise picker is now the default landing — logged-out visitors are no
    // longer bounced to landing.html. They arrive on the hub and connect a league
    // (which doubles as sign-in) via the "Add a league" tile. Marketing/landing
    // stays reachable from the DHQ logo and the Empire upsell card.
    void isAuthed;

    let sleeperUsername = '';
    // Dev mode: use URL param or default test username
    if (DEV_MODE) {
        sleeperUsername = new URLSearchParams(window.location.search).get('user') || 'bigloco';
    }
    try {
        if (legacyAuth && !sleeperUsername) {
            const credentials = JSON.parse(legacyAuth);
            sleeperUsername = credentials.username || '';
            // Sync username to Team Comps page localStorage key so it auto-logs in
            if (sleeperUsername) {
                localStorage.setItem('od_locked_username_v2', sleeperUsername);
            }
        }
    } catch (e) {
        // Corrupt legacy auth blob — clear it and let the hub handle the
        // logged-out state (no forced bounce to landing.html anymore).
        localStorage.removeItem(AUTH_KEY);
    }
