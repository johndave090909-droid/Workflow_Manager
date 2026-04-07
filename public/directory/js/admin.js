/* ── admin.js — Taste Polynesia Admin Panel ─────────────────────────────── */

const ADMIN_EMAIL  = 'johndave090909@gmail.com';
const FIREBASE_CFG = {
  apiKey:            'AIzaSyAgNSwj4LTeMbuVMTSbFRmbI6eKRYUsRXg',
  authDomain:        'systems-hub.firebaseapp.com',
  projectId:         'systems-hub',
  storageBucket:     'systems-hub.firebasestorage.app',
  messagingSenderId: '513999161843',
  appId:             '1:513999161843:web:5a17f15e77771c341e2a86',
};

/* ── Inject admin styles ─────────────────────────────────────────────────── */
(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    #admin-trigger {
      opacity: 0;
      pointer-events: auto;
      width: 1.4rem;
      height: 1.4rem;
      display: inline-block;
      cursor: default;
      user-select: none;
    }

    /* ── Sign-in overlay ── */
    #tp-signin-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.72);
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(4px);
    }
    #tp-signin-box {
      background: #1a1612;
      border: 1px solid #3a3025;
      border-radius: 12px;
      padding: 2.8rem 2.4rem;
      width: min(380px, 90vw);
      display: flex; flex-direction: column; align-items: center; gap: 1.2rem;
      box-shadow: 0 24px 64px rgba(0,0,0,0.6);
    }
    #tp-signin-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.4rem;
      font-weight: 700;
      letter-spacing: 0.3em;
      color: #d0b25a;
    }
    #tp-signin-sub {
      font-size: 0.72rem;
      letter-spacing: 0.18em;
      color: #7a6a58;
      text-transform: uppercase;
      margin-top: -0.6rem;
    }
    #tp-google-btn {
      display: flex; align-items: center; gap: 0.75rem;
      background: #fff; color: #3c3c3c;
      border: none; border-radius: 6px;
      padding: 0.72rem 1.4rem;
      font-size: 0.88rem; font-weight: 600;
      cursor: pointer; width: 100%;
      justify-content: center;
      transition: background 0.15s;
    }
    #tp-google-btn:hover { background: #f1f1f1; }
    #tp-signin-error {
      color: #e07070; font-size: 0.78rem;
      text-align: center; min-height: 1rem;
    }
    #tp-signin-close {
      background: none; border: none;
      color: #5a4e42; font-size: 0.78rem;
      cursor: pointer; padding: 0.3rem 0.6rem;
      transition: color 0.15s;
    }
    #tp-signin-close:hover { color: #c9b89a; }

    /* ── Admin panel overlay ── */
    #tp-admin-overlay {
      position: fixed; inset: 0; z-index: 9998;
      background: rgba(0,0,0,0.55);
      display: flex; align-items: stretch; justify-content: flex-end;
      backdrop-filter: blur(2px);
    }
    #tp-admin-panel {
      background: #13110e;
      border-left: 1px solid #2e2620;
      width: min(520px, 100vw);
      height: 100%;
      display: flex; flex-direction: column;
      overflow: hidden;
      box-shadow: -8px 0 40px rgba(0,0,0,0.5);
      animation: tpSlideIn 0.28s cubic-bezier(0.22,1,0.36,1);
    }
    @keyframes tpSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }

    /* Header */
    #tp-admin-header {
      display: flex; align-items: center;
      padding: 1rem 1.2rem;
      border-bottom: 1px solid #2e2620;
      gap: 0.8rem;
      flex-shrink: 0;
    }
    #tp-admin-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: 0.22em;
      color: #d0b25a;
      flex: 1;
    }
    #tp-admin-user-row {
      display: flex; align-items: center; gap: 0.6rem;
    }
    #tp-admin-user-email {
      font-size: 0.7rem;
      color: #6a5c4e;
      letter-spacing: 0.04em;
    }
    #tp-admin-signout {
      background: none; border: 1px solid #3a3025;
      color: #7a6a58; font-size: 0.68rem;
      border-radius: 4px; padding: 0.2rem 0.5rem;
      cursor: pointer; transition: all 0.15s;
    }
    #tp-admin-signout:hover { border-color: #d0b25a; color: #d0b25a; }
    #tp-admin-close {
      background: none; border: none;
      color: #5a4e42; font-size: 1rem;
      cursor: pointer; padding: 0.2rem 0.4rem;
      transition: color 0.15s; line-height: 1;
    }
    #tp-admin-close:hover { color: #e07070; }

    /* Tabs */
    #tp-admin-tabs {
      display: flex; gap: 0;
      border-bottom: 1px solid #2e2620;
      overflow-x: auto;
      flex-shrink: 0;
    }
    #tp-admin-tabs::-webkit-scrollbar { height: 0; }
    .tp-tab {
      background: none; border: none;
      color: #5a4e42;
      font-size: 0.7rem; font-weight: 600;
      letter-spacing: 0.1em;
      padding: 0.7rem 1.1rem;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      white-space: nowrap;
      transition: all 0.15s;
      text-transform: uppercase;
    }
    .tp-tab:hover { color: #c9b89a; }
    .tp-tab.active {
      color: #d0b25a;
      border-bottom-color: #d0b25a;
    }

    /* Body */
    #tp-admin-body {
      flex: 1; overflow-y: auto;
      padding: 1.2rem;
      display: flex; flex-direction: column; gap: 0.1rem;
    }
    #tp-admin-body::-webkit-scrollbar { width: 4px; }
    #tp-admin-body::-webkit-scrollbar-track { background: #0e0c0a; }
    #tp-admin-body::-webkit-scrollbar-thumb { background: #3a3025; border-radius: 2px; }

    .tp-section { display: flex; flex-direction: column; gap: 0.85rem; }
    .tp-section.hidden { display: none; }

    .tp-group-label {
      font-size: 0.65rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: #d0b25a;
      border-top: 1px solid #2a2218;
      padding-top: 1rem;
      margin-top: 0.4rem;
    }
    .tp-group-label:first-child { border-top: none; padding-top: 0; margin-top: 0; }

    .tp-field { display: flex; flex-direction: column; gap: 0.3rem; }
    .tp-field label {
      font-size: 0.68rem;
      letter-spacing: 0.08em;
      color: #6a5c4e;
      text-transform: uppercase;
    }
    .tp-field input,
    .tp-field textarea {
      background: #1e1a15;
      border: 1px solid #2e2620;
      border-radius: 5px;
      color: #e8d5b0;
      font-family: 'Manrope', sans-serif;
      font-size: 0.82rem;
      padding: 0.5rem 0.7rem;
      transition: border-color 0.15s;
      resize: vertical;
      width: 100%;
    }
    .tp-field input:focus,
    .tp-field textarea:focus {
      outline: none;
      border-color: #d0b25a;
      background: #231e17;
    }

    /* Footer */
    #tp-admin-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.9rem 1.2rem;
      border-top: 1px solid #2e2620;
      flex-shrink: 0;
    }
    #tp-admin-status {
      font-size: 0.75rem;
      color: #8a9e7a;
    }
    #tp-admin-save {
      background: #d0b25a;
      border: none; border-radius: 6px;
      color: #13110e;
      font-size: 0.8rem; font-weight: 700;
      letter-spacing: 0.08em;
      padding: 0.6rem 1.4rem;
      cursor: pointer;
      transition: background 0.15s;
    }
    #tp-admin-save:hover { background: #e8c96e; }
    #tp-admin-save:disabled { background: #4a3e2e; color: #7a6a58; cursor: not-allowed; }
  `;
  document.head.appendChild(style);
})();

/* ── Firebase init (named instance, no conflict with main app) ───────────── */
let _fbApp, _fbAuth, _fbReady = false;

function getFirebase() {
  if (!_fbReady) {
    try { _fbApp = firebase.app('tp-admin'); }
    catch (_) { _fbApp = firebase.initializeApp(FIREBASE_CFG, 'tp-admin'); }
    _fbAuth  = firebase.auth(_fbApp);
    _fbReady = true;
  }
  return { auth: _fbAuth };
}

/* ── Default content (mirrors the HTML) ─────────────────────────────────── */
const DEFAULTS = {
  nav: {
    logo:     'TASTE POLYNESIA',
    ccblText: 'CCBL',
    ccblHref: '/ccbl',
  },
  hero: {
    label1:     '001 / The Art',
    word1:      'Crafted',
    word2:      'With',
    word3:      'Purpose',
    tagline:    'Polynesian Cultural Center \u2014 Culinary Excellence, Laie Hawai\u02BBi',
    label2:     '001 / The Craft',
    subHeading: 'Where Passion\nMeets Precision',
    subBody:    'Every dish is a story told through heat, technique, and devotion. Our culinary program transforms raw passion into professional mastery \u2014 one plate at a time.',
  },
  introVideo: {
    url: 'https://firebasestorage.googleapis.com/v0/b/systems-hub.firebasestorage.app/o/CCBL%2F1774600778010_2205_TastePolynesia_Inspired_Ahi%20Sashimi_1920x1080_d1m%20%281%29_2205_TastePolynesia_Inspired_Ahi%20Sashimi_1920x1080_d1m%20%281%29.m4v?alt=media',
  },
  row1: {
    heading:  'The Ground Oven',
    body:     'Ground ovens are traditional throughout the Polynesian Islands. In the early morning hours at the Center a Hawaiian ground oven, or imu, is built and used to dry age and steam a whole roasted pig for 10 hours to ensure the most tender and delicious meat. This practice has been passed down through the generations \u2014 honoring the long-standing traditions of Polynesian cooking.',
    videoUrl: 'https://firebasestorage.googleapis.com/v0/b/systems-hub.firebasestorage.app/o/DirectoryGallery%2Fvideos%2F3191697714.mp4?alt=media',
    poster:   '/directory/posters/ground-oven.jpg',
  },
  row2: {
    heading:  'Cooking on Hot Rocks',
    body:     'Cultural experts from our Samoan village and Executive Chef Felix Tai showcase one of the many ways that the Center uses traditional Polynesian techniques and recipes in innovative ways to bring unique dishes to our Ohana. Our chefs use a hot rock technique to create a delicious meal with fresh Kona Kampachi fish marinated in brown sugar and coconut milk vinaigrette \u2014 based off a traditional Samoan recipe.',
    videoUrl: 'https://firebasestorage.googleapis.com/v0/b/systems-hub.firebasestorage.app/o/DirectoryGallery%2Fvideos%2F3209454685.mp4?alt=media',
    poster:   '/directory/posters/hot-rocks.jpg',
  },
  s002: {
    label:   '002 / Experience',
    heading: 'An Immersive\nKitchen Education',
    body:    'Hands-on training in professional kitchens. Real service, real guests, real standards. No shortcuts \u2014 just genuine mastery earned in the fire of daily practice.',
  },
  s003: {
    label:   '003 / Leadership',
    heading: 'Building Culinary\nBusiness Leaders',
    body:    'Beyond cooking \u2014 our CCBL program develops the business acumen, leadership mindset, and professional excellence that defines a lasting culinary career.',
  },
  s004: {
    label:   '004 / Heritage',
    heading: 'Rooted in\nPolynesian Culture',
    body:    'Laie, Hawai\u02BBi provides a singular backdrop \u2014 where Pacific culinary traditions merge with world-class technique to create something wholly original and deeply meaningful.',
  },
  s005: {
    label:      '005 / Begin',
    heading:    'Certified Culinary\nBusiness Leader',
    body:       'Earn a credential focused on culinary finance, operations, leadership, and guest experience. Build the skills that move you from great cook to confident business leader.',
    buttonText: 'Link to Certified Culinary Business Leader',
    buttonHref: '/ccbl',
  },
  marquee1: 'CULINARY MASTERY',
  marquee2: 'CERTIFIED EXCELLENCE',
  footer: {
    copyright: 'Polynesian Cultural Center, All Rights Reserved, \u00A9 2026',
  },
};

/* ── Deserialise Firestore REST response ─────────────────────────────────── */
function fromFsValue(v) {
  if (!v) return undefined;
  if (v.stringValue  !== undefined) return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue  !== undefined) return Number(v.doubleValue);
  if (v.mapValue)    return Object.fromEntries(
    Object.entries(v.mapValue.fields || {}).map(([k, vv]) => [k, fromFsValue(vv)])
  );
  return undefined;
}

/* ── Apply content to DOM ───────────────────────────────────────────────── */
function applyContent(c) {
  const g = (sec, key) => {
    const def = DEFAULTS[sec];
    if (typeof def === 'object') {
      return (c[sec] && c[sec][key] !== undefined) ? c[sec][key] : def[key];
    }
    return c[sec] !== undefined ? c[sec] : def;
  };
  const gTop = key => c[key] !== undefined ? c[key] : DEFAULTS[key];

  // Nav
  const navLogo = document.querySelector('.nav-logo');
  if (navLogo) navLogo.textContent = g('nav', 'logo');
  const navCcbl = document.querySelector('.nav-links a');
  if (navCcbl) { navCcbl.textContent = g('nav', 'ccblText'); navCcbl.href = g('nav', 'ccblHref'); }

  // Hero
  const heroLabels = document.querySelectorAll('#hero .section-label');
  if (heroLabels[0]) heroLabels[0].textContent = g('hero', 'label1');
  if (heroLabels[1]) heroLabels[1].textContent = g('hero', 'label2');
  const words = document.querySelectorAll('#hero .word');
  if (words[0]) words[0].textContent = g('hero', 'word1');
  if (words[1]) words[1].textContent = g('hero', 'word2');
  if (words[2]) words[2].textContent = g('hero', 'word3');
  const tagline = document.querySelector('#hero .hero-tagline');
  if (tagline) tagline.textContent = g('hero', 'tagline');
  const subHead = document.querySelector('#hero .hero-sub-heading');
  if (subHead) subHead.innerHTML = g('hero', 'subHeading').replace(/\n/g, '<br>');
  const subBody = document.querySelector('#hero .hero-sub-body');
  if (subBody) subBody.textContent = g('hero', 'subBody');

  // Intro video
  const introSrc = document.querySelector('.intro-video source');
  if (introSrc && g('introVideo', 'url')) {
    introSrc.src = g('introVideo', 'url');
    introSrc.parentElement.load();
  }

  // Alt rows
  const altRows = document.querySelectorAll('.alt-row');
  [['row1', altRows[0]], ['row2', altRows[1]]].forEach(([key, row]) => {
    if (!row) return;
    const h = row.querySelector('.alt-heading');
    const b = row.querySelector('.alt-body');
    const v = row.querySelector('video');
    if (h) h.textContent = g(key, 'heading');
    if (b) b.textContent = g(key, 'body');
    if (v) {
      const src = v.querySelector('source');
      if (src) { src.src = g(key, 'videoUrl'); }
      v.poster = g(key, 'poster');
      v.load();
    }
  });

  // Scroll sections 002–004
  const contentSections = document.querySelectorAll('.scroll-section.section-content');
  ['s002', 's003', 's004'].forEach((key, i) => {
    const sec = contentSections[i];
    if (!sec) return;
    const lbl = sec.querySelector('.section-label');
    const hd  = sec.querySelector('.section-heading');
    const bd  = sec.querySelector('.section-body');
    if (lbl) lbl.textContent = g(key, 'label');
    if (hd)  hd.innerHTML    = g(key, 'heading').replace(/\n/g, '<br>');
    if (bd)  bd.textContent  = g(key, 'body');
  });

  // CTA section
  const cta = document.querySelector('.section-cta');
  if (cta) {
    const lbl = cta.querySelector('.section-label');
    const hd  = cta.querySelector('.section-heading');
    const bd  = cta.querySelector('.section-body');
    const btn = cta.querySelector('.cta-button');
    if (lbl) lbl.textContent = g('s005', 'label');
    if (hd)  hd.innerHTML    = g('s005', 'heading').replace(/\n/g, '<br>');
    if (bd)  bd.textContent  = g('s005', 'body');
    if (btn) { btn.textContent = g('s005', 'buttonText'); btn.href = g('s005', 'buttonHref'); }
  }

  // Marquees
  const marquees = document.querySelectorAll('.marquee-text');
  const m1 = String(gTop('marquee1'));
  const m2 = String(gTop('marquee2'));
  if (marquees[0]) marquees[0].textContent = `${m1}   \u00A0\u00A0\u00A0 ${m1}   \u00A0\u00A0\u00A0 ${m1}   `;
  if (marquees[1]) marquees[1].textContent = `${m2}   \u00A0\u00A0\u00A0 ${m2}   \u00A0\u00A0\u00A0 ${m2}   `;

  // Footer copyright
  const copy = document.querySelector('.footer-bottom span');
  if (copy && c.footer && c.footer.copyright) copy.textContent = c.footer.copyright;
}

/* ── Load content from Firestore (public read) ───────────────────────────── */
async function loadContent() {
  try {
    const res  = await fetch('https://firestore.googleapis.com/v1/projects/systems-hub/databases/(default)/documents/tastePolynesia/siteContent');
    if (!res.ok) return;
    const json = await res.json();
    if (!json.fields) return;
    const content = {};
    for (const [k, v] of Object.entries(json.fields)) {
      content[k] = fromFsValue(v);
    }
    window._tpContent = content;
    applyContent(content);
  } catch (_) {
    window._tpContent = {};
  }
}

/* ── HTML helpers ────────────────────────────────────────────────────────── */
function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function field(key, label, value) {
  return `<div class="tp-field"><label>${label}</label><input type="text" data-key="${key}" value="${escHtml(value)}"></div>`;
}
function textarea(key, label, value) {
  return `<div class="tp-field"><label>${label}</label><textarea data-key="${key}" rows="3">${escHtml(value)}</textarea></div>`;
}

/* ── Build admin panel HTML ──────────────────────────────────────────────── */
function buildPanel(user) {
  const c   = window._tpContent || {};
  const g   = (sec, key) => {
    const def = DEFAULTS[sec];
    if (typeof def === 'object') return (c[sec] && c[sec][key] !== undefined) ? c[sec][key] : def[key];
    return c[sec] !== undefined ? c[sec] : def;
  };
  const gTop = key => c[key] !== undefined ? c[key] : DEFAULTS[key];

  return `
<div id="tp-admin-overlay">
  <div id="tp-admin-panel">

    <div id="tp-admin-header">
      <span id="tp-admin-title">SITE EDITOR</span>
      <div id="tp-admin-user-row">
        <span id="tp-admin-user-email">${escHtml(user.email)}</span>
        <button id="tp-admin-signout">Sign Out</button>
      </div>
      <button id="tp-admin-close">&#x2715;</button>
    </div>

    <div id="tp-admin-tabs">
      <button class="tp-tab active" data-tab="nav">Nav</button>
      <button class="tp-tab" data-tab="hero">Hero</button>
      <button class="tp-tab" data-tab="videos">Videos</button>
      <button class="tp-tab" data-tab="sections">Sections</button>
      <button class="tp-tab" data-tab="cta">CTA</button>
      <button class="tp-tab" data-tab="misc">Misc</button>
    </div>

    <div id="tp-admin-body">

      <!-- NAV -->
      <div class="tp-section" data-tab="nav">
        ${field('nav.logo',     'Logo Text',      g('nav', 'logo'))}
        ${field('nav.ccblText', 'CCBL Link Text', g('nav', 'ccblText'))}
        ${field('nav.ccblHref', 'CCBL Link URL',  g('nav', 'ccblHref'))}
      </div>

      <!-- HERO -->
      <div class="tp-section hidden" data-tab="hero">
        ${field('hero.label1',     'Left Label',                      g('hero', 'label1'))}
        ${field('hero.word1',      'Heading Word 1',                  g('hero', 'word1'))}
        ${field('hero.word2',      'Heading Word 2',                  g('hero', 'word2'))}
        ${field('hero.word3',      'Heading Word 3',                  g('hero', 'word3'))}
        ${field('hero.tagline',    'Tagline',                         g('hero', 'tagline'))}
        ${field('hero.label2',     'Right Label',                     g('hero', 'label2'))}
        ${field('hero.subHeading', 'Right Heading  (\\n = line break)', g('hero', 'subHeading'))}
        ${textarea('hero.subBody', 'Right Body Text',                 g('hero', 'subBody'))}
      </div>

      <!-- VIDEOS -->
      <div class="tp-section hidden" data-tab="videos">
        <div class="tp-group-label">Intro Video</div>
        ${field('introVideo.url', 'Video URL', g('introVideo', 'url'))}

        <div class="tp-group-label">Row 1 — The Ground Oven</div>
        ${field('row1.heading',  'Heading',          g('row1', 'heading'))}
        ${textarea('row1.body', 'Body Text',         g('row1', 'body'))}
        ${field('row1.videoUrl', 'Video URL',        g('row1', 'videoUrl'))}
        ${field('row1.poster',   'Poster Image URL', g('row1', 'poster'))}

        <div class="tp-group-label">Row 2 — Hot Rocks</div>
        ${field('row2.heading',  'Heading',          g('row2', 'heading'))}
        ${textarea('row2.body', 'Body Text',         g('row2', 'body'))}
        ${field('row2.videoUrl', 'Video URL',        g('row2', 'videoUrl'))}
        ${field('row2.poster',   'Poster Image URL', g('row2', 'poster'))}
      </div>

      <!-- SECTIONS -->
      <div class="tp-section hidden" data-tab="sections">
        <div class="tp-group-label">Section 002 — Experience</div>
        ${field('s002.label',   'Label',                        g('s002', 'label'))}
        ${field('s002.heading', 'Heading  (\\n = line break)',  g('s002', 'heading'))}
        ${textarea('s002.body', 'Body',                         g('s002', 'body'))}

        <div class="tp-group-label">Section 003 — Leadership</div>
        ${field('s003.label',   'Label',                        g('s003', 'label'))}
        ${field('s003.heading', 'Heading  (\\n = line break)',  g('s003', 'heading'))}
        ${textarea('s003.body', 'Body',                         g('s003', 'body'))}

        <div class="tp-group-label">Section 004 — Heritage</div>
        ${field('s004.label',   'Label',                        g('s004', 'label'))}
        ${field('s004.heading', 'Heading  (\\n = line break)',  g('s004', 'heading'))}
        ${textarea('s004.body', 'Body',                         g('s004', 'body'))}
      </div>

      <!-- CTA -->
      <div class="tp-section hidden" data-tab="cta">
        <div class="tp-group-label">Section 005 — CTA Block</div>
        ${field('s005.label',      'Label',                       g('s005', 'label'))}
        ${field('s005.heading',    'Heading  (\\n = line break)', g('s005', 'heading'))}
        ${textarea('s005.body',    'Body',                        g('s005', 'body'))}
        ${field('s005.buttonText', 'Button Text',                 g('s005', 'buttonText'))}
        ${field('s005.buttonHref', 'Button URL',                  g('s005', 'buttonHref'))}
      </div>

      <!-- MISC -->
      <div class="tp-section hidden" data-tab="misc">
        ${field('marquee1', 'Marquee 1 Text', gTop('marquee1'))}
        ${field('marquee2', 'Marquee 2 Text', gTop('marquee2'))}
        <div class="tp-group-label">Footer</div>
        ${field('footer.copyright', 'Copyright Text', g('footer', 'copyright'))}
      </div>

    </div>

    <div id="tp-admin-footer">
      <span id="tp-admin-status"></span>
      <button id="tp-admin-save">Save Changes</button>
    </div>

  </div>
</div>`;
}

/* ── Collect all form values ─────────────────────────────────────────────── */
function collectFormData() {
  const data = {};
  document.querySelectorAll('#tp-admin-panel [data-key]').forEach(el => {
    const parts = el.dataset.key.split('.');
    if (parts.length === 1) {
      data[parts[0]] = el.value;
    } else {
      if (!data[parts[0]]) data[parts[0]] = {};
      data[parts[0]][parts[1]] = el.value;
    }
  });
  return data;
}

/* ── Serialise to Firestore REST format ─────────────────────────────────── */
function toFsValue(v) {
  if (v !== null && typeof v === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, vv]) => [k, toFsValue(vv)])) } };
  }
  return { stringValue: String(v) };
}

/* ── Open admin panel ────────────────────────────────────────────────────── */
function openAdminPanel(user) {
  document.getElementById('tp-admin-overlay')?.remove();
  document.body.insertAdjacentHTML('beforeend', buildPanel(user));

  // Tab switching
  document.querySelectorAll('.tp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tp-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tp-section').forEach(s => s.classList.add('hidden'));
      btn.classList.add('active');
      document.querySelector(`.tp-section[data-tab="${btn.dataset.tab}"]`).classList.remove('hidden');
    });
  });

  // Close
  const close = () => document.getElementById('tp-admin-overlay')?.remove();
  document.getElementById('tp-admin-close').addEventListener('click', close);
  document.getElementById('tp-admin-overlay').addEventListener('click', e => {
    if (e.target.id === 'tp-admin-overlay') close();
  });

  // Sign out
  document.getElementById('tp-admin-signout').addEventListener('click', async () => {
    const { auth } = getFirebase();
    await auth.signOut();
    close();
  });

  // Save
  document.getElementById('tp-admin-save').addEventListener('click', async () => {
    const saveBtn = document.getElementById('tp-admin-save');
    const status  = document.getElementById('tp-admin-status');
    saveBtn.disabled = true;
    status.textContent = 'Saving\u2026';
    status.style.color = '#c9b89a';
    try {
      const { auth } = getFirebase();
      const token   = await auth.currentUser.getIdToken();
      const data    = collectFormData();
      const fields  = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toFsValue(v)]));

      const url = 'https://firestore.googleapis.com/v1/projects/systems-hub/databases/(default)/documents/tastePolynesia/siteContent';
      const res = await fetch(url, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ fields }),
      });
      if (!res.ok) throw new Error((await res.json())?.error?.message || res.statusText);

      window._tpContent = data;
      applyContent(data);
      status.textContent = 'Saved!';
      status.style.color = '#8a9e7a';
      setTimeout(() => { status.textContent = ''; }, 3000);
    } catch (err) {
      status.textContent = 'Error: ' + err.message;
      status.style.color = '#e07070';
    } finally {
      saveBtn.disabled = false;
    }
  });
}

/* ── Sign-in modal ───────────────────────────────────────────────────────── */
function showSignIn() {
  const overlay = document.createElement('div');
  overlay.id = 'tp-signin-overlay';
  overlay.innerHTML = `
    <div id="tp-signin-box">
      <div id="tp-signin-title">TASTE POLYNESIA</div>
      <div id="tp-signin-sub">Admin Access</div>
      <button id="tp-google-btn">
        <svg width="18" height="18" viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.8 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6.1C12.4 13.1 17.8 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.6-4.8 7.3l7.5 5.8C43.7 37.3 46.5 31.3 46.5 24.5z"/>
          <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6L2.7 13.3A23.8 23.8 0 0 0 0 24c0 3.9.9 7.6 2.7 10.8l7.8-6.1z"/>
          <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.2 0-11.5-4.2-13.5-9.9l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/>
        </svg>
        Sign in with Google
      </button>
      <div id="tp-signin-error"></div>
      <button id="tp-signin-close">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('tp-signin-close').addEventListener('click', () => overlay.remove());

  document.getElementById('tp-google-btn').addEventListener('click', async () => {
    const { auth }   = getFirebase();
    const provider   = new firebase.auth.GoogleAuthProvider();
    const errEl      = document.getElementById('tp-signin-error');
    errEl.textContent = '';
    try {
      const result = await auth.signInWithPopup(provider);
      if (result.user.email !== ADMIN_EMAIL) {
        await auth.signOut();
        errEl.textContent = 'Access denied — unauthorized account.';
        return;
      }
      overlay.remove();
      openAdminPanel(result.user);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

/* ── Boot ────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  loadContent();

  const trigger = document.getElementById('admin-trigger');
  if (!trigger) return;

  trigger.addEventListener('click', async e => {
    e.preventDefault();
    const { auth } = getFirebase();
    // Resolve current auth state, then decide
    const user = await new Promise(resolve => {
      const unsub = auth.onAuthStateChanged(u => { unsub(); resolve(u); });
    });
    if (user && user.email === ADMIN_EMAIL) {
      openAdminPanel(user);
    } else {
      showSignIn();
    }
  });
});
