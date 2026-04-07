/* â”€â”€ app.js â€” PCC Culinary scroll-driven page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/* â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const FRAME_TOTAL  = 121;
const FRAME_STEP   = 1;
const FRAME_COUNT  = Math.ceil(FRAME_TOTAL / FRAME_STEP);
const FRAME_SPEED  = 1.0;
const FADE_RANGE   = 0.04;   // crossfade width on each side of the canvas swap threshold
const IMAGE_SCALE  = 1.0;
const FRAME_PATH   = '/animations/samples/01/frames/frame_';

/* â”€â”€ Element refs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const loader          = document.getElementById('loader');
const loaderBar       = document.getElementById('loader-bar');
const loaderPercent   = document.getElementById('loader-percent');
const canvas          = document.getElementById('canvas');
const ctx             = canvas.getContext('2d');
const canvasWrap      = document.getElementById('canvas-wrap');
const darkOverlay     = document.getElementById('dark-overlay');
const heroSection     = document.getElementById('hero');
const scrollContainer = document.getElementById('scroll-container');

/* â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const frames = new Array(FRAME_COUNT).fill(null);
let currentFrame = 0;
let bgColor      = '#f8f5f0';

/* â”€â”€ Utility: zero-padded frame index â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function padIdx(i) { return String(i + 1).padStart(4, '0'); }

/* â”€â”€ Canvas sizing with devicePixelRatio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const cw  = window.innerWidth;
  const ch  = window.innerHeight;
  canvas.width        = cw * dpr;
  canvas.height       = ch * dpr;
  canvas.style.width  = cw + 'px';
  canvas.style.height = ch + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  drawFrame(currentFrame);
}
window.addEventListener('resize', () => {
  resizeCanvas();
  if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
});

/* â”€â”€ Background color sampler â”€â”€â”€â”€â”€ */
function sampleBgColor(img) {
  const tmp = document.createElement('canvas');
  tmp.width = 10; tmp.height = 10;
  const tc = tmp.getContext('2d');
  if (!tc) return;
  tc.drawImage(img, 0, 0, 10, 10);
  const d = tc.getImageData(0, 0, 1, 1).data;
  bgColor = `rgb(${d[0]},${d[1]},${d[2]})`;
}

/* â”€â”€ Draw a single frame â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function drawFrame(index) {
  const img = frames[index];
  if (!img) return;
  const cw = canvas.clientWidth  || window.innerWidth;
  const ch = canvas.clientHeight || window.innerHeight;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.max(cw / iw, ch / ih) * IMAGE_SCALE;
  const dw = iw * scale, dh = ih * scale;
  const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, dx, dy, dw, dh);
}

/* â”€â”€ Frame preloader â€” two-phase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function loadFrames(onComplete) {
  let loaded = 0;

  function onFrameLoad(i, img) {
    frames[i] = img;
    if (i % 20 === 0) sampleBgColor(img);
    if (i === 0) { resizeCanvas(); }  // first paint with frame 0
    loaded++;
    const pct = Math.round((loaded / FRAME_COUNT) * 100);
    loaderBar.style.width   = pct + '%';
    loaderPercent.textContent = pct + '%';
    if (loaded === FRAME_COUNT) onComplete();
  }

  // Phase 1: first 10 frames
  const phase1 = Math.min(10, FRAME_COUNT);
  let phase1Done = 0;

  for (let i = 0; i < phase1; i++) {
    const img = new Image();
    const idx = i;
    img.onload = function () {
      onFrameLoad(idx, img);
      phase1Done++;
      if (phase1Done === phase1) loadPhase2();
    };
    img.onerror = function () {
      phase1Done++;
      loaded++;
      if (phase1Done === phase1) loadPhase2();
      if (loaded === FRAME_COUNT) onComplete();
    };
    const realIndex = idx * FRAME_STEP;
    img.src = FRAME_PATH + padIdx(realIndex) + '.webp';
  }

  // Phase 2: remaining frames
  function loadPhase2() {
    for (let i = phase1; i < FRAME_COUNT; i++) {
      const img = new Image();
      const idx = i;
      img.onload = function () { onFrameLoad(idx, img); };
      img.onerror = function () {
        loaded++;
        if (loaded === FRAME_COUNT) onComplete();
      };
      const realIndex = idx * FRAME_STEP;
      img.src = FRAME_PATH + padIdx(realIndex) + '.webp';
    }
  }
}

/* â”€â”€ Hide loader â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function hideLoader() {
  gsap.to(loader, {
    opacity: 0, duration: 0.7, ease: 'power2.out',
    onComplete() { loader.style.display = 'none'; }
  });
}

/* â”€â”€ 6a. Lenis smooth scroll â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function initLenis() {
  const lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* â”€â”€ Hero word entrance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function initHeroEntrance() {
  const words    = heroSection.querySelectorAll('.word');
  const labels   = heroSection.querySelectorAll('.section-label');
  const tagline  = heroSection.querySelector('.hero-tagline');
  const scrollInd = heroSection.querySelector('.scroll-indicator');
  const subHead  = heroSection.querySelector('.hero-sub-heading');
  const subBody  = heroSection.querySelector('.hero-sub-body');

  gsap.from(words, {
    y: 90, opacity: 0, stagger: 0.14,
    duration: 1.2, ease: 'power3.out', delay: 0.3,
  });
  gsap.from([...labels, tagline, scrollInd, subHead, subBody].filter(Boolean), {
    opacity: 0, y: 20, stagger: 0.08,
    duration: 0.9, ease: 'power2.out', delay: 0.9,
  });
}

/* â”€â”€ 6i. Circle-wipe hero reveal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function initHeroTransition() {
  ScrollTrigger.create({
    trigger: scrollContainer,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const p = self.progress;
      // Hero fades out
      heroSection.style.opacity = Math.max(0, 1 - Math.max(0, p - 0.03) * 25);
      // Canvas circle wipe
      const wipeProgress = Math.min(1, Math.max(0, (p - 0.02) / 0.07));
      const radius = wipeProgress * 80;
      canvasWrap.style.clipPath = `circle(${radius}% at 50% 50%)`;
    }
  });
}

/* â”€â”€ 6d. Frame-to-scroll binding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function initFrameScroll() {
  ScrollTrigger.create({
    trigger: scrollContainer,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const accelerated = Math.min(self.progress * FRAME_SPEED, 1);
      const index = Math.min(Math.floor(accelerated * FRAME_COUNT), FRAME_COUNT - 1);
      if (index !== currentFrame) {
        currentFrame = index;
        requestAnimationFrame(() => drawFrame(currentFrame));
      }
      // canvas2 fades itself in at the start of scroll-container-2
    }
  });
}

/* â”€â”€ Section positioning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function positionSections() {
  document.querySelectorAll('.scroll-section').forEach(section => {
    const enter = parseFloat(section.dataset.enter);
    const leave = parseFloat(section.dataset.leave);
    const mid   = (enter + leave) / 2;
    section.style.top       = mid + '%';
    section.style.transform = 'translateY(-50%)';
  });
}

/* Section animation builder (shared) */
function buildSectionItems(container) {
  const items = [];
  container.querySelectorAll('.scroll-section').forEach(section => {
    const persist = section.dataset.persist === 'true';
    const enter   = parseFloat(section.dataset.enter) / 100;
    const leave   = parseFloat(section.dataset.leave) / 100;
    const wrapper = section.querySelector('.section-inner, .sq-quote');
    const startY  = window.innerHeight * 0.75; // push fully below viewport
    if (wrapper) gsap.set(wrapper, { y: startY, opacity: 0 });
    items.push({ section, wrapper, enter, leave, persist, startY });
  });
  return items;
}

function bindSectionScrollTrigger(trigger, items) {
  ScrollTrigger.create({
    trigger,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const p = self.progress;
      items.forEach(({ section, wrapper, enter, leave, persist, startY }) => {
        if (!wrapper) return;
        const pastLeave = p > leave;

        if (p >= enter && p <= leave) {
          const raw     = (p - enter) / (leave - enter);     // 0 → 1 across zone
          const tOpacity = Math.min(1, raw * 5);             // full color at 20% of zone
          const tMove    = Math.min(1, raw * (1 / 0.6));     // fully settled at 60% of zone
          const easeMove = tMove * tMove * (3 - 2 * tMove);  // smoothstep for movement
          gsap.set(wrapper, { y: startY * (1 - easeMove), opacity: tOpacity });
          section.classList.add('visible');

        } else if (persist && pastLeave) {
          gsap.set(wrapper, { y: 0, opacity: 1 });
          section.classList.add('visible');

        } else if (p < enter) {
          gsap.set(wrapper, { y: startY, opacity: 0 });
          section.classList.remove('visible');

        } else if (pastLeave && !persist) {
          gsap.set(wrapper, { y: 0, opacity: 0 });
          section.classList.remove('visible');
        }
      });
    }
  });
}

function initSections() {
  bindSectionScrollTrigger(scrollContainer, buildSectionItems(scrollContainer));
}

function initSections2() {
  if (!scrollContainer2) return;
  bindSectionScrollTrigger(scrollContainer2, buildSectionItems(scrollContainer2));
}


/* â”€â”€ Populate gallery from Firestore â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function populateGalleryTracks(items) {
  const rows = { 1: document.querySelectorAll('.gallery-row')[0], 2: document.querySelectorAll('.gallery-row')[1] };
  [1, 2].forEach(rowNum => {
    const row = rows[rowNum];
    if (!row) return;
    const track = row.querySelector('.gallery-track');
    if (!track) return;
    const rowItems = items.filter(i => i.row === rowNum);
    if (!rowItems.length) return;
    track.innerHTML = '';
    rowItems.forEach(item => {
      if (item.type === 'video') {
        const v = document.createElement('video');
        v.src = item.url; v.muted = true; v.loop = true;
        v.playsInline = true; v.autoplay = true;
        track.appendChild(v);
      } else {
        const img = document.createElement('img');
        img.src = item.url; img.alt = item.name || '';
        track.appendChild(img);
      }
    });
  });
}

async function loadGalleryFromFirestore() {
  try {
    const PROJECT = 'systems-hub';
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/directory_gallery?orderBy=uploadedAt`;
    const res  = await fetch(url);
    if (!res.ok) return;
    const json = await res.json();
    if (!json.documents?.length) return;
    const items = json.documents.map(d => {
      const f = d.fields || {};
      return {
        id:          d.name.split('/').pop(),
        url:         f.url?.stringValue         || '',
        storagePath: f.storagePath?.stringValue || '',
        type:        f.type?.stringValue        || 'photo',
        name:        f.name?.stringValue        || '',
        row:         Number(f.row?.integerValue  || f.row?.doubleValue || 1),
      };
    }).filter(i => i.url);
    if (items.length) populateGalleryTracks(items);
  } catch (_) { /* fall back to hardcoded frames */ }
}

/* â”€â”€ Gallery slider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function initGallerySlider() {
  document.querySelectorAll('.gallery-row').forEach(row => {
    const track = row.querySelector('.gallery-track');
    if (!track) return;

    const dir = row.dataset.dir === 'left' ? -1 : 1;  // +1 = right, -1 = left
    const origImgs = [...track.querySelectorAll('img')];
    const n = origImgs.length;

    // Triple the images: [set1, set2, set3] â€” start in the middle (set2)
    origImgs.forEach(img => track.appendChild(img.cloneNode(true)));
    origImgs.forEach(img => track.appendChild(img.cloneNode(true)));

    let pos = 0;

    function getItemW() {
      const img = track.querySelector('img');
      return img ? img.offsetWidth + 16 : 300; // 16px = 1rem gap
    }

    function init() {
      track.style.transition = 'none';
      pos = -(n * getItemW()); // show the middle set
      track.style.transform = `translateX(${pos}px)`;
    }

    function slide() {
      const itemW  = getItemW();
      const totalW = n * itemW;

      pos += dir * itemW;
      track.style.transition = 'transform 0.85s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      track.style.transform = `translateX(${pos}px)`;

      // Silent loop reset after transition completes
      setTimeout(() => {
        if (pos > 0) {                    // right dir went past start
          track.style.transition = 'none';
          pos -= totalW;
          track.style.transform = `translateX(${pos}px)`;
        } else if (pos < -(2 * totalW)) { // left dir went past end
          track.style.transition = 'none';
          pos += totalW;
          track.style.transform = `translateX(${pos}px)`;
        }
      }, 900);
    }

    setTimeout(init, 80);
    setInterval(slide, 2850); // 2 s freeze + 0.85 s slide
    window.addEventListener('resize', () => setTimeout(init, 50));
  });
}

/* â”€â”€ 6g. Marquee â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function initMarquees() {
  // Horizontal slide â€” alternate directions
  document.querySelectorAll('.marquee-wrap').forEach((wrap, i) => {
    const speed = i === 0 ? -22 : -14;
    gsap.to(wrap.querySelector('.marquee-text'), {
      xPercent: speed,
      ease: 'none',
      scrollTrigger: {
        trigger: scrollContainer,
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
      }
    });
  });

  // Fade marquees in (after circle-wipe) and out (near end)
  ScrollTrigger.create({
    trigger: scrollContainer,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const p = self.progress;
      let opacity = 0;
      if      (p >= 0.07 && p < 0.15) opacity = (p - 0.07) / 0.08;
      else if (p >= 0.15 && p < 0.83) opacity = 1;
      else if (p >= 0.83 && p < 0.93) opacity = 1 - (p - 0.83) / 0.10;
      document.querySelectorAll('.marquee-wrap').forEach(m => {
        m.style.opacity = opacity;
      });
    }
  });
}

/* â”€â”€ 6h. Dark overlay + canvas hide â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function initDarkOverlay() {
  const enter = 0.66, leave = 0.84;
  const fadeRange = 0.04;
  ScrollTrigger.create({
    trigger: scrollContainer,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const p = self.progress;

      // Dark overlay opacity
      let opacity = 0;
      if (p >= enter - fadeRange && p <= enter) {
        opacity = (p - (enter - fadeRange)) / fadeRange;
      } else if (p > enter && p < leave) {
        opacity = 0.9;
      } else if (p >= leave && p <= leave + fadeRange) {
        opacity = 0.9 * (1 - (p - leave) / fadeRange);
      }
      darkOverlay.style.opacity = opacity;
    }
  });
}

/* ── 6j. End of scroll animation ───────────────────────────────────────────── */
function initScrollEnd() {
  ScrollTrigger.create({
    trigger: scrollContainer,
    start: 'bottom bottom',
    onEnter: () => document.body.classList.add('scroll-complete'),
    onLeaveBack: () => document.body.classList.remove('scroll-complete'),
  });
}

/* ── Init sequence (runs after all frames are loaded) ───────────────────── */
async function init() {
  gsap.registerPlugin(ScrollTrigger);

  // Load gallery from Firestore (replaces hardcoded frames if items exist)
  await loadGalleryFromFirestore();

  // Position sections before ScrollTrigger reads their offsets
  positionSections();

  initLenis();
  resizeCanvas();
  initHeroEntrance();
  initHeroTransition();
  initFrameScroll();
  initSections();
  initSections2();
  initGallerySlider();
  initMarquees();
  initDarkOverlay();
  initScrollEnd();
}

/* ── Second animation (mirrors animation 1 exactly) ───────────────────────── */
  const FRAME2_TOTAL = 96;
const FRAME2_STEP  = 1;
const FRAME2_COUNT = Math.ceil(FRAME2_TOTAL / FRAME2_STEP);
const FRAME2_SPEED = 1.053;
  const FRAME2_PATH  = '/animations/samples/02/frames/frame_';
  const FRAME2_VERSION = '20260406b';

const canvas2Wrap      = document.getElementById('canvas2-wrap');
const canvas2          = document.getElementById('canvas2');
const ctx2             = canvas2 ? canvas2.getContext('2d') : null;
const scrollContainer2 = document.getElementById('scroll-container-2');

const frames2       = new Array(FRAME2_COUNT).fill(null);
let   currentFrame2 = 0;
let   bgColor2      = '#000000';

function padIdx2(i) { return String(i * FRAME2_STEP + 1).padStart(4, '0'); }

function resizeCanvas2() {
  if (!canvas2 || !ctx2) return;
  const dpr = window.devicePixelRatio || 1;
  const cw  = window.innerWidth, ch = window.innerHeight;
  canvas2.width        = cw * dpr;
  canvas2.height       = ch * dpr;
  canvas2.style.width  = cw + 'px';
  canvas2.style.height = ch + 'px';
  ctx2.setTransform(1, 0, 0, 1, 0, 0);
  ctx2.scale(dpr, dpr);
  drawFrame2(currentFrame2);
}

function sampleBgColor2(img) {
  const tmp = document.createElement('canvas');
  tmp.width = 10; tmp.height = 10;
  const tc = tmp.getContext('2d');
  if (!tc) return;
  tc.drawImage(img, 0, 0, 10, 10);
  const d = tc.getImageData(0, 0, 1, 1).data;
  bgColor2 = `rgb(${d[0]},${d[1]},${d[2]})`;
}

function drawFrame2(index) {
  if (!ctx2 || !canvas2) return;
  const img = frames2[index];
  if (!img) return;
  const cw = canvas2.clientWidth  || window.innerWidth;
  const ch = canvas2.clientHeight || window.innerHeight;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.max(cw / iw, ch / ih) * IMAGE_SCALE;
  const dw = iw * scale, dh = ih * scale;
  const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
  ctx2.fillStyle = bgColor2;
  ctx2.fillRect(0, 0, cw, ch);
  ctx2.drawImage(img, dx, dy, dw, dh);
}

function loadFrames2(onComplete) {
  let loaded = 0;

  function onFrameLoad2(i, img) {
    frames2[i] = img;
    if (i % 20 === 0) sampleBgColor2(img);
    if (i === 0) resizeCanvas2();
    loaded++;
    if (loaded === FRAME2_COUNT) onComplete();
  }

  const phase1 = Math.min(10, FRAME2_COUNT);
  let phase1Done = 0;

  for (let i = 0; i < phase1; i++) {
    const img = new Image();
    const idx = i;
    img.onload  = function () { onFrameLoad2(idx, img); phase1Done++; if (phase1Done === phase1) loadPhase2_2(); };
    img.onerror = function () { phase1Done++; loaded++; if (phase1Done === phase1) loadPhase2_2(); if (loaded === FRAME2_COUNT) onComplete(); };
    img.src = FRAME2_PATH + padIdx2(idx) + '.webp?v=' + FRAME2_VERSION;
  }

  function loadPhase2_2() {
    for (let i = phase1; i < FRAME2_COUNT; i++) {
      const img = new Image();
      const idx = i;
      img.onload  = function () { onFrameLoad2(idx, img); };
      img.onerror = function () { loaded++; if (loaded === FRAME2_COUNT) onComplete(); };
      img.src = FRAME2_PATH + padIdx2(idx) + '.webp?v=' + FRAME2_VERSION;
    }
  }
}

function initCanvas2() {
  if (!canvas2 || !canvas2Wrap || !scrollContainer2) return;
  resizeCanvas2();
  window.addEventListener('resize', () => { resizeCanvas2(); ScrollTrigger.refresh(); });

  ScrollTrigger.create({
    trigger: scrollContainer2,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      // Fade in over first 5% of container-2 scroll
      canvas2Wrap.style.opacity = String(Math.min(1, self.progress / 0.05));

      const accelerated = Math.min(self.progress * FRAME2_SPEED, 1);
      const index = Math.min(Math.floor(accelerated * FRAME2_COUNT), FRAME2_COUNT - 1);
      if (index !== currentFrame2) {
        currentFrame2 = index;
        requestAnimationFrame(() => drawFrame2(currentFrame2));
      }
    },
  });
}

/* ── Boot ──────────────────────────────────────────────────────────────────── */

// Force intro video to play on mobile (browsers may ignore autoplay attribute)
const introVideo = document.querySelector('.intro-video');
if (introVideo) {
  const tryPlay = () => introVideo.play().catch(() => {});
  tryPlay();
  document.addEventListener('touchstart', tryPlay, { once: true });
}

loadFrames(() => {
  hideLoader();
  init();
});

loadFrames2(() => {
  if (typeof ScrollTrigger !== 'undefined') {
    initCanvas2();
  } else {
    window.addEventListener('load', initCanvas2);
  }
});

