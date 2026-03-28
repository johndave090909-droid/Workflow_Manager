/* ── app.js — PCC Culinary scroll-driven page ──────────────────────────── */

/* ── Constants ──────────────────────────────────────────────────────────── */
const FRAME_COUNT  = 192;
const FRAME_SPEED  = 2.0;
const IMAGE_SCALE  = 0.87;
const FRAME_PATH   = '/frames/frame_';

/* ── Element refs ───────────────────────────────────────────────────────── */
const loader          = document.getElementById('loader');
const loaderBar       = document.getElementById('loader-bar');
const loaderPercent   = document.getElementById('loader-percent');
const canvas          = document.getElementById('canvas');
const ctx             = canvas.getContext('2d');
const canvasWrap      = document.getElementById('canvas-wrap');
const darkOverlay     = document.getElementById('dark-overlay');
const heroSection     = document.getElementById('hero');
const scrollContainer = document.getElementById('scroll-container');

/* ── State ──────────────────────────────────────────────────────────────── */
const frames = new Array(FRAME_COUNT).fill(null);
let currentFrame = 0;
let bgColor      = '#f8f5f0';

/* ── Utility: zero-padded frame index ───────────────────────────────────── */
function padIdx(i) { return String(i + 1).padStart(4, '0'); }

/* ── Canvas sizing with devicePixelRatio ────────────────────────────────── */
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const cw  = canvasWrap.clientWidth  || window.innerWidth  * 0.5;
  const ch  = canvasWrap.clientHeight || window.innerHeight;
  canvas.width        = cw * dpr;
  canvas.height       = ch * dpr;
  canvas.style.width  = cw + 'px';
  canvas.style.height = ch + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  drawFrame(currentFrame);
}
window.addEventListener('resize', resizeCanvas);

/* ── Background color sampler (no longer used — CSS controls body bg) ───── */
function sampleBgColor(_img) { /* no-op */ }

/* ── Draw a single frame ─────────────────────────────────────────────────── */
function drawFrame(index) {
  const img = frames[index];
  if (!img) return;
  const cw = canvas.clientWidth  || canvasWrap.clientWidth  || window.innerWidth  * 0.5;
  const ch = canvas.clientHeight || canvasWrap.clientHeight || window.innerHeight;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.min(cw / iw, ch / ih) * 0.82;
  const dw = iw * scale, dh = ih * scale;
  const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
  ctx.clearRect(0, 0, cw, ch);  // transparent — body background shows through border
  ctx.drawImage(img, dx, dy, dw, dh);
  // Cover the white watermark area in the bottom-right corner of the frame
  ctx.fillStyle = '#f7f5f0';
  ctx.fillRect(dx + dw * 0.82, dy + dh * 0.79, dw * 0.18, dh * 0.21);
}

/* ── Frame preloader — two-phase ────────────────────────────────────────── */
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
    img.src = FRAME_PATH + padIdx(i) + '.webp';
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
      img.src = FRAME_PATH + padIdx(i) + '.webp';
    }
  }
}

/* ── Hide loader ─────────────────────────────────────────────────────────── */
function hideLoader() {
  gsap.to(loader, {
    opacity: 0, duration: 0.7, ease: 'power2.out',
    onComplete() { loader.style.display = 'none'; }
  });
}

/* ── 6a. Lenis smooth scroll ────────────────────────────────────────────── */
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

/* ── Hero word entrance ─────────────────────────────────────────────────── */
function initHeroEntrance() {
  const words   = heroSection.querySelectorAll('.word');
  const label   = heroSection.querySelector('.section-label');
  const tagline = heroSection.querySelector('.hero-tagline');
  const scrollInd = heroSection.querySelector('.scroll-indicator');

  gsap.from(words, {
    y: 90, opacity: 0, stagger: 0.14,
    duration: 1.2, ease: 'power3.out', delay: 0.3,
  });
  gsap.from([label, tagline, scrollInd], {
    opacity: 0, y: 20, stagger: 0.1,
    duration: 0.9, ease: 'power2.out', delay: 0.9,
  });
}

/* ── 6i. Circle-wipe hero reveal ────────────────────────────────────────── */
function initHeroTransition() {
  ScrollTrigger.create({
    trigger: scrollContainer,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const p = self.progress;
      // Hero fades out as scroll begins
      heroSection.style.opacity = Math.max(0, 1 - p * 15);
      // Canvas expands via circle clip-path (150% covers full half-panel)
      const wipeProgress = Math.min(1, Math.max(0, (p - 0.01) / 0.06));
      const radius = wipeProgress * 150;
      canvasWrap.style.clipPath = `circle(${radius}% at 50% 50%)`;
    }
  });
}

/* ── 6d. Frame-to-scroll binding ────────────────────────────────────────── */
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
    }
  });
}

/* ── Section positioning ────────────────────────────────────────────────── */
function positionSections() {
  document.querySelectorAll('.scroll-section').forEach(section => {
    const enter = parseFloat(section.dataset.enter);
    const leave = parseFloat(section.dataset.leave);
    const mid   = (enter + leave) / 2;
    section.style.top       = mid + '%';
    section.style.transform = 'translateY(-50%)';
  });
}

/* ── 6e. Section animation system ───────────────────────────────────────── */
function initSections() {
  const items = [];

  document.querySelectorAll('.scroll-section').forEach(section => {
    const type    = section.dataset.animation;
    const persist = section.dataset.persist === 'true';
    const enter   = parseFloat(section.dataset.enter) / 100;
    const leave   = parseFloat(section.dataset.leave) / 100;
    const children = section.querySelectorAll(
      '.section-label, .section-heading, .section-body, .cta-button, .stat'
    );

    const tl = gsap.timeline({ paused: true });

    switch (type) {
      case 'fade-up':
        tl.from(children, { y: 50, opacity: 0, stagger: 0.12, duration: 0.9, ease: 'power3.out' });
        break;
      case 'slide-left':
        tl.from(children, { x: -80, opacity: 0, stagger: 0.14, duration: 0.9, ease: 'power3.out' });
        break;
      case 'slide-right':
        tl.from(children, { x: 80, opacity: 0, stagger: 0.14, duration: 0.9, ease: 'power3.out' });
        break;
      case 'scale-up':
        tl.from(children, { scale: 0.85, opacity: 0, stagger: 0.12, duration: 1.0, ease: 'power2.out' });
        break;
      case 'rotate-in':
        tl.from(children, { y: 40, rotation: 3, opacity: 0, stagger: 0.1, duration: 0.9, ease: 'power3.out' });
        break;
      case 'stagger-up':
        tl.from(children, { y: 60, opacity: 0, stagger: 0.15, duration: 0.8, ease: 'power3.out' });
        break;
      case 'clip-reveal':
        tl.from(children, {
          clipPath: 'inset(100% 0 0 0)', opacity: 0,
          stagger: 0.15, duration: 1.2, ease: 'power4.inOut'
        });
        break;
    }

    items.push({ section, tl, enter, leave, persist });
  });

  ScrollTrigger.create({
    trigger: scrollContainer,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const p = self.progress;
      items.forEach(({ section, tl, enter, leave, persist }) => {
        const inZone = p >= enter && p <= leave;
        const pastLeave = p > leave;

        if (inZone || (persist && pastLeave)) {
          if (tl.progress() < 1) tl.play();
          section.classList.add('visible');
        } else if (p < enter) {
          if (tl.progress() > 0) tl.reverse();
          section.classList.remove('visible');
        } else if (pastLeave && !persist) {
          if (tl.progress() > 0) tl.reverse();
          section.classList.remove('visible');
        }
      });
    }
  });
}

/* ── Populate gallery from Firestore ────────────────────────────────────── */
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

/* ── Gallery slider ─────────────────────────────────────────────────────── */
function initGallerySlider() {
  document.querySelectorAll('.gallery-row').forEach(row => {
    const track = row.querySelector('.gallery-track');
    if (!track) return;

    const dir = row.dataset.dir === 'left' ? -1 : 1;  // +1 = right, -1 = left
    const origImgs = [...track.querySelectorAll('img')];
    const n = origImgs.length;

    // Triple the images: [set1, set2, set3] — start in the middle (set2)
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

/* ── 6g. Marquee ────────────────────────────────────────────────────────── */
function initMarquees() {
  // Horizontal slide — alternate directions
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

/* ── 6h. Dark overlay + canvas hide ─────────────────────────────────────── */
function initDarkOverlay() {
  const enter = 0.56, leave = 0.72;
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

      // Canvas fades out as dark section approaches, back in after it lifts
      let canvasOpacity = 1;
      if (p >= enter - fadeRange && p <= enter) {
        canvasOpacity = 1 - (p - (enter - fadeRange)) / fadeRange;
      } else if (p > enter && p < leave) {
        canvasOpacity = 0;
      } else if (p >= leave && p <= leave + fadeRange) {
        canvasOpacity = (p - leave) / fadeRange;
      }
      canvasWrap.style.opacity = canvasOpacity;
    }
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
  initGallerySlider();
  initMarquees();
  initDarkOverlay();
}

/* ── Boot ────────────────────────────────────────────────────────────────── */
loadFrames(() => {
  hideLoader();
  init();
});
