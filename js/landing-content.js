(function () {
  'use strict';

  const CONTENT_PATH = 'content/landing-pages.json';

  function pageContentUrl() {
    return new URL(CONTENT_PATH, window.location.href).toString();
  }

  function setEditPath(el, editPath) {
    if (!el || !editPath) return;
    el.dataset.dhqEditPath = editPath;
  }

  function pagePath(path) {
    return `pages.landing.${path}`;
  }

  function setText(root, selector, value, editPath) {
    if (value === undefined || value === null) return;
    const el = root.querySelector(selector);
    if (el) {
      el.textContent = String(value);
      setEditPath(el, editPath);
    }
  }

  function setPlaceholder(root, selector, value, editPath) {
    if (value === undefined || value === null) return;
    const el = root.querySelector(selector);
    if (el) {
      el.setAttribute('placeholder', String(value));
      setEditPath(el, editPath);
    }
  }

  function setButtonTextPreservingIcon(selector, value, editPath) {
    if (value === undefined || value === null) return;
    const button = document.querySelector(selector);
    if (!button) return;
    const svg = button.querySelector('svg');
    button.textContent = '';
    if (svg) button.appendChild(svg);
    button.appendChild(document.createTextNode(String(value)));
    setEditPath(button, editPath);
  }

  function applyRows(container, rows, basePath) {
    if (!container || !Array.isArray(rows)) return;
    const rowEls = Array.from(container.querySelectorAll('.dash-row,.diff-row'));
    rows.forEach((row, index) => {
      const el = rowEls[index];
      if (!el) return;
      setText(el, 'strong', row.title, `${basePath}.${index}.title`);
      setText(el, 'span', row.copy, `${basePath}.${index}.copy`);
    });
  }

  function applyHeroDashboard(dashboard) {
    if (!dashboard) return;
    setText(document, '.dash-brand', dashboard.brand, pagePath('dashboard.brand'));
    setText(document, '.dash-pill', dashboard.status, pagePath('dashboard.status'));
    const panels = Array.from(document.querySelectorAll('.hero-dashboard .dash-panel'));
    (dashboard.panels || []).forEach((panel, index) => {
      const el = panels[index];
      if (!el) return;
      const base = pagePath(`dashboard.panels.${index}`);
      setText(el, '.dash-label', panel.label, `${base}.label`);
      setText(el, '.dash-headline', panel.headline, `${base}.headline`);
      setText(el, '.dash-score', panel.score, `${base}.score`);
      setText(el, '.dash-copy', panel.copy, `${base}.copy`);
      applyRows(el, panel.rows, `${base}.rows`);
    });
    setText(document, '.phone-kicker', dashboard.phoneKicker, pagePath('dashboard.phoneKicker'));
    const phoneCards = Array.from(document.querySelectorAll('.phone-card'));
    (dashboard.phoneCards || []).forEach((card, index) => {
      const el = phoneCards[index];
      if (!el) return;
      setText(el, 'strong', card.title, pagePath(`dashboard.phoneCards.${index}.title`));
      setText(el, 'span', card.copy, pagePath(`dashboard.phoneCards.${index}.copy`));
    });
  }

  function applyProductSummary(items) {
    if (!Array.isArray(items)) return;
    const chips = Array.from(document.querySelectorAll('.product-chip'));
    items.forEach((item, index) => {
      const chip = chips[index];
      if (!chip) return;
      setText(chip, 'strong', item.title, pagePath(`productSummary.${index}.title`));
      const nested = chip.querySelector('span span');
      if (nested) {
        nested.textContent = item.copy || '';
        setEditPath(nested, pagePath(`productSummary.${index}.copy`));
      }
    });
  }

  function applySectionHead(section, content, basePath) {
    if (!section || !content) return;
    setText(section, '.section-kicker', content.eyebrow, `${basePath}.eyebrow`);
    setText(section, '.section-title', content.title, `${basePath}.title`);
    setText(section, '.section-sub', content.subtitle, `${basePath}.subtitle`);
  }

  function applyDifferentiators(content) {
    const section = document.querySelectorAll('section.section')[0];
    applySectionHead(section, content, pagePath('differentiators'));
    const cards = Array.from(document.querySelectorAll('.diff-card'));
    (content?.cards || []).forEach((card, index) => {
      const el = cards[index];
      if (!el) return;
      const base = pagePath(`differentiators.cards.${index}`);
      setText(el, '.diff-kicker', card.eyebrow, `${base}.eyebrow`);
      setText(el, '.diff-title', card.title, `${base}.title`);
      setText(el, '.diff-copy', card.copy, `${base}.copy`);
      applyRows(el, card.rows, `${base}.rows`);
    });
  }

  function applyFeatures(content) {
    const section = document.querySelectorAll('section.section')[1];
    applySectionHead(section, content, pagePath('features'));
    const cards = Array.from(document.querySelectorAll('.feat-card'));
    (content?.cards || []).forEach((card, index) => {
      const el = cards[index];
      if (!el) return;
      const base = pagePath(`features.cards.${index}`);
      setText(el, '.feat-icon', card.icon, `${base}.icon`);
      setText(el, '.feat-name', card.title, `${base}.title`);
      setText(el, '.feat-desc', card.copy, `${base}.copy`);
    });
  }

  function setPriceAmount(card, plan, basePath) {
    const amount = card.querySelector('.price-amount');
    if (!amount) return;
    amount.textContent = '';
    amount.appendChild(document.createTextNode(plan.price || ''));
    setEditPath(amount, `${basePath}.price`);
    if (plan.billing) {
      amount.appendChild(document.createTextNode(' '));
      const billing = document.createElement('span');
      billing.textContent = plan.billing;
      setEditPath(billing, `${basePath}.billing`);
      amount.appendChild(billing);
    }
  }

  function applyPricing(content) {
    const section = document.getElementById('pricing');
    applySectionHead(section, content, pagePath('pricing'));
    const cards = Array.from(document.querySelectorAll('.price-card'));
    (content?.plans || []).forEach((plan, index) => {
      const card = cards[index];
      if (!card) return;
      const base = pagePath(`pricing.plans.${index}`);
      card.classList.toggle('price-card-pop', !!plan.primary);
      let badge = card.querySelector('.price-badge');
      if (plan.badge && !badge) {
        badge = document.createElement('div');
        badge.className = 'price-badge';
        card.prepend(badge);
      }
      if (badge) {
        badge.textContent = plan.badge || '';
        badge.style.display = plan.badge ? '' : 'none';
        setEditPath(badge, `${base}.badge`);
      }
      setText(card, '.price-name', plan.name, `${base}.name`);
      setPriceAmount(card, plan, base);
      setText(card, '.price-note', plan.note, `${base}.note`);
      const list = card.querySelector('.price-features');
      if (list && Array.isArray(plan.features)) {
        list.replaceChildren(...plan.features.map((feature, featureIndex) => {
          const li = document.createElement('li');
          li.textContent = feature;
          setEditPath(li, `${base}.features.${featureIndex}`);
          return li;
        }));
      }
      setText(card, '.price-btn', plan.cta, `${base}.cta`);
    });

    const leaguePass = section?.querySelector('p[style*="text-align:center"]');
    if (leaguePass && content) {
      leaguePass.textContent = '';
      const strong = document.createElement('strong');
      strong.style.color = 'var(--gold)';
      strong.textContent = content.leaguePassLabel || 'League Pass';
      setEditPath(strong, pagePath('pricing.leaguePassLabel'));
      leaguePass.append(strong, document.createTextNode(' - '));
      leaguePass.append(document.createTextNode(content.leaguePassCopy || ''));
      setEditPath(leaguePass, pagePath('pricing.leaguePassCopy'));
      if (content.leaguePassCta) {
        leaguePass.append(document.createTextNode(' '));
        const link = document.createElement('a');
        link.href = `mailto:${content.leaguePassEmail || ''}`;
        link.style.color = 'var(--gold)';
        link.textContent = content.leaguePassCta;
        setEditPath(link, pagePath('pricing.leaguePassCta'));
        leaguePass.appendChild(link);
      }
    }
  }

  function applyPlatforms(content) {
    if (!content) return;
    const band = document.querySelector('.platform-band');
    setText(band || document, '.platforms-title', content.title, pagePath('platforms.title'));
    setText(band || document, '.platforms-copy', content.copy, pagePath('platforms.copy'));
    const badges = Array.from(document.querySelectorAll('.platforms-list span'));
    (content.badges || []).forEach((badge, index) => {
      const el = badges[index];
      if (!el) return;
      el.textContent = badge;
      el.classList.toggle('live', index === 0);
      setEditPath(el, pagePath(`platforms.badges.${index}`));
    });
  }

  function applyAuth(content) {
    if (!content) return;
    setText(document, '.auth-title', content.title, pagePath('auth.title'));
    setButtonTextPreservingIcon('#btnGoogle', content.googleCta, pagePath('auth.googleCta'));
    setButtonTextPreservingIcon('#btnApple', content.appleCta, pagePath('auth.appleCta'));
    setText(document, '.auth-tabs #tabSignup', content.signupTab, pagePath('auth.signupTab'));
    setText(document, '.auth-tabs #tabSignin', content.signinTab, pagePath('auth.signinTab'));
    setPlaceholder(document, '#su-name', content.displayNamePlaceholder, pagePath('auth.displayNamePlaceholder'));
    setPlaceholder(document, '#su-email', content.signupEmailPlaceholder, pagePath('auth.signupEmailPlaceholder'));
    setPlaceholder(document, '#su-password', content.signupPasswordPlaceholder, pagePath('auth.signupPasswordPlaceholder'));
    setText(document, '#btnSignup', content.signupSubmit, pagePath('auth.signupSubmit'));
    setPlaceholder(document, '#si-email', content.signinEmailPlaceholder, pagePath('auth.signinEmailPlaceholder'));
    setPlaceholder(document, '#si-password', content.signinPasswordPlaceholder, pagePath('auth.signinPasswordPlaceholder'));
    setText(document, '#btnSignin', content.signinSubmit, pagePath('auth.signinSubmit'));
    setText(document, '#btnReset', content.resetCta, pagePath('auth.resetCta'));
  }

  function applyLandingContent(content) {
    if (!content) return;
    if (content.meta?.title) document.title = content.meta.title;
    setText(document, '.nav-title', content.nav?.brand, pagePath('nav.brand'));
    setText(document, '#navSignin', content.nav?.signIn, pagePath('nav.signIn'));
    setText(document, '.nav-btn-primary', content.nav?.primaryCta, pagePath('nav.primaryCta'));
    setText(document, '.hero-eyebrow', content.hero?.eyebrow, pagePath('hero.eyebrow'));
    setText(document, '.hero h1', content.hero?.title, pagePath('hero.title'));
    setText(document, '.hero-sub', content.hero?.subtitle, pagePath('hero.subtitle'));
    setText(document, '.hero-cta', content.hero?.primaryCta, pagePath('hero.primaryCta'));
    setText(document, '.hero-secondary', content.hero?.secondaryCta, pagePath('hero.secondaryCta'));
    setText(document, '.hero-free', content.hero?.freeLine, pagePath('hero.freeLine'));
    applyHeroDashboard(content.dashboard);
    applyProductSummary(content.productSummary);
    applyDifferentiators(content.differentiators);
    applyFeatures(content.features);
    applyPricing(content.pricing);
    applyPlatforms(content.platforms);
    applyAuth(content.auth);
    setText(document, '.footer', content.footer, pagePath('footer'));
  }

  async function initLandingContent() {
    try {
      const res = await fetch(pageContentUrl(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      applyLandingContent(data.pages?.landing);
    } catch (err) {
      console.warn('[landing-content] using built-in landing copy', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLandingContent);
  } else {
    initLandingContent();
  }

  window.DHQLandingContent = {
    applyLandingContent,
  };
})();
