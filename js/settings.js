// ══════════════════════════════════════════════════════════════════
// settings.js — SettingsModal component
// ══════════════════════════════════════════════════════════════════

    // ── Sub-components (hooks require stable component boundaries) ──

    function AlexTab({ sectionStyle, sectionTitle }) {
        // One canonical Alex voice (owner ruling 2026-07-08): the coaching-style
        // picker (ALEX_STYLES / wr_alex_style) is retired. Any stored
        // wr_alex_style value is ignored by readers — tolerated, never migrated.
        // Avatar vocabulary is unified on components.js ALEX_AVATARS (photo ids:
        // badge/exec/analyst/coach/scout) — the set the chat/GMMessage renderer
        // (AlexAvatar) actually displays. Legacy emoji ids (brain/target/chart/…)
        // stored on wr_alex_avatar normalize to 'badge' (no broken images).
        // Alex is always the "AI" badge now (photos retired) — the user picks its
        // COLOR (owner ask). Stored via components.js window.setAlexBadgeColor.
        const badgeColors = window.ALEX_BADGE_COLORS || [{ id: 'gold', label: 'Gold', from: '#d4af37', to: '#b8941e', text: '#0a0a0a' }];
        const [currentBadge, setCurrentBadge] = React.useState(() => (window.getAlexBadgeColor && window.getAlexBadgeColor().id) || 'gold');
        return (<>
        <div style={sectionStyle}>
            <div style={sectionTitle}>ALEX BADGE</div>
            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '0.75rem' }}>Pick the color of Alex's badge. Shown in briefings and chat.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '8px' }}>
                {badgeColors.map(bc => {
                    const isActive = currentBadge === bc.id;
                    return <button key={bc.id} onClick={() => { if (window.setAlexBadgeColor) window.setAlexBadgeColor(bc.id); setCurrentBadge(bc.id); window.dispatchEvent(new CustomEvent('wr:alex-badge-changed')); }}
                        style={{
                            padding: '12px 8px', textAlign: 'center',
                            background: isActive ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'var(--ov-1, rgba(255,255,255,0.02))',
                            border: isActive ? '2px solid var(--gold)' : '1px solid var(--ov-5, rgba(255,255,255,0.08))',
                            borderRadius: '10px', cursor: 'pointer',
                        }}>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
                            <div style={{ width: '44px', height: '44px', borderRadius: '8px', background: 'linear-gradient(135deg, ' + bc.from + ', ' + bc.to + ')', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: bc.text, fontFamily: 'Rajdhani, sans-serif', boxShadow: isActive ? '0 0 0 2px var(--acc-line3, rgba(212,175,55,0.4))' : 'none' }}>AI</div>
                        </div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: isActive ? 'var(--gold)' : 'var(--silver)' }}>{bc.label}</div>
                    </button>;
                })}
            </div>
        </div>
        <div style={sectionStyle}>
            <div style={sectionTitle}>GM BRIEFING</div>
            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '0.75rem', lineHeight: 1.45 }}>Re-open Alex's welcome briefing in the chat any time you want to re-orient the room.</div>
            <button onClick={() => window.dispatchEvent(new CustomEvent('wr:replay-welcome'))} style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'var(--acc-fill2, rgba(212,175,55,0.1))', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', borderRadius: '6px', color: 'var(--gold)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}>Replay GM Briefing</button>
        </div>
        </>);
    }

    function CommissionerTab({ sectionStyle, sectionTitle }) {
        const leagueId = (window.S || {}).currentLeagueId || '';
        const [docs, setDocs] = React.useState([]);
        const [uploading, setUploading] = React.useState(false);
        const [uploadMsg, setUploadMsg] = React.useState('');

        React.useEffect(() => {
            if (window.OD?.listLeagueDocs && leagueId) {
                window.OD.listLeagueDocs(leagueId).then(d => setDocs(d || []));
            }
        }, [leagueId]);

        const handleFileUpload = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(true); setUploadMsg('');
            try {
                const text = await file.text();
                if (!text.trim()) { setUploadMsg('File is empty.'); setUploading(false); return; }
                const name = file.name.toLowerCase();
                const category = name.includes('bylaw') ? 'bylaws' : name.includes('award') ? 'awards' : name.includes('calendar') || name.includes('schedule') ? 'calendar' : name.includes('scor') ? 'scoring' : 'general';
                const ok = await window.OD.uploadLeagueDoc(leagueId, file.name, text, category);
                if (ok) {
                    setUploadMsg('Uploaded! Alex will now reference this document.');
                    const updated = await window.OD.listLeagueDocs(leagueId);
                    setDocs(updated || []);
                    const ctx = await window.OD.getLeagueDocsContext(leagueId);
                    if (ctx) window._leagueDocsContext = ctx;
                } else { setUploadMsg('Upload failed. Check your connection.'); }
            } catch (err) { setUploadMsg('Error: ' + (err.message || 'Unknown')); }
            setUploading(false);
        };

        const handleDelete = async (docName) => {
            if (!confirm('Delete "' + docName + '"? Alex will no longer reference it.')) return;
            await window.OD?.deleteLeagueDoc(leagueId, docName);
            const updated = await window.OD?.listLeagueDocs(leagueId);
            setDocs(updated || []);
            const ctx = await window.OD?.getLeagueDocsContext(leagueId);
            window._leagueDocsContext = ctx || '';
        };

        return (<>
        <div style={sectionStyle}>
            <div style={sectionTitle}>LEAGUE DOCUMENTS</div>
            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                Upload your league bylaws, awards history, custom rules, or any league-specific documents. Alex will use these to answer league questions and reference your league's customs.
            </div>
            {!leagueId ? (
                <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.5 }}>Connect a league first to upload documents.</div>
            ) : (<>
                <div style={{ marginBottom: '12px' }}>
                    <label style={{
                        display: 'block', padding: '14px', textAlign: 'center',
                        background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '2px dashed var(--acc-line1, rgba(212,175,55,0.25))',
                        borderRadius: '10px', cursor: 'pointer', fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', fontWeight: 600,
                    }}>
                        {uploading ? 'Uploading...' : '+ Upload Document (.txt, .md, .csv)'}
                        <input type="file" accept=".txt,.md,.csv,.text" onChange={handleFileUpload} style={{ display: 'none' }} />
                    </label>
                    {uploadMsg && <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: uploadMsg.includes('fail') || uploadMsg.includes('Error') ? 'var(--k-f87171, #f87171)' : 'var(--k-34d399, #34d399)', marginTop: '6px' }}>{uploadMsg}</div>}
                </div>
                {docs.length > 0 && (
                    <div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>UPLOADED ({docs.length})</div>
                        {docs.map((d, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))' }}>
                                <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--white)', flex: 1 }}>{d.name}</span>
                                <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', padding: '1px 6px', borderRadius: '6px', background: 'var(--acc-fill2, rgba(212,175,55,0.1))' }}>{d.category}</span>
                                <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>{new Date(d.uploadedAt).toLocaleDateString()}</span>
                                <button onClick={() => handleDelete(d.name)} style={{ background: 'none', border: 'none', color: 'var(--k-f87171, #f87171)', cursor: 'pointer', fontSize: 'var(--text-label, 0.75rem)', padding: '2px 6px', minHeight: '44px', minWidth: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Delete</button>
                            </div>
                        ))}
                    </div>
                )}
            </>)}
        </div>
        </>);
    }

    function SettingsContent({ onClose, initDisplayName, onDisplayNameSave, leagueMates, mode = 'modal', accountOnly = false, phoneSheet = false }) {
        const [settingsTab, setSettingsTab] = React.useState('account');
        const [showPw, setShowPw] = React.useState(false);
        const [pwMsg, setPwMsg] = React.useState('');
        const [currentPw, setCurrentPw] = React.useState('');
        const [newPw, setNewPw] = React.useState('');
        const [confirmPw, setConfirmPw] = React.useState('');
        const [displayName, setDisplayName] = React.useState(initDisplayName || '');
        const [matesAccess, setMatesAccess] = React.useState(null); // Set of usernames with accounts
        const [giftLinks, setGiftLinks] = React.useState({}); // { username: { url, password } }
        const [giftingFor, setGiftingFor] = React.useState(null);

        // ── Phone tier (<768, iPhone program Phase 4) ──
        // WR.useViewport (js/shared/viewport.js) precedes the babel chain,
        // so its presence is page-constant — the hook call is order-safe.
        // `_phone` only ever swaps in phone-scoped styling below; when it
        // is false every desktop/tablet branch renders byte-identical.
        const _vpUse = window.WR && window.WR.useViewport;
        const _vp = _vpUse ? _vpUse() : { isPhone: false };
        const _phone = !!_vp.isPhone;

        const isGiftedAccount = React.useMemo(() => {
            try {
                const auth = JSON.parse(localStorage.getItem('od_auth_v1') || '{}');
                return !!auth.isGifted;
            } catch { return false; }
        }, []);

        const currentTier = React.useMemo(() => {
            try {
                const p = JSON.parse(localStorage.getItem('od_profile_v1') || '{}');
                const appTier = typeof window.getUserTier === 'function' ? window.getUserTier() : null;
                return appTier || p.tier || 'free';
            } catch { return 'free'; }
        }, []);

        const tierLabel = { free: 'Dynasty HQ Free', trial: 'Dynasty HQ Trial', scout: 'Scout', warroom: 'Dynasty HQ', pro: 'Dynasty HQ Pro', power: 'Dynasty HQ Power', paid: 'Paid' };
        const tierColor = { free: 'var(--silver)', trial: 'var(--silver)', scout: 'var(--silver)', warroom: 'var(--gold)', pro: 'var(--gold)', power: 'var(--k-a855f7, #a855f7)', paid: 'var(--gold)' };
        const tierBg    = { free: 'rgba(192,192,192,0.12)', trial: 'rgba(192,192,192,0.12)', scout: 'rgba(192,192,192,0.12)', warroom: 'var(--acc-fill2, rgba(212,175,55,0.12))', pro: 'var(--acc-fill2, rgba(212,175,55,0.12))', power: 'rgba(168,85,247,0.12)', paid: 'var(--acc-fill2, rgba(212,175,55,0.12))' };

        function goToManagePlan() {
            window.location.href = 'upgrade.html';
        }

        // ── Manage / cancel subscription ─────────────────────────────
        // Web (Stripe) subs open the Stripe Billing Portal via fw-billing-portal,
        // where cancel / change-plan / update-card all live. Accounts with no
        // Stripe history fall back to the plans page. (App Store subs are
        // managed in Apple ID settings from the separate iOS app.)
        const [billingBusy, setBillingBusy] = React.useState(false);
        async function manageBilling() {
            const client = window.OD && typeof window.OD.getClient === 'function' ? window.OD.getClient() : null;
            if (!client) { goToManagePlan(); return; }
            setBillingBusy(true);
            try {
                const { data, error } = await client.functions.invoke('fw-billing-portal', {
                    body: { returnUrl: window.location.origin + window.location.pathname },
                });
                if (!error && data && data.url) { window.location.href = data.url; return; }
                goToManagePlan();
            } catch { goToManagePlan(); }
            finally { setBillingBusy(false); }
        }

        // ── Avatar (local preset, no upload round-trip) ──────────────
        const AVATAR_CHOICES = ['🏈', '🏆', '🎯', '🛡️', '👑', '🔥', '⚡', '🦅', '💪', '🧠', '🎲', '⭐'];
        const [avatarEmoji, setAvatarEmoji] = React.useState(() => {
            try { return localStorage.getItem('od_avatar_emoji') || ''; } catch { return ''; }
        });
        function pickAvatar(emoji) {
            const next = emoji === avatarEmoji ? '' : emoji; // tap again to clear back to initials
            setAvatarEmoji(next);
            try {
                if (next) localStorage.setItem('od_avatar_emoji', next);
                else localStorage.removeItem('od_avatar_emoji');
            } catch { /* private mode */ }
        }

        // ── Notification preferences ─────────────────────────────────
        const NOTIFY_DEFAULTS = { tradeAlerts: true, waiverWire: true, gameDay: true, alexDigest: true };
        const NOTIFY_LABELS = { tradeAlerts: 'Trade alerts', waiverWire: 'Waiver wire moves', gameDay: 'Game day updates', alexDigest: "Alex's weekly digest" };
        const [notifyPrefs, setNotifyPrefs] = React.useState(() => {
            try { return { ...NOTIFY_DEFAULTS, ...(JSON.parse(localStorage.getItem('dhq_notify_prefs_v1') || '{}')) }; }
            catch { return { ...NOTIFY_DEFAULTS }; }
        });
        function toggleNotify(key) {
            setNotifyPrefs(prev => {
                const next = { ...prev, [key]: !prev[key] };
                try { localStorage.setItem('dhq_notify_prefs_v1', JSON.stringify(next)); } catch { /* private mode */ }
                return next;
            });
        }

        // ── Invite friends ───────────────────────────────────────────
        const [inviteMsg, setInviteMsg] = React.useState('');
        async function inviteFriends() {
            const url = 'https://www.dhqfootball.com/landing.html';
            const shareData = { title: 'Dynasty HQ', text: 'Run your dynasty league like a front office — join me on Dynasty HQ.', url };
            try {
                if (navigator.share) { await navigator.share(shareData); return; }
            } catch { return; /* user closed the share sheet */ }
            try {
                await navigator.clipboard.writeText(url);
                setInviteMsg('Link copied — send it to your leaguemates!');
            } catch {
                setInviteMsg(url);
            }
        }

        // ── Delete account (App Store 5.1.1(v) requirement) ──────────
        const [deleteBusy, setDeleteBusy] = React.useState(false);
        async function handleDeleteAccount() {
            if (!confirm('Delete your Dynasty HQ account? This permanently removes your account, subscription link, and saved data. This cannot be undone.')) return;
            if (!confirm('Last check — are you sure? Your account and data will be gone for good.')) return;
            setDeleteBusy(true);
            try {
                await window.OD.deleteAccount();
                try {
                    ['fw_session_v1', 'od_auth_v1', 'od_display_name', 'od_avatar_emoji', 'dhq_notify_prefs_v1'].forEach(k => localStorage.removeItem(k));
                } catch { /* best effort */ }
                window.location.href = 'landing.html?signout=1';
            } catch (err) {
                setDeleteBusy(false);
                alert('Could not delete the account: ' + (err && err.message ? err.message : 'unknown error') + '. Contact support if this keeps happening.');
            }
        }

        function handleDisplayNameSave() {
            if (typeof onDisplayNameSave === 'function') onDisplayNameSave(displayName);
            else localStorage.setItem('od_display_name', displayName);
        }

        async function handleChangePassword() {
            setPwMsg('');
            if (!currentPw || !newPw || !confirmPw) { setPwMsg('x Fill in all fields'); return; }
            if (newPw !== confirmPw) { setPwMsg('x New passwords do not match'); return; }
            if (newPw.length < 6) { setPwMsg('x Password must be at least 6 characters'); return; }
            try {
                // Verify current password against stored hash
                const AUTH_KEY = 'od_auth_v1';
                const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || '{}');
                const encoder = new TextEncoder();
                const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(currentPw));
                const currentHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');

                if (auth.passwordHash && auth.passwordHash !== currentHash) {
                    // Also try Supabase in case this is a gifted account
                    const result = await window.OD.verifySupabasePassword(sleeperUsername, currentPw);
                    if (!result || !result.match) {
                        setPwMsg('x Current password is incorrect');
                        return;
                    }
                }
                // Update Supabase
                await window.OD.updatePassword(sleeperUsername, newPw);
                // Update localStorage
                const newHashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(newPw));
                const newHash = Array.from(new Uint8Array(newHashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
                localStorage.setItem(AUTH_KEY, JSON.stringify({ ...auth, passwordHash: newHash, isGifted: false }));
                setCurrentPw(''); setNewPw(''); setConfirmPw('');
                setPwMsg('ok Password updated');
            } catch (e) {
                setPwMsg('x Failed to update password');
            }
        }

        // Load leaguemate access status when modal opens
        React.useEffect(() => {
            if (!leagueMates || leagueMates.length === 0) return;
            const usernames = leagueMates.map(m => m.username).filter(Boolean);
            window.OD.checkUsersAccess(usernames).then(setMatesAccess).catch(() => setMatesAccess(new Set()));
        }, []);

        async function handleGiftAccess(mate) {
            const username = mate.username;
            if (!username) return;
            setGiftingFor(username);
            try {
                // Generate a random 8-char initial password
                const pw = Array.from(crypto.getRandomValues(new Uint8Array(4)))
                    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
                await window.OD.createGiftUser({
                    sleeperUsername: username,
                    password: pw,
                    displayName: mate.display_name || null,
                });
                const base = window.location.href.replace(/\/[^/]*$/, '/');
                const url = `${base}login.html?for=${encodeURIComponent(username)}`;
                setGiftLinks(prev => ({ ...prev, [username]: { url, password: pw } }));
                setMatesAccess(prev => new Set([...(prev || []), username]));
            } catch (e) {
                console.error('Gift failed:', e);
            }
            setGiftingFor(null);
        }

        const sectionStyle = { marginBottom: 'var(--space-xl)', padding: 'var(--card-pad)', background: 'var(--acc-fill1, rgba(212,175,55,0.07))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius)' };
        const sectionTitle = { fontFamily: 'var(--font-title)', fontSize: 'var(--text-title, 1.125rem)', color: 'var(--gold)', letterSpacing: '0.12em', marginBottom: '0.75rem' };
        const inputStyle = { width: '100%', padding: '0.55rem 0.75rem', background: 'var(--black)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '6px', color: 'var(--white)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', marginBottom: '0.5rem' };
        const btnPrimary = { flex: 1, padding: '0.6rem', minHeight: '44px', background: 'var(--gold)', border: 'none', borderRadius: '6px', color: 'var(--black)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' };
        const btnOutline = { flex: 1, padding: '0.6rem', minHeight: '44px', background: 'transparent', border: '1px solid var(--gold)', borderRadius: '6px', color: 'var(--gold)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' };
        const isModule = mode === 'module';
        // phoneSheet (≤767 via WR.Sheet in SettingsModal): the sheet owns the
        // border/radius/scroll/safe-area chrome, so the content shell goes flat
        // and full-width. Desktop/tablet keep the centered 720px dialog untouched.
        const shellStyle = isModule
            ? { background: 'linear-gradient(135deg, var(--off-black) 0%, var(--charcoal) 100%)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))', borderRadius: '10px', padding: '1.1rem', width: '100%', boxSizing: 'border-box', boxShadow: '0 12px 28px rgba(0,0,0,0.22)' }
            : phoneSheet
                // Bottom pad clears --wr-bottom-inset so the Logout/Close
                // stack stays tappable above the home indicator + dock zone.
                ? { background: 'transparent', padding: '0.25rem 1rem calc(1rem + var(--wr-bottom-inset, 0px))', width: '100%', boxSizing: 'border-box' }
                : { background: 'linear-gradient(135deg, var(--off-black) 0%, var(--charcoal) 100%)', border: '3px solid var(--gold)', borderRadius: '12px', padding: '1.5rem', maxWidth: 'min(720px, calc(100vw - 48px))', width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.8)', maxHeight: '90vh', overflowY: 'auto' };

        if (isModule) {
            const moduleSectionStyle = { ...sectionStyle, marginBottom: '0.7rem', background: 'var(--ov-2, rgba(255,255,255,0.025))' };
            const moduleGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', alignItems: 'start' };
            const moduleColumnStyle = { minWidth: 0 };
            return (
                <div className="wr-settings-module-screen" style={{ width: '100%' }}>
                    {isGiftedAccount && (
                        <div style={{ marginBottom: '12px', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', background: 'var(--acc-fill2, rgba(212,175,55,0.12))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', padding: '0.55rem 0.75rem', borderRadius: '6px' }}>
                            Gifted account - change your password below.
                        </div>
                    )}
                    <div className="wr-settings-module-grid" style={moduleGridStyle}>
                        <div style={moduleColumnStyle}>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>ACCOUNT</div>
                                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '0.5rem' }}>Display name</div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input
                                        style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                                        placeholder={sleeperUsername}
                                        value={displayName}
                                        onChange={e => setDisplayName(e.target.value)}
                                    />
                                    <button onClick={handleDisplayNameSave} style={{ ...btnPrimary, flex: 'none', padding: '0.55rem 0.85rem' }}>Save</button>
                                </div>
                            </div>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>PASSWORD</div>
                                <input style={inputStyle} type="password" placeholder="Current password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
                                <input style={inputStyle} type="password" placeholder="New password" value={newPw} onChange={e => setNewPw(e.target.value)} />
                                <input style={{ ...inputStyle, marginBottom: '0.75rem' }} type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
                                <button onClick={handleChangePassword} style={{ ...btnPrimary, width: '100%', flex: 'none' }}>Update Password</button>
                                {pwMsg && <div style={{ marginTop: '0.5rem', fontSize: 'var(--text-label, 0.75rem)', color: pwMsg.startsWith('ok') ? 'var(--win-green)' : 'var(--k-e74c3c, #e74c3c)' }}>{pwMsg}</div>}
                            </div>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>ACCOUNT ACTIONS</div>
                                <button onClick={handleLogout} style={{ width: '100%', padding: '0.7rem', background: 'rgba(231,76,60,0.18)', border: '1px solid rgba(231,76,60,0.45)', borderRadius: '6px', color: 'var(--k-fca5a5, #fca5a5)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}>
                                    Logout
                                </button>
                            </div>
                        </div>

                        <div style={moduleColumnStyle}>
                            <AlexTab sectionStyle={moduleSectionStyle} sectionTitle={sectionTitle} />
                        </div>

                        <div style={moduleColumnStyle}>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>DISPLAY</div>
                                <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                                    Change the visual style of your dashboard widgets.
                                </div>
                                <div style={_phone ? { display: 'grid', gridTemplateColumns: '1fr', gap: '10px' } : { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    {(window.WrTheme ? window.WrTheme.list() : ['default']).map(themeId => {
                                        const t = window.WrTheme?.themes?.[themeId] || {};
                                        const isActive = (window.WrTheme?.current || 'default') === themeId;
                                        return (
                                            <button key={themeId} onClick={() => {
                                                if (window.WrTheme) window.WrTheme.set(themeId);
                                                setSettingsTab('display');
                                            }} style={{
                                                padding: '16px 14px',
                                                background: isActive ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                                border: isActive ? '2px solid var(--gold)' : '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                                                borderRadius: t.card?.radius || '8px',
                                                cursor: 'pointer',
                                                textAlign: 'center',
                                                transition: '0.15s',
                                            }}>
                                                <div style={{ fontSize: '1.6rem', marginBottom: '6px' }}>{t.preview || '\uD83C\uDFA8'}</div>
                                                <div style={{
                                                    fontFamily: 'var(--font-title)',
                                                    fontSize: 'var(--text-body, 1rem)',
                                                    fontWeight: 700,
                                                    color: isActive ? 'var(--gold)' : 'var(--white)',
                                                    letterSpacing: '0.06em',
                                                }}>{t.name || themeId}</div>
                                                {isActive && (
                                                    <div style={{
                                                        marginTop: '8px',
                                                        fontSize: 'var(--text-label, 0.75rem)',
                                                        fontWeight: 700,
                                                        color: 'var(--gold)',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.08em',
                                                    }}>ACTIVE</div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <CommissionerTab sectionStyle={moduleSectionStyle} sectionTitle={sectionTitle} />
                        </div>

                        <div style={moduleColumnStyle}>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>PLAN</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
                                    <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>Current plan:</span>
                                    <span style={{ fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: tierColor[currentTier] || 'var(--silver)', background: tierBg[currentTier] || 'rgba(192,192,192,0.12)', padding: '0.15rem 0.55rem', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                        {tierLabel[currentTier] || 'Dynasty HQ Free'}
                                    </span>
                                </div>
                                <div style={_phone ? { display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem' } : { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                    <button onClick={goToManagePlan} style={{ ...btnPrimary, fontSize: 'var(--text-label, 0.75rem)' }}>Upgrade</button>
                                    <button onClick={goToManagePlan} style={{ ...btnOutline, fontSize: 'var(--text-label, 0.75rem)' }}>Change Plan</button>
                                    <button onClick={goToManagePlan} style={{ ...btnOutline, fontSize: 'var(--text-label, 0.75rem)' }}>Gift Sub</button>
                                </div>
                            </div>
                            {/* AI KEY section removed (owner ask). */}
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>DATA</div>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <button onClick={() => {
                                        Object.keys(localStorage).filter(k => k.startsWith('dhq_leagueintel_') || k.startsWith('dhq_hist_')).forEach(k => localStorage.removeItem(k));
                                        if (window.App) { window.App.LI = {}; window.App.LI_LOADED = false; }
                                        alert('DHQ cache cleared. Reload to rebuild.');
                                    }} style={{ padding: '6px 12px', minHeight: '44px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '4px', color: 'var(--k-e74c3c, #e74c3c)', cursor: 'pointer' }}>
                                        Clear DHQ Cache
                                    </button>
                                    <button onClick={() => { sessionStorage.clear(); alert('Session cache cleared.'); }}
                                        style={{ padding: '6px 12px', minHeight: '44px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '4px', color: 'var(--silver)', cursor: 'pointer' }}>
                                        Clear Session Cache
                                    </button>
                                </div>
                            </div>
                            {/* ABOUT section removed (owner ask). */}
                        </div>
                    </div>
                </div>
            );
        }

        // Focused account-only panel — used by the hub gear (Alex / theme / commissioner /
        // AI / data stay in the full in-league settings, not here).
        if (accountOnly) {
            const uname = (typeof window !== 'undefined' && window.OD && window.OD.getCurrentUsername && window.OD.getCurrentUsername()) || '';
            const ini = String(displayName || uname || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '★';
            const labelStyle = { fontFamily: 'var(--font-title)', fontSize: 'var(--text-label, 0.8rem)', letterSpacing: '0.1em', color: 'var(--silver)', textTransform: 'uppercase', marginBottom: '8px' };
            return (
                <div className="wr-settings-modal wr-account-modal" style={phoneSheet
                    ? { background: 'transparent', width: '100%', boxSizing: 'border-box', paddingBottom: 'calc(0.5rem + var(--wr-bottom-inset, 0px))' }
                    : { background: 'linear-gradient(135deg, var(--off-black) 0%, var(--charcoal) 100%)', border: '1px solid var(--gold)', borderRadius: '14px', maxWidth: 'min(440px, calc(100vw - 40px))', width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.7)', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '18px 18px 14px', borderBottom: '1px solid var(--acc-line1, rgba(212,175,55,0.18))' }}>
                        <div style={{ width: '44px', height: '44px', borderRadius: '50%', border: '1.5px solid var(--gold)', background: 'var(--black)', color: 'var(--gold)', fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: avatarEmoji ? '1.35rem' : '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{avatarEmoji || ini}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.15rem', letterSpacing: '0.1em', color: 'var(--gold)' }}>ACCOUNT</div>
                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Signed in as {uname || '—'}{isGiftedAccount ? ' · gifted' : ''}</div>
                        </div>
                        <button onClick={onClose} aria-label="Close" style={{ flexShrink: 0, width: phoneSheet ? '44px' : '32px', height: phoneSheet ? '44px' : '32px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', color: 'var(--silver)', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
                    </div>
                    <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                        <div>
                            <div style={labelStyle}>Display name</div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input style={{ ...inputStyle, marginBottom: 0, flex: 1 }} placeholder={uname} value={displayName} onChange={e => setDisplayName(e.target.value)} />
                                <button onClick={handleDisplayNameSave} style={{ ...btnPrimary, flex: 'none', padding: '0.55rem 0.95rem' }}>Save</button>
                            </div>
                        </div>
                        <div>
                            {!showPw ? (
                                <button onClick={() => setShowPw(true)} style={{ ...btnOutline, width: '100%', flex: 'none' }}>Change password</button>
                            ) : (<>
                                <div style={labelStyle}>Change password</div>
                                <input style={inputStyle} type="password" placeholder="Current password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
                                <input style={inputStyle} type="password" placeholder="New password" value={newPw} onChange={e => setNewPw(e.target.value)} />
                                <input style={{ ...inputStyle, marginBottom: '0.75rem' }} type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
                                <button onClick={handleChangePassword} style={{ ...btnPrimary, width: '100%', flex: 'none' }}>Update password</button>
                                {pwMsg && <div style={{ marginTop: '0.5rem', fontSize: 'var(--text-label, 0.75rem)', color: pwMsg.startsWith('ok') ? 'var(--win-green)' : 'var(--k-e74c3c, #e74c3c)' }}>{pwMsg.replace(/^ok /, '').replace(/^x /, '')}</div>}
                            </>)}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 14px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.18))', borderRadius: '10px' }}>
                            <div style={{ minWidth: 0 }}>
                                <div style={labelStyle} >Plan</div>
                                <div style={{ marginTop: '2px', fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: tierColor[currentTier] || 'var(--silver)' }}>{tierLabel[currentTier] || 'Dynasty HQ Free'}</div>
                            </div>
                            <button onClick={manageBilling} disabled={billingBusy} style={{ ...btnOutline, flex: 'none', padding: '0.5rem 0.9rem' }}>{billingBusy ? 'Opening…' : 'Manage'}</button>
                        </div>
                        <div style={{ fontSize: 'var(--text-label, 0.72rem)', color: 'var(--ov-8, rgba(255,255,255,0.3))', marginTop: '-12px' }}>
                            Manage opens your billing portal — change plan, update your card, or cancel anytime. App Store subscriptions are managed in your Apple ID settings.
                        </div>

                        {/* ── Avatar ── */}
                        <div>
                            <div style={labelStyle}>Avatar</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
                                {AVATAR_CHOICES.map(e => (
                                    <button key={e} onClick={() => pickAvatar(e)} aria-label={'Avatar ' + e}
                                        style={{ height: '44px', fontSize: '1.3rem', borderRadius: '10px', cursor: 'pointer',
                                            background: avatarEmoji === e ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : 'var(--ov-1, rgba(255,255,255,0.02))',
                                            border: avatarEmoji === e ? '1.5px solid var(--gold)' : '1px solid var(--acc-line1, rgba(212,175,55,0.18))' }}>{e}</button>
                                ))}
                            </div>
                            <div style={{ marginTop: '6px', fontSize: 'var(--text-label, 0.72rem)', color: 'var(--ov-8, rgba(255,255,255,0.3))' }}>Tap your pick again to go back to initials.</div>
                        </div>

                        {/* ── Notifications ── */}
                        <div>
                            <div style={labelStyle}>Notifications</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {Object.keys(NOTIFY_LABELS).map(key => (
                                    <button key={key} onClick={() => toggleNotify(key)}
                                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 14px', minHeight: '44px', cursor: 'pointer', textAlign: 'left',
                                            background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.18))', borderRadius: '10px',
                                            color: 'var(--white)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 0.95rem)' }}>
                                        <span>{NOTIFY_LABELS[key]}</span>
                                        <span aria-hidden="true" style={{ width: '38px', height: '22px', borderRadius: '11px', position: 'relative', flexShrink: 0, transition: 'background 0.15s',
                                            background: notifyPrefs[key] ? 'var(--gold)' : 'var(--ov-6, rgba(255,255,255,0.1))' }}>
                                            <span style={{ position: 'absolute', top: '2px', left: notifyPrefs[key] ? '18px' : '2px', width: '18px', height: '18px', borderRadius: '50%', background: 'var(--black)', transition: 'left 0.15s' }} />
                                        </span>
                                    </button>
                                ))}
                            </div>
                            <div style={{ marginTop: '6px', fontSize: 'var(--text-label, 0.72rem)', color: 'var(--ov-8, rgba(255,255,255,0.3))' }}>Controls in-app alerts; push notifications arrive with the App Store release.</div>
                        </div>

                        {/* ── Invite friends ── */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 14px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.18))', borderRadius: '10px' }}>
                            <div style={{ minWidth: 0 }}>
                                <div style={labelStyle}>Invite friends</div>
                                <div style={{ marginTop: '2px', fontSize: 'var(--text-label, 0.78rem)', color: 'var(--silver)' }}>{inviteMsg || 'Bring your leaguemates into the War Room.'}</div>
                            </div>
                            <button onClick={inviteFriends} style={{ ...btnOutline, flex: 'none', padding: '0.5rem 0.9rem' }}>Share</button>
                        </div>

                        {/* ── Feedback ── */}
                        {window.WR && window.WR.Feedback && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <button onClick={() => { onClose && onClose(); window.WR.Feedback.reportBug(); }} style={{ ...btnOutline, flex: 'none' }}>Report a bug</button>
                                <button onClick={() => { onClose && onClose(); window.WR.Feedback.openBoard(); }} style={{ ...btnOutline, flex: 'none' }}>Request a feature</button>
                            </div>
                        )}

                        {/* Community / Discord — hidden until the owner sets WR_DISCORD_URL (js/app.js) */}
                        {window.WR_DISCORD_URL && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 14px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.18))', borderRadius: '10px' }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={labelStyle}>Community</div>
                                    <div style={{ marginTop: '2px', fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: 'var(--white)' }}>Dynasty HQ Discord</div>
                                </div>
                                <a href={window.WR_DISCORD_URL} target="_blank" rel="noopener" style={{ ...btnOutline, flex: 'none', padding: '0.5rem 0.9rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Join</a>
                            </div>
                        )}
                        <button onClick={handleLogout} style={{ padding: '0.8rem', background: 'rgba(231,76,60,0.14)', border: '1px solid rgba(231,76,60,0.4)', borderRadius: '10px', color: 'var(--k-fca5a5, #fca5a5)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}>Sign out</button>

                        {/* ── Legal + account deletion (App Store review requirements) ── */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', fontSize: 'var(--text-label, 0.75rem)' }}>
                            <a href="legal/terms-of-service.html" target="_blank" rel="noopener" style={{ color: 'var(--silver)', textDecoration: 'underline' }}>Terms of Service</a>
                            <span style={{ color: 'var(--ov-8, rgba(255,255,255,0.3))' }}>·</span>
                            <a href="legal/privacy-policy.html" target="_blank" rel="noopener" style={{ color: 'var(--silver)', textDecoration: 'underline' }}>Privacy Policy</a>
                            <span style={{ color: 'var(--ov-8, rgba(255,255,255,0.3))' }}>·</span>
                            <button onClick={handleDeleteAccount} disabled={deleteBusy} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--k-e74c3c, #e74c3c)', textDecoration: 'underline', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)' }}>{deleteBusy ? 'Deleting…' : 'Delete account'}</button>
                        </div>
                    </div>
                </div>
            );
        }

        return (
                <div className={isModule ? 'wr-settings-module' : 'wr-settings-modal'} style={shellStyle} onClick={isModule ? undefined : (e) => e.stopPropagation()}>
                    <h2 style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-title)', color: 'var(--gold)', marginBottom: '0.55rem', textAlign: isModule ? 'left' : 'center', letterSpacing: '0.12em' }}>SETTINGS</h2>

                    <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginBottom: '1rem' }}>
                        Logged in as: <strong style={{ color: 'var(--white)' }}>{sleeperUsername}</strong>
                        {isGiftedAccount && <span style={{ marginLeft: '0.5rem', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', background: 'var(--acc-fill3, rgba(212,175,55,0.15))', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>GIFTED — change your password below</span>}
                    </div>

                    {/* Tab bar — phone re-pours the same six sections as P2
                        .wr-seg chips (44px, horizontal scroll); desktop keeps
                        the .wr-module-nav row byte-identical. */}
                    {_phone ? (
                        <div className="wr-seg" style={{ marginBottom: '1rem' }}>
                            {[
                                { id: 'account', label: 'Account' },
                                { id: 'alex', label: 'Alex' },
                                { id: 'display', label: 'Display' },
                                { id: 'commissioner', label: 'Commish' },
                                { id: 'subscription', label: 'Plan' },
                                { id: 'data', label: 'Data' },
                            ].map(tab => (
                                <button key={tab.id} className={settingsTab === tab.id ? 'is-on' : ''} style={{ minHeight: '44px' }} onClick={() => setSettingsTab(tab.id)}>{tab.label}</button>
                            ))}
                        </div>
                    ) : (
                    <div className="wr-module-nav" style={{ marginBottom: '1.25rem' }}>
                        {[
                            { id: 'account', label: 'Account' },
                            { id: 'alex', label: 'Alex' },
                            { id: 'display', label: 'Display' },
                            { id: 'commissioner', label: 'Commish' },
                            { id: 'subscription', label: 'Plan' },
                            { id: 'data', label: 'Data' },
                        ].map(tab => (
                            <button key={tab.id} className={settingsTab === tab.id ? 'is-active' : ''} onClick={() => setSettingsTab(tab.id)}>{tab.label}</button>
                        ))}
                    </div>
                    )}

                    {/* ══ ACCOUNT TAB ══ */}
                    {settingsTab === 'account' && (<>
                    {/* ── DISPLAY NAME ── */}
                    <div style={sectionStyle}>
                        <div style={sectionTitle}>DISPLAY NAME</div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '0.5rem' }}>Custom name (optional)</div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                                style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                                placeholder={sleeperUsername}
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                            />
                            <button onClick={handleDisplayNameSave} style={{ ...btnPrimary, flex: 'none', padding: '0.55rem 0.85rem' }}>Save</button>
                        </div>
                    </div>

                    {/* ── CHANGE PASSWORD ── */}
                    <div style={sectionStyle}>
                        <div style={sectionTitle}>CHANGE PASSWORD</div>
                        <input style={inputStyle} type="password" placeholder="Current password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
                        <input style={inputStyle} type="password" placeholder="New password" value={newPw} onChange={e => setNewPw(e.target.value)} />
                        <input style={{ ...inputStyle, marginBottom: '0.75rem' }} type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
                        <button onClick={handleChangePassword} style={{ ...btnPrimary, width: '100%', flex: 'none' }}>Update Password</button>
                        {pwMsg && <div style={{ marginTop: '0.5rem', fontSize: 'var(--text-label, 0.75rem)', color: pwMsg.startsWith('ok') ? 'var(--win-green)' : 'var(--k-e74c3c, #e74c3c)' }}>{pwMsg}</div>}
                    </div>

                    {/* Phase 10: Leaguemate Access card removed per user feedback (2026-04-18) */}
                    </>)}

                    {/* ══ ALEX TAB — Avatar + GM Briefing replay ══ */}
                    {settingsTab === 'alex' && <AlexTab sectionStyle={sectionStyle} sectionTitle={sectionTitle} />}

                    {/* ══ DISPLAY TAB ══ */}
                    {settingsTab === 'display' && (<>
                        <div style={sectionStyle}>
                            <div style={sectionTitle}>DASHBOARD THEME</div>
                            <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                                Change the visual style of your dashboard widgets.
                            </div>
                            <div style={_phone ? { display: 'grid', gridTemplateColumns: '1fr', gap: '10px' } : { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                {(window.WrTheme ? window.WrTheme.list() : ['default']).map(themeId => {
                                    const t = window.WrTheme?.themes?.[themeId] || {};
                                    const isActive = (window.WrTheme?.current || 'default') === themeId;
                                    return (
                                        <button key={themeId} onClick={() => {
                                            if (window.WrTheme) window.WrTheme.set(themeId);
                                            // Force re-render by updating a dummy state
                                            setSettingsTab('display');
                                        }} style={{
                                            padding: '16px 14px',
                                            background: isActive ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                            border: isActive ? '2px solid var(--gold)' : '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                                            borderRadius: t.card?.radius || '8px',
                                            cursor: 'pointer',
                                            textAlign: 'center',
                                            transition: '0.15s',
                                        }}>
                                            <div style={{ fontSize: '1.6rem', marginBottom: '6px' }}>{t.preview || '🎨'}</div>
                                            <div style={{
                                                fontFamily: 'var(--font-title)',
                                                fontSize: 'var(--text-body, 1rem)',
                                                fontWeight: 700,
                                                color: isActive ? 'var(--gold)' : 'var(--white)',
                                                letterSpacing: '0.06em',
                                            }}>{t.name || themeId}</div>
                                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginTop: '4px' }}>
                                                {themeId === 'default' ? 'Dark mode · gold accent' : themeId === 'light' ? 'Light mode · clean & bright' : 'Custom theme'}
                                            </div>
                                            {isActive && (
                                                <div style={{
                                                    marginTop: '8px',
                                                    fontSize: 'var(--text-label, 0.75rem)',
                                                    fontWeight: 700,
                                                    color: 'var(--gold)',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.08em',
                                                }}>ACTIVE</div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </>)}

                    {/* ══ COMMISSIONER TAB — League Docs ══ */}
                    {settingsTab === 'commissioner' && <CommissionerTab sectionStyle={sectionStyle} sectionTitle={sectionTitle} />}

                    {/* ══ SUBSCRIPTION TAB ══ */}
                    {settingsTab === 'subscription' && (<>
                    <div style={sectionStyle}>
                        <div style={sectionTitle}>CURRENT PLAN</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
                            <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>Current plan:</span>
                            <span style={{ fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: tierColor[currentTier] || 'var(--silver)', background: tierBg[currentTier] || 'rgba(192,192,192,0.12)', padding: '0.15rem 0.55rem', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                {tierLabel[currentTier] || 'Dynasty HQ Free'}
                            </span>
                        </div>
                        <div style={_phone ? { display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem' } : { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            <button onClick={goToManagePlan} style={{ ...btnPrimary, fontSize: 'var(--text-label, 0.75rem)' }}>Upgrade</button>
                            <button onClick={manageBilling} disabled={billingBusy} style={{ ...btnOutline, fontSize: 'var(--text-label, 0.75rem)' }}>{billingBusy ? 'Opening…' : 'Manage / Cancel'}</button>
                            <button onClick={goToManagePlan} style={{ ...btnOutline, fontSize: 'var(--text-label, 0.75rem)' }}>Gift Sub</button>
                        </div>
                        <div style={{ marginTop: '0.6rem', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--ov-8, rgba(255,255,255,0.3))', textAlign: 'center' }}>
                            Manage / Cancel opens your billing portal (web) — App Store subscriptions are managed in your Apple ID settings.
                        </div>
                        <div style={{ marginTop: '0.6rem', display: 'flex', justifyContent: 'center', gap: '14px', fontSize: 'var(--text-label, 0.75rem)' }}>
                            <a href="legal/terms-of-service.html" target="_blank" rel="noopener" style={{ color: 'var(--silver)', textDecoration: 'underline' }}>Terms of Service</a>
                            <a href="legal/privacy-policy.html" target="_blank" rel="noopener" style={{ color: 'var(--silver)', textDecoration: 'underline' }}>Privacy Policy</a>
                        </div>
                    </div>

                    <div style={sectionStyle}>
                        <div style={sectionTitle}>BYO AI KEY</div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.55, marginBottom: '0.75rem' }}>
                            Session-only BYO keys are supported in the AI controls. They are not stored in localStorage and they bypass included query limits only for that session.
                        </div>
                        <button onClick={() => { window.location.href = 'ai-setup.html'; }} style={{ ...btnOutline, width: '100%', flex: 'none', fontSize: 'var(--text-body, 1rem)' }}>Review AI Setup</button>
                    </div>
                    </>)}

                    {/* ══ DATA TAB ══ */}
                    {settingsTab === 'data' && (<>
                    <div style={sectionStyle}>
                        <div style={sectionTitle}>CACHE MANAGEMENT</div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button onClick={() => {
                                Object.keys(localStorage).filter(k => k.startsWith('dhq_leagueintel_') || k.startsWith('dhq_hist_')).forEach(k => localStorage.removeItem(k));
                                if (window.App) { window.App.LI = {}; window.App.LI_LOADED = false; }
                                alert('DHQ cache cleared. Reload to rebuild.');
                            }} style={{ padding: '6px 12px', minHeight: '44px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '4px', color: 'var(--k-e74c3c, #e74c3c)', cursor: 'pointer' }}>
                                Clear DHQ Cache
                            </button>
                            <button onClick={() => { sessionStorage.clear(); alert('Session cache cleared.'); }}
                                style={{ padding: '6px 12px', minHeight: '44px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '4px', color: 'var(--silver)', cursor: 'pointer' }}>
                                Clear Session Cache
                            </button>
                        </div>
                    </div>

                    {/* ── ABOUT ── */}
                    <div style={sectionStyle}>
                        <div style={sectionTitle}>ABOUT</div>
                        <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.65 }}>
                            Dynasty HQ v2.0 &middot; Powered by DHQ Engine
                        </div>
                    </div>
                    </>)}

                    <div style={{ display: 'flex', gap: '0.75rem', flexDirection: 'column', marginTop: '1.5rem' }}>
                        <button onClick={handleLogout} style={{ padding: '0.75rem', background: 'linear-gradient(135deg, var(--k-e74c3c, #e74c3c) 0%, var(--k-c0392b, #c0392b) 100%)', border: 'none', borderRadius: '8px', color: 'white', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}>
                            Logout
                        </button>
                        {!isModule && <button onClick={onClose} style={{ padding: '0.75rem', background: 'var(--black)', border: '2px solid var(--gold)', borderRadius: '8px', color: 'var(--gold)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}>
                            Close
                        </button>}
                    </div>
                </div>
        );
    }

    function SettingsModal(props) {
        // Phone (≤767): the centered dialog becomes a WR.Sheet bottom sheet —
        // keyboard lift, body-scroll lock, safe-area bottom padding, and
        // drag/scrim dismiss come from the primitive (plan D4 "sheet policy").
        // showClose=false + no title: both content variants carry their own
        // headers and close controls (accountOnly header ×, full modal SETTINGS
        // h2 + bottom Close), so the sheet contributes only the grab strip.
        // Sheet renders the `desktop` element unchanged at ≥768, so tablet and
        // desktop are untouched; the availability check is page-constant (no
        // conditional-hook hazard).
        const overlay = (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={props.onClose}>
                <SettingsContent {...props} mode="modal" />
            </div>
        );
        const Sheet = window.WR && window.WR.Sheet;
        if (!Sheet) return overlay;
        return (
            <Sheet open={true} onClose={props.onClose} showClose={false} height="92dvh" desktop={overlay}>
                <SettingsContent {...props} mode="modal" phoneSheet={true} />
            </Sheet>
        );
    }

    function SettingsModule(props) {
        return (
            <div style={{ padding: '10px 16px 16px', maxWidth: '1380px', margin: '0 auto' }}>
                <SettingsContent {...props} mode="module" />
            </div>
        );
    }

    window.SettingsModal = SettingsModal;
    window.SettingsModule = SettingsModule;
