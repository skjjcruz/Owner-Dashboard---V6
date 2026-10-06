// ══════════════════════════════════════════════════════════════════
// js/components/league-wire-styles.js — The Wire's stylesheet
// C2's league-wire.css + league-wire-studio.css (2026-09-27), re-themed onto
// Dynasty HQ tokens. C2 painted a fixed white "newspaper" (--paper:#fff,
// Georgia, red accent, color-scheme:light) with no dark theme. Here the paper
// IS our card surface: every colour resolves through --black / --off-black /
// --white / --silver / --gold / --ov-* / --acc-*, which theme.js flips for
// light mode — so the edition reads gold-on-dark at night and dark-on-warm-
// white in light mode, with no separate palette to drift. Headlines use our
// display face (Rajdhani), copy DM Sans. Corners only via --card-radius-*
// tokens; text never below --text-micro (11px). The one fixed colour is the
// photo-caption scrim (dark in both themes, over images).
// Dropped with C2's ticker: .wr-wire fixed bottom bar + phone launcher.
// Injected once (id wr-wire-styles) when the deferred 'wire' group runs.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const CSS = `
.wr-journal,.wr-wire-studio{--wj-paper:var(--black,#121217);--wj-panel:var(--off-black,#1b1b22);--wj-raised:var(--charcoal,#27262e);--wj-ink:var(--white,#f5f2ea);--wj-muted:var(--silver,#bdb8ad);--wj-faint:var(--text-muted,#8d887e);--wj-rule:var(--ov-5,rgba(255,255,255,.09));--wj-rule-strong:var(--ov-7,rgba(255,255,255,.22));--wj-accent:var(--gold,#d4af37);--wj-accent-fill:var(--acc-fill2,rgba(212,175,55,.12));--wj-accent-line:var(--acc-line2,rgba(212,175,55,.42));--wj-live:var(--good,#2ecc71);--wj-on-accent:var(--page-bg,#08080b);--wj-display:var(--font-title,'Rajdhani',sans-serif);--wj-body:var(--font-body,'DM Sans',sans-serif);--wj-mono:var(--font-mono,'JetBrains Mono',monospace);--wj-scrim:rgba(8,8,11,.84);--wj-scrim-ink:#f5f2ea}
.wr-journal{color:var(--wj-ink);background:var(--wj-paper);border:1px solid var(--acc-line1,rgba(212,175,55,.2));border-radius:var(--card-radius,10px);padding:0;box-sizing:border-box;font:400 var(--text-body,1rem)/1.5 var(--wj-body);text-align:left;min-width:0;max-width:100%}
.wr-journal *{box-sizing:border-box}
.wr-journal :is(button,select){font-family:inherit;font-size:var(--text-label,.75rem);min-height:44px}
.wr-journal button{color:var(--wj-ink);background:var(--wj-panel);border:1px solid var(--wj-rule-strong);padding:7px 12px;border-radius:var(--card-radius-sm,8px);cursor:pointer}
.wr-journal button:hover{border-color:var(--wj-accent-line);background:var(--wj-accent-fill)}
.wr-journal button:disabled{opacity:.55;cursor:default}
.wr-journal :is(button,select,summary,a,input):focus-visible,.wr-journal [tabindex]:focus-visible{outline:2px solid var(--wj-accent);outline-offset:3px}
.wr-journal select{background:var(--wj-panel);color:var(--wj-ink);max-width:100%;width:100%;border:1px solid var(--wj-rule-strong);border-radius:var(--card-radius-sm,8px);padding:8px 28px 8px 10px}
.wr-journal a{color:var(--wj-accent)}
/* Inline edition (the league Wire tab) */
.wr-journal-page{margin:12px 16px 24px;overflow:hidden}
/* Modal editions (all-leagues) */
dialog.wr-journal{position:fixed;inset:0;margin:auto;width:min(1500px,calc(100vw - 32px));max-width:none;height:calc(100dvh - 32px);max-height:calc(100dvh - 32px);overflow:auto;overscroll-behavior:contain;box-shadow:0 24px 100px rgba(0,0,0,.55)}
dialog.wr-journal::backdrop,.wr-wire-studio::backdrop{background:rgba(5,7,12,.72);backdrop-filter:blur(3px)}
/* Masthead bar + section nav */
.wr-journal-bar{display:flex;align-items:center;gap:18px;padding:12px 22px;min-height:62px;background:var(--wj-panel);border-bottom:1px solid var(--wj-rule)}
dialog.wr-journal .wr-journal-bar{position:sticky;top:0;z-index:5}
.wr-journal-bar h2{font:700 2.1rem/.95 var(--wj-display);letter-spacing:-.01em;color:var(--wj-ink);margin:0;white-space:nowrap}
.wr-journal-bar h2 span{color:var(--wj-accent)}
.wr-journal-bar>span{border-left:1px solid var(--wj-rule-strong);padding-left:18px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--wj-muted);font-size:var(--text-label,.75rem);flex:1}
.wr-journal-dot{margin:0 7px;color:var(--wj-faint)}
.wr-journal-bar button{flex-shrink:0}
.wr-journal-bar-actions{display:flex;gap:8px;align-items:center;margin-left:auto}
.wr-journal-bar-actions button{white-space:nowrap}
.wr-journal-nav{display:flex;align-items:center;gap:4px;background:var(--wj-paper);border-bottom:1px solid var(--wj-rule);padding:0 16px;overflow-x:auto;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
.wr-journal .wr-journal-nav button{white-space:nowrap;color:var(--wj-muted);border:0;background:transparent;border-radius:0;min-height:46px;padding:10px 12px;font-size:var(--text-label,.75rem);font-weight:600;letter-spacing:.02em}
.wr-journal .wr-journal-nav button:hover{color:var(--wj-ink);background:transparent}
.wr-journal .wr-journal-nav button[aria-pressed=true]{color:var(--wj-accent);box-shadow:inset 0 -3px var(--wj-accent);font-weight:700}
/* League scoreboard strip */
.wr-journal-scorestrip{display:flex;align-items:stretch;background:var(--wj-panel);border-bottom:1px solid var(--wj-rule);min-height:92px}
.wr-journal-scorestrip-label{flex:0 0 92px;padding:16px 12px;display:flex;flex-direction:column;justify-content:center;border-right:1px solid var(--wj-rule);gap:3px}
.wr-journal-scorestrip-label strong{font:700 var(--text-label,.75rem) var(--wj-mono);color:var(--wj-ink)}
.wr-journal-scorestrip-label>span{font-size:var(--text-micro,.6875rem);color:var(--wj-faint)}
.wr-journal-scores{display:flex;overflow-x:auto;min-width:0;flex:1;scrollbar-width:thin;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
.wr-journal-score-tile{padding:9px 14px;min-width:235px;border-right:1px solid var(--wj-rule);scroll-snap-align:start}
.wr-journal-score-status{display:block;font-size:var(--text-micro,.6875rem);color:var(--wj-faint);margin:0 0 4px;text-transform:uppercase;letter-spacing:.06em}
.wr-journal-score-status.is-current{color:var(--wj-live)}
.wr-journal-score-tile>div{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:7px;margin:4px 0;font-size:var(--text-label,.75rem)}
.wr-journal-score-tile>div>span:not(.wr-journal-team-badge){white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}
.wr-journal-score-tile strong{font:600 var(--text-label,.75rem) var(--wj-mono);font-variant-numeric:tabular-nums}
.wr-journal-team-badge{position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:var(--wj-raised);color:var(--wj-ink);overflow:hidden;flex-shrink:0;border:1px solid var(--wj-rule-strong);font:700 var(--text-micro,.6875rem) var(--wj-body)}
.wr-journal-team-badge img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.wr-journal-score-tile .wr-journal-team-badge{width:22px;height:22px}
/* Paper */
.wr-journal-paper{padding:20px 24px 30px}
.wr-journal-masthead{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:12px}
.wr-journal-masthead h3{font:700 var(--text-hero,2rem)/1.05 var(--wj-display);color:var(--wj-ink);margin:5px 0 0}
.wr-journal-masthead>div>span{font-size:var(--text-micro,.6875rem);letter-spacing:.14em;color:var(--wj-accent);font-weight:700}
.wr-journal-masthead>p{font-size:var(--text-label,.75rem);color:var(--wj-muted);margin:0;white-space:nowrap}
.wr-journal-masthead>p>span{padding:0 6px;color:var(--wj-faint)}
.wr-journal-tools{margin-bottom:22px;border-bottom:1px solid var(--wj-rule);padding-bottom:10px}
.wr-journal-tools>summary{font-size:var(--text-label,.75rem);font-weight:650;cursor:pointer;padding:5px 0;color:var(--wj-ink)}
.wr-journal-tools>summary>span{font-weight:400;color:var(--wj-muted);margin-left:12px}
.wr-journal-filters{display:grid;grid-template-columns:1fr 1fr 1.25fr auto;align-items:end;gap:12px;margin:12px 0 6px}
.wr-journal-filters label{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:var(--text-micro,.6875rem);color:var(--wj-faint);text-transform:uppercase;letter-spacing:.1em}
.wr-journal-filters select{text-transform:none;letter-spacing:normal}
.wr-journal-refresh{white-space:nowrap}
.wr-journal-notice{padding:10px 12px;border-left:2px solid var(--wj-accent);background:var(--wj-panel);color:var(--wj-muted);font-size:var(--text-label,.75rem);line-height:1.55;margin:10px 0 18px;border-radius:0 var(--card-radius-xs,5px) var(--card-radius-xs,5px) 0}
.wr-journal-notice button{margin-left:8px}
.wr-journal-layout{display:grid;grid-template-columns:minmax(0,3fr) minmax(220px,1fr);gap:24px;align-items:start}
.wr-journal-main{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:24px;align-items:start;min-width:0}
.wr-journal-main.is-single{grid-template-columns:1fr}
.wr-journal-rail{min-width:0;padding-left:24px;border-left:1px solid var(--wj-rule)}
.wr-journal-rail>section+section,.wr-journal-rail>details+section{margin-top:26px}
/* Stories */
.wr-journal-story{min-width:0;scroll-margin-top:86px;outline-offset:5px}
.wr-journal-story:focus{outline:2px solid var(--wj-accent)}
.wr-journal-story h3{font:700 1.3rem/1.2 var(--wj-display);color:var(--wj-ink);margin:0 0 9px;text-wrap:balance;overflow-wrap:break-word;hyphens:auto}
.wr-journal-story.is-lead h3{font-size:clamp(1.7rem,2.4vw,2.4rem);line-height:1.08;margin:10px 0}
.wr-journal-kicker{font-size:var(--text-micro,.6875rem);font-weight:700;letter-spacing:.07em;color:var(--wj-accent);margin-bottom:7px}
.wr-journal-byline{font-size:var(--text-micro,.6875rem);color:var(--wj-faint);margin:8px 0 12px}
.wr-journal-byline span{padding:0 4px}
.wr-journal-story p{font-size:var(--text-body,1rem);line-height:1.65;color:var(--wj-muted);margin:12px 0 0}
.wr-journal-story-copy>button{margin-top:12px}
.wr-journal-body{max-width:62ch}
.wr-journal-body p{text-wrap:pretty}
.wr-journal-body p+p{margin-top:.8em}
.wr-journal-grid{display:flex;flex-direction:column;min-width:0;border-left:1px solid var(--wj-rule);padding-left:24px}
.wr-journal-grid>.wr-journal-story{display:grid;grid-template-columns:minmax(0,1fr) 80px;gap:12px;padding:17px 0;border-bottom:1px solid var(--wj-rule)}
.wr-journal-grid>.wr-journal-story:first-child{padding-top:0}
.wr-journal-grid .wr-journal-art{grid-column:2;grid-row:1;align-self:start}
.wr-journal-grid .wr-journal-story-copy{grid-column:1;grid-row:1;min-width:0}
.wr-journal-read>summary{font-size:var(--text-label,.75rem);cursor:pointer;color:var(--wj-muted);padding:10px 0;min-height:44px;list-style:none}
.wr-journal-read>summary::-webkit-details-marker{display:none}
.wr-journal-read>summary span{padding-left:6px;color:var(--wj-accent)}
.wr-journal-read[open]>summary{color:var(--wj-accent);font-weight:700}
.wr-journal-read[open]>.wr-journal-body{margin:4px 0 16px}
.wr-story-dek{color:var(--wj-muted);max-width:62ch}
.wr-journal-story-copy:has(>.wr-journal-read[open])>.wr-story-dek,.wr-all-wire-story:has(>.wr-journal-read[open])>.wr-story-dek{display:none}
.wr-journal-grid .wr-story-dek{font-size:var(--text-body,1rem);line-height:1.6;margin:10px 0 5px}
/* Story art */
.wr-journal-art{position:relative;isolation:isolate;aspect-ratio:16/10;width:100%;margin:0 0 17px;overflow:hidden;color:var(--wj-ink);border-radius:var(--card-radius-sm,8px);border:1px solid var(--wj-rule);background:radial-gradient(circle at 20% 15%,var(--acc-fill3,rgba(212,175,55,.16)),transparent 55%),linear-gradient(135deg,var(--wj-panel),var(--wj-raised))}
.wr-journal-art::before{content:'';position:absolute;inset:0;z-index:-1;background:repeating-linear-gradient(100deg,transparent 0,transparent 18%,var(--ov-2,rgba(255,255,255,.035)) 18%,var(--ov-2,rgba(255,255,255,.035)) 18.4%)}
.wr-journal-art-label{position:absolute;z-index:2;top:12px;left:12px;font:700 var(--text-micro,.6875rem) var(--wj-body);text-transform:uppercase;letter-spacing:.07em;background:var(--wj-accent);color:var(--wj-on-accent);padding:5px 8px;border-radius:var(--card-radius-xs,5px)}
.wr-journal-art-teams{position:absolute;inset:42px 14px 50px;display:flex;align-items:center;justify-content:center;gap:14px}
.wr-journal-art-teams>div{display:flex;flex:1;min-width:0;flex-direction:column;align-items:center;gap:9px;text-align:center}
.wr-journal-art-teams>div>.wr-journal-team-badge{width:clamp(54px,6.5vw,105px);height:clamp(54px,6.5vw,105px);border:2px solid var(--wj-accent-line);box-shadow:0 7px 24px rgba(0,0,0,.25);font-size:1.4rem}
.wr-journal-art-teams>div>span:last-child:not(.wr-journal-team-badge){font-size:var(--text-label,.75rem);line-height:1.3;font-weight:650;color:var(--wj-ink);max-width:170px;overflow-wrap:anywhere}
.wr-journal-versus{font:700 var(--text-label,.75rem) var(--wj-display);letter-spacing:.1em;color:var(--wj-accent);flex-shrink:0}
.wr-journal-art figcaption{position:absolute;bottom:0;left:0;right:0;display:flex;align-items:center;gap:12px;min-height:45px;padding:8px 13px;background:var(--wj-scrim);font-size:var(--text-label,.75rem);color:var(--wj-scrim-ink)}
.wr-journal-art figcaption>strong{font:700 1.5rem var(--wj-display);flex-shrink:0;color:var(--wj-scrim-ink)}
.wr-journal-art figcaption>span{font-size:var(--text-micro,.6875rem);line-height:1.35}
.wr-journal-art.has-player{background:linear-gradient(120deg,var(--wj-raised),var(--wj-panel))}
.wr-journal-player-photo{position:absolute;inset:0;height:100%;width:100%;object-fit:contain;object-position:center 28%;z-index:1}
.wr-journal-art.has-player figcaption{z-index:2}
.wr-journal-art-monogram{font:700 5rem var(--wj-display);position:absolute;inset:0;display:grid;place-items:center;opacity:.35;color:var(--wj-accent)}
.wr-journal-art.has-player .wr-journal-art-monogram{visibility:hidden}
.wr-journal-art.has-player.is-image-missing .wr-journal-art-monogram{visibility:visible}
.wr-journal-grid .wr-journal-art{aspect-ratio:1/1.1;margin:0}
.wr-journal-grid .wr-journal-art-teams{inset:6px;gap:3px;flex-wrap:wrap}
.wr-journal-grid .wr-journal-art-teams>div>.wr-journal-team-badge{width:31px;height:31px;font-size:var(--text-micro,.6875rem);border-width:1px}
.wr-journal-grid .wr-journal-versus{font-size:var(--text-micro,.6875rem);position:absolute;bottom:3px}
.wr-journal-grid .wr-journal-art-monogram{font-size:2rem}
.wr-journal-art.is-history{display:flex;align-items:center;justify-content:center}
.wr-journal-art.is-history>strong{font:700 clamp(28px,5vw,76px) var(--wj-display);color:var(--wj-accent)}
.wr-journal-story:not(.is-lead) .wr-journal-art.is-history>strong{font-size:1.6rem}
.wr-journal-story.is-lead>.wr-journal-art{max-height:200px}
/* Wide screens: the lead runs across the full width (picture beside the
   headline) and the stories fill two even columns beneath it — a short lead
   can no longer leave an empty box beside a long story column (owner report
   2026-10-06). Narrow screens keep the single stacked column. */
@media(min-width:1101px){.wr-journal-main{grid-template-columns:minmax(0,1fr)}.wr-journal-story.is-lead{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:28px;align-items:start}.wr-journal-story.is-lead>.wr-journal-art{max-height:none;height:100%;min-height:230px;margin:0}.wr-journal-main>.wr-journal-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:28px;align-items:start;border-left:0;padding-left:0;margin-top:24px;border-top:1px solid var(--wj-rule)}.wr-journal-main>.wr-journal-grid>.wr-journal-story:nth-child(-n+2){padding-top:17px}}
.wr-journal-story.is-lead .wr-journal-art-teams{inset:38px 14px 50px}
.wr-journal-story.is-lead .wr-journal-art-teams>div{gap:6px}
.wr-journal-story.is-lead .wr-journal-art-teams>div>.wr-journal-team-badge{width:clamp(44px,5vw,76px);height:clamp(44px,5vw,76px)}
.wr-journal-story.is-lead .wr-journal-art-teams>div>span:last-child:not(.wr-journal-team-badge){max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* Rail */
.wr-journal-headlines h3{font:700 var(--text-title,1.125rem) var(--wj-display);text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px;color:var(--wj-ink)}
.wr-journal-headlines ul{list-style:square;margin:0;padding-left:17px}
.wr-journal-headlines li{padding:0 0 12px 1px}
.wr-journal-headlines li::marker{color:var(--wj-accent)}
.wr-journal .wr-journal-headlines button{display:block;width:100%;font:400 var(--text-body,1rem)/1.45 var(--wj-body);padding:0;border:0;text-align:left;min-height:0;background:none;color:var(--wj-ink);border-radius:0}
.wr-journal .wr-journal-headlines button:hover{background:none;text-decoration:underline;text-underline-offset:3px;color:var(--wj-accent)}
.wr-journal-rail-section{border-top:2px solid var(--wj-accent-line);margin:22px 0;padding-top:10px}
.wr-journal-rail-section>summary{font:700 var(--text-title,1.125rem) var(--wj-display);cursor:pointer;padding:8px 0;min-height:44px;color:var(--wj-ink)}
.wr-journal-rail-section>summary>span{display:block;font:400 var(--text-micro,.6875rem) var(--wj-body);color:var(--wj-faint);margin:4px 0 0 16px;text-transform:uppercase;letter-spacing:.08em}
.wr-journal-scoreline{background:var(--wj-panel);border:1px solid var(--wj-rule);border-radius:var(--card-radius-sm,8px);padding:9px 12px;margin:14px 0}
.wr-journal-scoreline>div{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:8px;margin:7px 0}
.wr-journal-scoreline .wr-journal-team-badge{width:24px;height:24px}
.wr-journal-scoreline>div>span:not(.wr-journal-team-badge){font-size:var(--text-label,.75rem);color:var(--wj-muted)}
.wr-journal-scoreline strong{font:700 1rem var(--wj-mono);font-variant-numeric:tabular-nums}
.wr-journal-context{margin-top:13px;border-top:1px solid var(--wj-rule);padding-top:8px}
.wr-journal-context summary{font-size:var(--text-label,.75rem);color:var(--wj-accent);cursor:pointer;padding:10px 0;min-height:44px}
.wr-journal-context>div{margin-top:12px}
.wr-journal-context>div>strong{font-size:var(--text-micro,.6875rem);text-transform:uppercase;letter-spacing:.07em;color:var(--wj-ink)}
.wr-journal .wr-journal-context p{font-size:var(--text-label,.75rem);margin-top:5px}
.wr-journal-context li{font-size:var(--text-label,.75rem);line-height:1.6;overflow-wrap:anywhere}
.wr-journal-context a{color:var(--wj-accent);text-decoration:underline}
.wr-journal-record{padding:13px 0;border-bottom:1px solid var(--wj-rule);overflow-wrap:anywhere}
.wr-journal-record>span{font-size:var(--text-label,.75rem);color:var(--wj-muted);font-weight:650}
.wr-journal-record>strong{display:block;font:700 2rem/1.15 var(--wj-mono);color:var(--wj-accent);margin:5px 0}
.wr-journal-record>small{font-size:var(--text-micro,.6875rem);color:var(--wj-faint)}
.wr-journal-record p{font-size:var(--text-label,.75rem);line-height:1.5;margin:9px 0 0;color:var(--wj-ink)}
.wr-journal-record p small{display:block;font-size:var(--text-micro,.6875rem);color:var(--wj-faint)}
.wr-journal-record details{font-size:var(--text-micro,.6875rem);margin-top:7px}
.wr-journal-record summary{cursor:pointer;min-height:44px;padding:12px 0}
.wr-journal-rival{padding:13px 0;border-bottom:1px solid var(--wj-rule)}
.wr-journal-rival>strong{font-size:var(--text-label,.75rem);font-weight:600}
.wr-journal-rival>strong span{color:var(--wj-faint)}
.wr-journal-rival>div{font:700 1.6rem var(--wj-mono);margin:6px 0;color:var(--wj-accent)}
.wr-journal-rival>div>span{padding:0 10px;color:var(--wj-faint)}
.wr-journal-rival small{font:400 var(--text-micro,.6875rem) var(--wj-body);color:var(--wj-faint)}
.wr-journal-rival p,.wr-journal-footnote{font-size:var(--text-micro,.6875rem);color:var(--wj-faint);line-height:1.6;margin:7px 0 0}
.wr-journal-table{padding:0;margin:10px 0;list-style:none}
.wr-journal-table li{display:grid;grid-template-columns:22px 1fr auto;gap:7px;padding:8px 0;border-bottom:1px solid var(--wj-rule);font-size:var(--text-label,.75rem);align-items:baseline}
.wr-journal-table li>span:first-child{color:var(--wj-accent);font-family:var(--wj-mono)}
.wr-journal-table strong{font-weight:500;overflow-wrap:anywhere}
.wr-journal-table li>span:last-child{white-space:nowrap;color:var(--wj-muted);font:500 var(--text-label,.75rem) var(--wj-mono);font-variant-numeric:tabular-nums}
.wr-journal-history{list-style:none;padding:0;margin:16px 0}
.wr-journal-history li{padding:12px 0;border-bottom:1px solid var(--wj-rule)}
.wr-journal-history strong{font:700 var(--text-body,1rem) var(--wj-display);color:var(--wj-ink)}
.wr-journal-history p{font-size:var(--text-label,.75rem);line-height:1.5;color:var(--wj-muted);margin:5px 0 0}
.wr-journal-empty{padding:24px 0;border-top:2px solid var(--wj-accent-line);grid-column:1/-1}
.wr-journal-empty>span{font-size:var(--text-micro,.6875rem);letter-spacing:.1em;color:var(--wj-accent);font-weight:700}
.wr-journal-empty h3{font:700 1.9rem/1.15 var(--wj-display);margin:14px 0;color:var(--wj-ink)}
.wr-journal-empty p{font-size:var(--text-body,1rem);line-height:1.7;color:var(--wj-muted);max-width:50ch}
.wr-journal-live{grid-column:1/-1;background:var(--wj-panel);padding:15px;margin-top:15px;border-top:2px solid var(--wj-accent-line);border-radius:0 0 var(--card-radius-sm,8px) var(--card-radius-sm,8px)}
.wr-journal-live summary{cursor:pointer;font-size:var(--text-body,1rem);font-weight:700;padding:8px 0;min-height:44px}
.wr-journal-live ul{list-style:none;padding:0;margin:12px 0 0}
.wr-journal-live li{border-top:1px solid var(--wj-rule);padding:10px 0;font-size:var(--text-label,.75rem);line-height:1.5}
.wr-journal .wr-wire-tag{font-size:var(--text-micro,.6875rem);letter-spacing:.06em;font-weight:700;color:var(--wj-accent);margin-right:10px}
.wr-journal .wr-wire-tag.is-live{color:var(--wj-live)}
.wr-journal-live .wr-wire-tag{display:block;margin-bottom:4px}
.wr-journal-live button{display:block;margin-top:6px}
.wr-journal-more{grid-column:1/-1;display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:15px 0;border-top:1px solid var(--wj-rule);font-size:var(--text-label,.75rem);color:var(--wj-muted)}
.wr-journal-more>span{flex:1;min-width:160px}
.wr-journal-footer{border-top:2px solid var(--wj-accent-line);margin-top:30px;padding-top:16px;color:var(--wj-faint);font-size:var(--text-label,.75rem);line-height:1.7}
.wr-journal-footer>strong{letter-spacing:.09em;color:var(--wj-accent);font-family:var(--wj-display);font-size:var(--text-body,1rem)}
.wr-journal-footer details{margin-top:10px}
.wr-journal-footer summary{cursor:pointer;min-height:44px;padding:10px 0;color:var(--wj-muted)}
.wr-journal-footer p{max-width:100ch}
.wr-journal-footer p button{margin:4px 0}
/* Reader tools */
.wr-wire-edition-strip{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-block:1px solid var(--wj-rule);margin:12px 0;flex-wrap:wrap}
.wr-wire-edition-strip>div{flex:1 1 220px;min-width:0}
.wr-wire-edition-strip p{font-size:var(--text-label,.75rem);line-height:1.6;margin:0 0 4px;font-weight:600;color:var(--wj-ink)}
.wr-wire-edition-strip small{color:var(--wj-faint);font-size:var(--text-micro,.6875rem)}
.wr-wire-edition-strip button{min-height:44px;flex-shrink:0}
.wr-wire-reader-tools{display:grid;grid-template-columns:minmax(200px,1fr) auto;align-items:end;gap:16px;margin:14px 0}
.wr-wire-search{display:flex;align-items:end;gap:12px;margin:0}
.wr-wire-search label{display:flex;flex-direction:column;gap:6px;flex:1;max-width:540px;font-size:var(--text-label,.75rem);color:var(--wj-muted)}
.wr-wire-search input{min-width:0;width:100%;background:var(--wj-panel);color:var(--wj-ink);border:1px solid var(--wj-rule-strong);border-radius:var(--card-radius-sm,8px);min-height:44px;padding:10px 12px;font:inherit;font-size:16px}
.wr-wire-search button{min-height:44px}
.wr-wire-reader-tools .wr-journal-tools{margin:0;padding:0;border:0}
.wr-wire-reader-tools .wr-journal-tools>summary{min-height:44px;padding:12px 0}
.wr-wire-reader-tools .wr-journal-tools>summary>span{display:none}
.wr-wire-reader-tools .wr-journal-tools[open]{grid-column:1/-1}
.wr-wire-coverage-note{font-size:var(--text-label,.75rem);line-height:1.5;color:var(--wj-muted);margin:10px 0}
.wr-journal .wr-wire-coverage-note button{margin-left:8px;border:0;background:none;text-decoration:underline;color:var(--wj-accent);padding:4px}
.wr-wire-lookback{grid-column:1/-1;border-top:2px solid var(--wj-rule-strong);padding-top:18px;margin-top:24px;min-width:0}
.wr-wire-lookback>header{margin-bottom:18px}
.wr-wire-lookback>header>span{font-size:var(--text-micro,.6875rem);font-weight:700;letter-spacing:.08em;color:var(--wj-accent)}
.wr-wire-lookback>header h3{font:700 var(--text-title,1.125rem) var(--wj-display);margin:6px 0}
.wr-wire-lookback>header p{font-size:var(--text-label,.75rem);line-height:1.5;color:var(--wj-muted)}
.wr-wire-lookback>.wr-journal-story{display:grid;grid-template-columns:80px minmax(0,1fr);gap:16px}
.wr-wire-lookback .wr-journal-art{aspect-ratio:1;margin:0}
.wr-wire-lookback .wr-journal-story-copy{min-width:0}
.wr-wire-portfolio .wr-wire-lookback{max-width:72ch}
.wr-wire-sr-only{position:absolute!important;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
/* Rivalry editor */
.wr-wire-rivalry-editor{border-block:1px solid var(--wj-rule);padding:24px 0;margin:0 0 28px;max-width:900px}
.wr-wire-rivalry-editor h3{font:700 1.5rem var(--wj-display);margin:0 0 8px}
.wr-wire-rivalry-editor p{font-size:var(--text-body,1rem);line-height:1.6;margin:8px 0 16px;color:var(--wj-muted)}
.wr-wire-rivalry-editor ul{list-style:none;padding:0;margin:18px 0}
.wr-wire-rivalry-editor li{display:flex;justify-content:space-between;align-items:center;gap:16px;border-top:1px solid var(--wj-rule);padding:14px 0}
.wr-wire-rivalry-editor li strong,.wr-wire-rivalry-editor li span,.wr-wire-rivalry-editor li small{display:block}
.wr-wire-rivalry-editor li small{margin-top:6px;color:var(--wj-faint)}
.wr-wire-rivalry-editor form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.wr-wire-rivalry-editor label,.wr-all-wire-rivalries>label{display:flex;flex-direction:column;gap:7px;font-size:var(--text-label,.75rem);color:var(--wj-muted)}
.wr-wire-rivalry-editor label span{color:var(--wj-faint)}
.wr-wire-rivalry-editor input,.wr-wire-rivalry-editor select,.wr-all-wire-rivalries select{min-width:0;width:100%;min-height:44px;background:var(--wj-panel);color:var(--wj-ink);border:1px solid var(--wj-rule-strong);border-radius:var(--card-radius-sm,8px);padding:10px;font:inherit;font-size:16px}
.wr-wire-rivalry-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.wr-wire-rivalry-actions button{min-height:44px;padding:9px 14px}
.wr-wire-rivalry-editor [role=alert]{color:var(--bad,#e74c3c)}
.wr-wire-rivalry-editor [role=status]{color:var(--wj-live)}
.wr-all-wire-rivalries{margin-bottom:24px}
.wr-all-wire-rivalries>label{max-width:400px;margin-bottom:16px}
.wr-wire-rivalry-links{margin:0 0 24px}
.wr-wire-rivalry-links ul{list-style:none;margin:0;padding:0}
.wr-wire-rivalry-links li{border-bottom:1px solid var(--wj-rule);padding:10px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
/* All-leagues edition */
.wr-all-wire-controls{display:flex;align-items:end;gap:12px;margin-bottom:20px;flex-wrap:wrap}
.wr-all-wire-controls label{display:grid;gap:6px;font-size:var(--text-label,.75rem);text-transform:uppercase;letter-spacing:.08em;color:var(--wj-muted)}
.wr-all-wire-controls select{max-width:400px;font-size:16px;min-height:44px}
.wr-all-wire-controls button,.wr-all-wire-story>button,.wr-all-wire-more,.wr-all-wire-progress button{min-height:44px}
.wr-all-wire-progress{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:28px}
.wr-all-wire-progress details{flex:1;min-width:180px;border-top:2px solid var(--wj-accent-line);padding:12px 0;color:var(--wj-muted);font-size:var(--text-label,.75rem)}
.wr-all-wire-progress summary{cursor:pointer;font-weight:700;color:var(--wj-ink);min-height:44px}
.wr-all-wire-progress summary span{display:block;font-weight:400;margin-top:5px;color:var(--wj-faint)}
.wr-all-wire-progress button{margin:4px 8px 0 0}
.wr-all-wire-stories{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px}
.wr-all-wire-story{min-width:0;padding-bottom:24px;border-bottom:1px solid var(--wj-rule)}
.wr-all-wire-story.is-lead{grid-column:span 2}
.wr-all-wire-story h3{font:700 1.6rem/1.12 var(--wj-display);margin:10px 0 15px;color:var(--wj-ink);text-wrap:balance;overflow-wrap:break-word;hyphens:auto}
.wr-all-wire-story.is-lead h3{font-size:2.25rem}
.wr-all-wire-story p{font-size:var(--text-body,1rem);line-height:1.65;color:var(--wj-muted)}
.wr-all-wire-story .wr-all-wire-label{font-size:var(--text-micro,.6875rem);line-height:1.4;color:var(--wj-accent);letter-spacing:.06em;font-weight:700}
.wr-all-wire-story>button{margin-top:12px;text-align:left}
.wr-all-wire-story .wr-journal-read{margin-top:8px}
.wr-all-wire-story .wr-journal-read>summary{color:var(--wj-accent)}
.wr-all-wire-more{margin:20px 0}
.wr-all-wire-coverage{border-bottom:1px solid var(--wj-rule);margin-bottom:24px;padding-bottom:12px}
.wr-all-wire-coverage>summary{cursor:pointer;font-size:var(--text-label,.75rem);min-height:44px;display:list-item;padding:12px 0}
.wr-all-wire-coverage[open]>.wr-all-wire-controls{margin-top:14px}
.wr-wire-reader-tools .wr-all-wire-coverage{margin:0;padding:0;border:0}
.wr-wire-reader-tools .wr-all-wire-coverage[open]{grid-column:1/-1}
.wr-wire-portfolio .wr-wire-reader-tools{margin-bottom:28px}
.wr-wire-portfolio .wr-journal-footer p{max-width:80ch}
.wr-wire-briefing{border-block:1px solid var(--wj-rule);margin:14px 0 0;padding:12px 0}
.wr-wire-briefing>header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.wr-wire-briefing>header strong{display:block;font-size:var(--text-label,.75rem);line-height:1.5}
.wr-wire-briefing>header small{display:block;margin-top:4px;font-size:var(--text-micro,.6875rem);color:var(--wj-faint)}
.wr-wire-briefing button{min-height:44px;flex-shrink:0}
.wr-wire-briefing .wr-wire-briefing-warning{color:var(--warn,#f0a500);font-size:var(--text-label,.75rem)}
/* NFL desk */
.wr-nfl-heading{border-bottom:2px solid var(--wj-accent-line);padding-bottom:18px;margin-bottom:24px}
.wr-nfl-heading>span{font-size:var(--text-micro,.6875rem);letter-spacing:.12em;font-weight:700;color:var(--wj-accent)}
.wr-nfl-heading h3{font:700 clamp(1.8rem,3vw,2.6rem)/1.1 var(--wj-display);margin:8px 0}
.wr-nfl-heading p,.wr-nfl-week>p{color:var(--wj-muted);font-size:var(--text-body,1rem);line-height:1.6}
.wr-nfl-week{margin-bottom:32px;min-width:0;scroll-margin-top:100px;outline-offset:4px}
.wr-nfl-week>header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--wj-rule);padding-bottom:10px;margin-bottom:16px}
.wr-nfl-week>header h3{font:700 var(--text-title,1.125rem) var(--wj-display);margin:0;text-transform:uppercase;letter-spacing:.04em}
.wr-nfl-week>header>span{font-size:var(--text-label,.75rem);color:var(--wj-faint)}
.wr-nfl-games{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start}
.wr-nfl-game{min-width:0;border:1px solid var(--wj-rule);border-radius:var(--card-radius-sm,8px);padding:16px;background:var(--wj-panel)}
.wr-nfl-game.is-live{border-top:3px solid var(--wj-live)}
.wr-nfl-status{font-size:var(--text-label,.75rem);line-height:1.5;font-weight:700;color:var(--wj-accent);margin-bottom:12px}
.wr-nfl-game.is-live .wr-nfl-status{color:var(--wj-live)}
.wr-nfl-teams>div{display:flex;align-items:baseline;justify-content:space-between;gap:16px;font-size:var(--text-body,1rem);line-height:1.4;margin:7px 0}
.wr-nfl-teams>div>span{overflow-wrap:anywhere}
.wr-nfl-teams strong{font:600 1.35rem var(--wj-mono);font-variant-numeric:tabular-nums}
.wr-nfl-teams .is-winner>span{font-weight:750;color:var(--wj-ink)}
.wr-nfl-recap,.wr-nfl-broadcast{font-size:var(--text-label,.75rem);line-height:1.55;color:var(--wj-muted);margin:12px 0 0}
.wr-nfl-box{margin-top:14px;border-top:1px solid var(--wj-rule)}
.wr-nfl-box summary{cursor:pointer;padding:12px 0;font-size:var(--text-label,.75rem);color:var(--wj-accent);font-weight:650;min-height:44px}
.wr-nfl-box summary span{float:right}
.wr-nfl-box p,.wr-nfl-box>a{font-size:var(--text-label,.75rem);line-height:1.55}
.wr-nfl-box>a{display:inline-block;color:var(--wj-accent);padding:12px 0;text-underline-offset:3px}
.wr-nfl-table-scroll{overflow-x:auto;max-width:100%;outline-offset:3px}
.wr-nfl-box table{border-collapse:collapse;width:100%;font:500 var(--text-label,.75rem) var(--wj-mono);font-variant-numeric:tabular-nums;text-align:right}
.wr-nfl-box caption{text-align:left;color:var(--wj-faint);padding:0 0 8px;font:400 var(--text-label,.75rem) var(--wj-body)}
.wr-nfl-box th,.wr-nfl-box td{padding:8px 6px;border-bottom:1px solid var(--wj-rule);white-space:nowrap}
.wr-nfl-box th:first-child{text-align:left}
.wr-nfl-box h5{font-size:var(--text-label,.75rem);text-transform:uppercase;letter-spacing:.06em;margin:18px 0 8px}
.wr-nfl-leaders{list-style:none;margin:0;padding:0}
.wr-nfl-leaders li{display:grid;gap:4px;padding:10px 0;border-bottom:1px solid var(--wj-rule)}
.wr-nfl-leaders span{font-size:var(--text-micro,.6875rem);color:var(--wj-faint);letter-spacing:.05em}
.wr-nfl-leaders strong{font-size:var(--text-label,.75rem)}
.wr-nfl-leaders small{font-size:var(--text-label,.75rem);color:var(--wj-muted)}
.wr-nfl-credit{font-size:var(--text-label,.75rem);line-height:1.6;color:var(--wj-faint)}
.wr-nfl-notice{border-left:2px solid var(--wj-accent);padding-left:12px;font-size:var(--text-label,.75rem);color:var(--wj-muted)}
.wr-nfl-game-title{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.wr-nfl-jump{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 24px}
.wr-nfl-jump button{min-height:44px}
.wr-nfl-source{display:inline-flex;align-items:center;gap:6px;font-size:var(--text-micro,.6875rem);color:var(--wj-faint);margin:0 0 16px}
.wr-nfl-source::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--wj-faint)}
.wr-nfl-source.is-fresh::before{background:var(--wj-live)}
/* Wire Studio (graphics dialog) */
.wr-journal .wr-wire-studio-link{color:var(--wj-accent);background:transparent;border:0;border-bottom:1px solid currentColor;border-radius:0;padding:7px 0;min-height:44px;font:600 var(--text-label,.75rem) var(--wj-body);text-align:left}
.wr-journal .wr-wire-studio-link:hover{background:transparent}
.wr-wire-studio{position:fixed;inset:0;margin:auto;padding:0;width:min(1000px,calc(100vw - 32px));max-width:none;height:min(850px,calc(100dvh - 32px));max-height:calc(100dvh - 32px);border:1px solid var(--wj-accent-line);border-radius:var(--card-radius,10px);background:var(--wj-paper);color:var(--wj-ink);font:400 var(--text-body,1rem)/1.5 var(--wj-body);overflow:auto;overscroll-behavior:contain;box-shadow:0 24px 100px rgba(0,0,0,.55);text-align:left}
.wr-wire-studio *{box-sizing:border-box}
.wr-wire-studio [hidden]{display:none!important}
.wr-wire-studio :is(button,select){font:inherit;font-size:var(--text-label,.75rem);color:inherit;min-height:44px;border:1px solid var(--wj-rule-strong);border-radius:var(--card-radius-sm,8px);background:var(--wj-panel);padding:9px 12px}
.wr-wire-studio button{cursor:pointer}
.wr-wire-studio button:hover{background:var(--wj-accent-fill)}
.wr-wire-studio button:disabled{opacity:.55;cursor:default}
.wr-wire-studio :is(button,select,a,summary):focus-visible,.wr-wire-studio [tabindex]:focus-visible{outline:3px solid var(--wj-accent);outline-offset:3px}
.wr-wire-studio select{max-width:100%;min-width:0;width:100%;font-size:16px}
.wr-wire-studio label{display:flex;flex-direction:column;gap:6px;font-size:var(--text-label,.75rem);color:var(--wj-muted);min-width:0}
.wr-wire-studio p{margin:10px 0}
.wr-wire-studio h3{font:700 clamp(1.6rem,4vw,2.75rem)/1.05 var(--wj-display);margin:0 0 24px;overflow-wrap:anywhere}
.wr-wire-studio h4{font-size:var(--text-body,1rem);line-height:1.4;margin:0 0 7px}
.wr-wire-studio small{color:var(--wj-muted);font-size:var(--text-label,.75rem);line-height:1.55}
.wr-studio-mast{position:sticky;top:0;z-index:3;background:var(--wj-panel);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 22px;border-bottom:1px solid var(--wj-rule)}
.wr-studio-mast>div{min-width:0}
.wr-studio-mast h2{font:700 1.75rem/1 var(--wj-display);margin:0}
.wr-studio-mast h2>span{color:var(--wj-accent)}
.wr-studio-mast h2>small{font:650 var(--text-micro,.6875rem) var(--wj-body);letter-spacing:2px;text-transform:uppercase;border-left:1px solid var(--wj-rule-strong);padding-left:12px;margin-left:10px}
.wr-studio-mast p{font-size:var(--text-micro,.6875rem);color:var(--wj-faint);margin:6px 0 0;overflow-wrap:anywhere}
.wr-studio-mast>button{flex-shrink:0}
.wr-studio-tabs{display:flex;gap:20px;padding:0 22px;border-bottom:1px solid var(--wj-rule);overflow-x:auto;scrollbar-width:thin}
.wr-wire-studio .wr-studio-tabs>button{flex-shrink:0;border:0;border-radius:0;border-bottom:3px solid transparent;background:transparent;font-weight:650;padding:12px 0;min-height:49px;color:var(--wj-muted)}
.wr-wire-studio .wr-studio-tabs>button[aria-selected=true]{border-bottom-color:var(--wj-accent);color:var(--wj-accent)}
.wr-studio-panel{padding:24px 26px;outline-offset:-4px;min-width:0}
.wr-studio-editions{display:flex;align-items:end;gap:14px;margin:0 0 25px}
.wr-studio-editions>label{flex:1;max-width:480px}
.wr-studio-editions>button{flex-shrink:0}
.wr-studio-eyebrow{color:var(--wj-faint);font-size:var(--text-micro,.6875rem);line-height:1.6;letter-spacing:1.3px;text-transform:uppercase;margin:0 0 12px}
.wr-studio-select{max-width:500px;margin:0 0 22px}
.wr-studio-notice{background:var(--wj-panel);border-left:3px solid var(--wj-accent);padding:12px 15px;font-size:var(--text-label,.75rem);line-height:1.65;margin:15px 0;border-radius:0 var(--card-radius-xs,5px) var(--card-radius-xs,5px) 0}
.wr-studio-notice p{margin:0 0 9px}
.wr-studio-scope{font-size:var(--text-label,.75rem);color:var(--wj-muted);line-height:1.6}
.wr-studio-versus{display:grid;grid-template-columns:minmax(0,1fr) 130px minmax(0,1fr);gap:16px;align-items:center;border-block:1px solid var(--wj-rule);padding:24px 0}
.wr-studio-person{min-width:0}
.wr-studio-person:last-child{text-align:right}
.wr-studio-person>strong{font:700 clamp(1.25rem,3vw,2rem)/1.1 var(--wj-display);display:block;overflow-wrap:anywhere}
.wr-studio-identity{display:block;width:44px;height:4px;background:var(--wj-accent);margin-bottom:13px}
.wr-studio-person:last-child .wr-studio-identity{margin-left:auto;background:var(--info,#5dade2)}
.wr-studio-series{text-align:center;min-width:0}
.wr-studio-series>strong{font:700 3.5rem/1 var(--wj-mono);white-space:nowrap;font-variant-numeric:tabular-nums}
.wr-studio-series>strong>span{font-weight:400;color:var(--wj-faint);padding:0 4px}
.wr-studio-series>small{display:block;font-size:var(--text-micro,.6875rem);margin-top:9px}
.wr-studio-series>.wr-studio-vs{font:700 1.4rem var(--wj-display);color:var(--wj-faint)}
.wr-studio-now-label{text-align:center;font-size:var(--text-micro,.6875rem);color:var(--wj-faint);padding-top:7px}
.wr-studio-now{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;padding:10px 0 20px;border-bottom:1px solid var(--wj-rule)}
.wr-studio-now>div:last-child{text-align:right}
.wr-studio-now strong{display:block;font:700 1.75rem/1.3 var(--wj-mono);font-variant-numeric:tabular-nums}
.wr-studio-now small{display:block;font-size:var(--text-micro,.6875rem);margin-top:4px}
.wr-studio-replay{padding-top:22px}
.wr-studio-replay-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}
.wr-studio-replay-heading>label{max-width:60%}
.wr-studio-result{padding:18px 0}
.wr-studio-result>p:first-child{font-size:var(--text-label,.75rem);color:var(--wj-faint);text-transform:uppercase;letter-spacing:.7px;margin:0 0 17px;text-align:center}
.wr-studio-result-teams{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.wr-studio-result-teams>div:last-child{text-align:right}
.wr-studio-result-teams small{display:block;overflow-wrap:anywhere}
.wr-studio-result-teams strong{display:block;font:700 clamp(1.8rem,5vw,2.7rem)/1.2 var(--wj-mono);font-variant-numeric:tabular-nums;margin:7px 0}
.wr-studio-result>small{display:block;text-align:center;font-size:var(--text-micro,.6875rem)}
.wr-studio-result-track{height:6px;display:flex;gap:3px;margin:13px 0 20px}
.wr-studio-result-track>span:first-child{background:var(--wj-accent);border-radius:3px}
.wr-studio-result-track>span:last-child{flex:1;background:var(--info,#5dade2);border-radius:3px}
.wr-studio-caption{background:var(--wj-panel);border-left:3px solid var(--wj-accent);padding:13px 15px;font-size:var(--text-label,.75rem);line-height:1.7}
.wr-studio-sources{border-top:1px solid var(--wj-rule);padding-top:12px;margin-top:23px;color:var(--wj-muted);font-size:var(--text-label,.75rem);line-height:1.7}
.wr-studio-sources>summary{cursor:pointer;min-height:44px;padding:10px 0}
.wr-studio-sources p{overflow-wrap:anywhere;max-width:76ch}
.wr-studio-sources a{color:var(--wj-accent);text-decoration:underline;text-underline-offset:3px}
.wr-studio-rounds{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:24px;align-items:start}
.wr-studio-round{min-width:0}
.wr-studio-round>header{border-top:2px solid var(--wj-accent-line);padding:13px 0;margin-bottom:14px}
.wr-studio-round>header h4{font:700 var(--text-title,1.125rem) var(--wj-display)}
.wr-studio-bracket-game{border:1px solid var(--wj-rule);background:var(--wj-panel);padding:13px;margin:0 0 18px;border-radius:var(--card-radius-sm,8px);min-width:0}
.wr-studio-status{display:block;font-size:var(--text-micro,.6875rem);color:var(--wj-faint);text-transform:uppercase;letter-spacing:.8px;margin-bottom:9px}
.wr-studio-bracket-game>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 0}
.wr-studio-bracket-game>div+div{border-top:1px solid var(--wj-rule)}
.wr-studio-bracket-game>div>span{font-size:var(--text-label,.75rem);overflow-wrap:anywhere}
.wr-studio-bracket-game>div>span small{display:block;color:var(--wj-accent);font-size:var(--text-micro,.6875rem)}
.wr-studio-bracket-game>div>strong{font:500 1.1rem var(--wj-mono);font-variant-numeric:tabular-nums}
.wr-studio-bracket-game>.is-winner>strong{font-weight:800;color:var(--wj-accent)}
.wr-studio-bracket-game>p{font-size:var(--text-micro,.6875rem);color:var(--wj-faint);line-height:1.6}
.wr-studio-round-bye{font-size:var(--text-label,.75rem);border-left:2px solid var(--wj-accent);padding:8px 12px;margin-bottom:14px;overflow-wrap:anywhere}
.wr-studio-path-name{font:700 1.45rem var(--wj-display)!important;margin:20px 0!important;overflow-wrap:anywhere}
.wr-studio-path-name>small{display:block;font-size:var(--text-label,.75rem);font-weight:500;margin-top:7px;font-family:var(--wj-body)}
.wr-studio-path-stops{display:flex;gap:0;margin:23px 0}
.wr-wire-studio .wr-studio-path-stops>button{position:relative;flex:1;min-width:0;border:0;border-radius:0;background:transparent;text-align:left;padding:0 12px 0 0}
.wr-studio-path-stops>button::after{content:'';position:absolute;left:19px;right:0;top:8px;height:1px;background:var(--wj-rule-strong)}
.wr-studio-path-stops>button:last-child::after{display:none}
.wr-studio-dot{position:relative;z-index:1;display:block;width:17px;height:17px;border:4px solid var(--wj-paper);outline:1px solid var(--wj-rule-strong);border-radius:50%;background:var(--wj-faint);margin-bottom:13px}
.wr-studio-path-stops>button[aria-pressed=true] .wr-studio-dot{background:var(--wj-accent);outline-color:var(--wj-accent)}
.wr-studio-path-stops strong{display:block;font-size:var(--text-label,.75rem);font-weight:750;overflow-wrap:anywhere}
.wr-studio-path-stops small{display:block;font-size:var(--text-micro,.6875rem);margin-top:6px}
.wr-studio-path-stops>button[aria-pressed=true] strong{color:var(--wj-accent)}
.wr-studio-path-result{background:var(--wj-panel);border-left:3px solid var(--wj-accent);padding:20px;border-radius:0 var(--card-radius-sm,8px) var(--card-radius-sm,8px) 0}
.wr-studio-path-result>h4{font-size:var(--text-label,.75rem);text-transform:uppercase;letter-spacing:.7px;color:var(--wj-faint);margin:0 0 14px}
.wr-studio-path-result>p{font-size:var(--text-label,.75rem);line-height:1.7}
.wr-studio-path-result>.wr-studio-bye{font:700 1.7rem var(--wj-display);padding:10px 0}
.wr-studio-path-score{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:10px 0}
.wr-studio-path-score+.wr-studio-path-score{border-top:1px solid var(--wj-rule)}
.wr-studio-path-score>span{overflow-wrap:anywhere;font-size:var(--text-body,1rem)}
.wr-studio-path-score>strong{font:700 1.75rem var(--wj-mono);font-variant-numeric:tabular-nums}
.wr-studio-race-list{list-style:none;margin:25px 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px}
.wr-studio-race-list li{background:var(--wj-panel);border-top:2px solid var(--wj-rule-strong);padding:16px;min-width:0;border-radius:0 0 var(--card-radius-sm,8px) var(--card-radius-sm,8px)}
.wr-studio-race-list li>div{display:flex;justify-content:space-between;gap:15px}
.wr-studio-race-list strong{overflow-wrap:anywhere;font-size:var(--text-body,1rem)}
.wr-studio-race-list li>div>span{white-space:nowrap;font-family:var(--wj-mono);font-variant-numeric:tabular-nums}
.wr-studio-race-list p{font-size:var(--text-label,.75rem);font-weight:700;color:var(--wj-accent)}
.wr-studio-race-list small{display:block}
/* Tablet / narrow desktop */
/* iPad / narrow desktop: two columns (paper + rail); the briefs stack under the lead instead of squeezing a third column. */
@media(max-width:1100px){.wr-journal-layout{grid-template-columns:minmax(0,2.4fr) minmax(200px,1fr);gap:20px}.wr-journal-main{display:block}.wr-journal-grid{border-left:0;padding-left:0;margin-top:22px}.wr-journal-grid>.wr-journal-story{grid-template-columns:minmax(0,1fr) 96px;gap:12px;padding:18px 0}.wr-journal-grid .wr-journal-art{aspect-ratio:1.2}.wr-journal-grid .wr-journal-art-teams>div>.wr-journal-team-badge{width:36px;height:36px}.wr-journal-rail{padding-left:18px}.wr-nfl-games{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:900px){.wr-journal-layout{grid-template-columns:minmax(0,1fr) 210px}.wr-journal-main{display:block}.wr-journal-grid{border-left:0;padding-left:0;margin-top:22px}.wr-journal-grid>.wr-journal-story{grid-template-columns:minmax(0,1fr) 100px;padding:18px 0}.wr-journal-grid .wr-journal-art{aspect-ratio:1.2}.wr-journal-grid .wr-journal-art-teams>div>.wr-journal-team-badge{width:38px;height:38px}.wr-journal-art-teams>div>.wr-journal-team-badge{width:80px;height:80px}.wr-journal-filters{grid-template-columns:1fr 1fr}.wr-journal-filters .wr-journal-refresh{align-self:end}.wr-all-wire-stories{grid-template-columns:repeat(2,minmax(0,1fr))}}
/* Phones */
@media(max-width:767px){
 .wr-journal-page{margin:8px 0 16px}
 dialog.wr-journal{width:100%;height:100dvh;max-height:100dvh;max-width:100%;margin:0;border:0;border-radius:0}
 dialog.wr-journal .wr-journal-bar{padding-top:calc(8px + env(safe-area-inset-top,0px))}
 .wr-journal-bar{padding:8px 16px;gap:12px;min-height:58px;flex-wrap:wrap}
 .wr-journal-bar h2{font-size:1.8rem}
 .wr-journal-bar>span{font-size:var(--text-micro,.6875rem);padding-left:12px}
 .wr-journal-bar:has(.wr-journal-bar-actions)>span:not(.wr-journal-bar-actions){display:none}
 .wr-journal-dot{margin:0 4px}
 .wr-journal-nav{padding:0 6px;gap:0}
 .wr-journal :is(button,select){min-height:44px}
 .wr-journal-scorestrip-label{flex-basis:70px;padding:12px 8px}
 .wr-journal-score-tile{min-width:210px;padding:8px 10px}
 .wr-journal-paper{padding:16px 16px calc(24px + env(safe-area-inset-bottom,0px))}
 .wr-journal-masthead{align-items:center;gap:10px}
 .wr-journal-masthead h3{font-size:1.7rem}
 .wr-journal-masthead>p{white-space:normal;text-align:right;max-width:130px}
 .wr-journal-tools>summary{min-height:44px;padding:12px 0}
 .wr-journal-tools>summary>span{display:none}
 .wr-journal-tools>summary>span.is-active{display:inline}
 .wr-journal-filters{grid-template-columns:1fr 1fr;gap:10px}
 .wr-journal-filters select{font-size:16px}
 .wr-journal-filters label:nth-child(3),.wr-journal-filters .wr-journal-refresh{grid-column:1/-1}
 .wr-journal-layout{display:flex;flex-direction:column;gap:26px}
 .wr-journal-main{width:100%}
 .wr-journal-rail{width:100%;padding:22px 0 0;border-left:0;border-top:2px solid var(--wj-accent-line)}
 .wr-journal-story.is-lead h3{font-size:1.9rem}
 .wr-journal-story.is-lead>.wr-journal-art{max-height:125px;aspect-ratio:3/1}
 .wr-journal-story.is-lead .wr-journal-art-teams{inset:8px 14px 48px}
 .wr-journal-story.is-lead .wr-journal-art-teams>div>.wr-journal-team-badge{width:48px;height:48px}
 .wr-journal-story.is-lead .wr-journal-art-teams>div>span:last-child:not(.wr-journal-team-badge){display:none}
 .wr-journal-story.is-lead .wr-journal-art-label{display:none}
 .wr-journal-art-teams>div>.wr-journal-team-badge{width:78px;height:78px}
 .wr-journal-art-label{top:10px;left:10px}
 .wr-journal-grid>.wr-journal-story{grid-template-columns:minmax(0,1fr) 86px}
 .wr-journal-grid .wr-journal-art{aspect-ratio:1/1.1;grid-row:1/span 3}
 .wr-journal-grid .wr-journal-art-teams>div>.wr-journal-team-badge{width:32px;height:32px}
 .wr-journal-grid .wr-journal-story-copy{display:contents}
 .wr-journal-grid .wr-journal-story-copy>*{grid-column:1;min-width:0}
 .wr-journal-grid .wr-journal-story-copy>.wr-journal-read,.wr-journal-grid .wr-journal-story-copy>.wr-story-dek{grid-column:1/-1}
 .wr-journal-read>summary,.wr-journal-context summary,.wr-journal-rail-section>summary,.wr-journal-footer summary{min-height:44px;padding:12px 0}
 .wr-journal .wr-journal-headlines button{min-height:44px}
 .wr-journal-headlines li{padding-bottom:5px}
 .wr-journal-table li{padding:10px 0}
 .wr-wire-reader-tools{grid-template-columns:minmax(0,1fr);gap:6px}
 .wr-wire-search{align-items:stretch}
 .wr-wire-search label{max-width:none}
 .wr-wire-search button{align-self:end}
 .wr-wire-edition-strip{align-items:flex-start}
 .wr-wire-coverage-note{margin:4px 0 10px}
 .wr-wire-rivalry-editor form{grid-template-columns:minmax(0,1fr)}
 .wr-wire-rivalry-editor li{align-items:flex-start;flex-direction:column}
 .wr-wire-rivalry-editor h3{font-size:1.3rem}
 .wr-all-wire-stories{display:block}
 .wr-all-wire-story{margin-bottom:24px}
 .wr-all-wire-story.is-lead h3{font-size:1.9rem}
 .wr-all-wire-controls{align-items:stretch;flex-direction:column}
 .wr-all-wire-controls select{max-width:100%;width:100%}
 .wr-all-wire-progress{display:block}
 .wr-journal-bar-actions{gap:4px}
 .wr-nfl-games{grid-template-columns:minmax(0,1fr)}
 .wr-wire-studio{width:100%;height:100dvh;max-height:100dvh;max-width:100%;border:0;border-radius:0}
 .wr-studio-mast{padding:calc(12px + env(safe-area-inset-top,0px)) 16px 12px}
 .wr-studio-tabs{padding:0 16px;gap:22px}
 .wr-studio-panel{padding:22px 16px calc(28px + env(safe-area-inset-bottom,0px))}
 .wr-studio-versus{grid-template-columns:minmax(0,1fr) 76px minmax(0,1fr);gap:8px;padding:22px 0}
 .wr-studio-series>strong{font-size:2.4rem}
 .wr-studio-replay-heading{align-items:flex-start;flex-direction:column}
 .wr-studio-replay-heading>label{max-width:100%;width:100%}
 .wr-studio-editions{align-items:stretch;flex-direction:column;gap:10px}
 .wr-studio-editions>button{align-self:start}
 .wr-studio-path-stops>button{padding-right:7px}
 .wr-studio-path-result{padding:16px}
 .wr-studio-rounds{grid-template-columns:minmax(0,1fr)}
}
@media(prefers-reduced-motion:reduce){.wr-journal *,.wr-wire-studio *{scroll-behavior:auto!important;transition:none!important}}
`;
    function ensure() {
        try {
            if (typeof document === 'undefined' || document.getElementById('wr-wire-styles')) return;
            const el = document.createElement('style');
            el.id = 'wr-wire-styles';
            el.textContent = CSS;
            document.head.appendChild(el);
        } catch (_) { /* no DOM (tests) */ }
    }
    ensure();
    if (typeof window !== 'undefined') window.WrWireStyles = { ensure, CSS };
})();
