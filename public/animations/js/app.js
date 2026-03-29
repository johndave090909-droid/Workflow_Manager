/* Motion Samples — js/app.js */

gsap.registerPlugin(ScrollTrigger);

// ── Lenis smooth scroll ──────────────────────────────────
const lenis = new Lenis({
  duration: 1.2,
  easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  smoothWheel: true,
});
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add(time => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);

// ── HUD + progress bar ───────────────────────────────────
const hudNum  = document.getElementById('hud-num');
const hudName = document.getElementById('hud-name');
const bar     = document.getElementById('progress-bar');
const sections = document.querySelectorAll('.anim-section');

ScrollTrigger.create({
  trigger: document.body,
  start: 'top top',
  end: 'bottom bottom',
  onUpdate: self => {
    const pct = Math.round(self.progress * 100);
    bar.style.width = pct + '%';
  },
});

sections.forEach(sec => {
  ScrollTrigger.create({
    trigger: sec,
    start: 'top 60%',
    onEnter: () => {
      const color = sec.dataset.color;
      hudNum.textContent  = sec.dataset.n;
      hudName.textContent = sec.dataset.key;
      bar.style.background = color;
      hudNum.style.color   = color;
    },
  });
});

// ── Animation factory ────────────────────────────────────
function animateSection(sec) {
  const key      = sec.dataset.key;
  const color    = sec.dataset.color;
  const children = sec.querySelectorAll('.tag, .heading, .body-text, .code-badge, .params, .stagger-item, .counter-grid, .circle-inner');

  // Color accent on heading
  const heading = sec.querySelector('.heading');
  if (heading) heading.style.color = color;

  // Color on code-badge border
  const badge = sec.querySelector('.code-badge');
  if (badge) badge.style.borderColor = color + '40';

  const tl = gsap.timeline({ paused: true });

  switch (key) {

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
      tl.from(children, { y: 40, rotation: 3, opacity: 0, stagger: 0.10, duration: 0.9, ease: 'power3.out' });
      break;

    case 'stagger-up': {
      // tag + heading animate together, then each stagger-item separately
      const header = sec.querySelectorAll('.tag, .heading, .body-text');
      const items  = sec.querySelectorAll('.stagger-item');
      const foot   = sec.querySelectorAll('.code-badge, .params');
      tl.from(header, { y: 30, opacity: 0, stagger: 0.12, duration: 0.7, ease: 'power3.out' })
        .from(items,  { y: 60, opacity: 0, stagger: 0.15, duration: 0.8, ease: 'power3.out' }, '-=0.3')
        .from(foot,   { y: 20, opacity: 0, stagger: 0.1,  duration: 0.6, ease: 'power3.out' }, '-=0.2');
      break;
    }

    case 'clip-reveal':
      tl.from(children, {
        clipPath: 'inset(100% 0 0 0)',
        opacity: 0,
        stagger: 0.15,
        duration: 1.2,
        ease: 'power4.inOut',
      });
      break;

    case 'circle-wipe': {
      // Circle expands on scroll (scrubbed), content fades in
      const inner = sec.querySelector('.circle-inner');
      if (inner) {
        ScrollTrigger.create({
          trigger: sec,
          start: 'top 80%',
          end: 'center center',
          scrub: 1,
          onUpdate: self => {
            const r = self.progress * 75;
            inner.style.clipPath = `circle(${r}% at 50% 50%)`;
          },
        });
        tl.from(inner.querySelectorAll('.tag,.heading,.body-text'), {
          opacity: 0, y: 20, stagger: 0.1, duration: 0.8, ease: 'power2.out',
        });
      }
      const meta = sec.querySelectorAll('.code-badge, .params');
      tl.from(meta, { opacity: 0, y: 20, stagger: 0.1, duration: 0.6, ease: 'power2.out' }, '-=0.3');
      break;
    }

    case 'marquee':
      // Handled separately below — no tl needed here
      return;

    case 'counter': {
      const header = sec.querySelectorAll('.tag, .heading');
      tl.from(header, { y: 30, opacity: 0, stagger: 0.1, duration: 0.7, ease: 'power3.out' });
      break;
    }
  }

  // Trigger play/reverse on scroll
  ScrollTrigger.create({
    trigger: sec,
    start: 'top 70%',
    onEnter:      () => tl.play(),
    onLeaveBack:  () => tl.reverse(),
  });
}

// ── Marquee (scrub-driven) ───────────────────────────────
function initMarquee() {
  const sec = document.querySelector('[data-key="marquee"]');
  if (!sec) return;

  const forward = sec.querySelector('.marquee-track');
  const reverse = sec.querySelector('.reverse-track');

  gsap.to(forward, {
    xPercent: -20,
    ease: 'none',
    scrollTrigger: {
      trigger: sec,
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
    },
  });

  gsap.to(reverse, {
    xPercent: 20,
    ease: 'none',
    scrollTrigger: {
      trigger: sec,
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
    },
  });

  // Fade in the meta at bottom
  const meta = sec.querySelectorAll('.code-badge, .params');
  gsap.from(meta, {
    opacity: 0, y: 20, stagger: 0.1, duration: 0.6, ease: 'power2.out',
    scrollTrigger: { trigger: sec, start: 'top 60%' },
  });
}

// ── Counter (number tween) ───────────────────────────────
function initCounters() {
  const sec = document.querySelector('[data-key="counter"]');
  if (!sec) return;

  sec.querySelectorAll('.counter-num').forEach(el => {
    const target   = parseFloat(el.dataset.target);
    const decimals = parseInt(el.dataset.decimals || '0');
    const snap     = decimals === 0 ? 1 : Math.pow(10, -decimals);

    ScrollTrigger.create({
      trigger: sec,
      start: 'top 65%',
      onEnter: () => {
        gsap.fromTo(el,
          { textContent: 0 },
          {
            textContent: target,
            duration: 2,
            ease: 'power1.out',
            snap: { textContent: snap },
            onUpdate() {
              el.textContent = parseFloat(el.textContent).toFixed(decimals);
            },
          }
        );
      },
      onLeaveBack: () => { el.textContent = '0'; },
    });
  });

  const badge = sec.querySelectorAll('.code-badge, .params');
  gsap.from(badge, {
    opacity: 0, y: 20, stagger: 0.1, duration: 0.7, ease: 'power3.out',
    scrollTrigger: { trigger: sec, start: 'top 60%' },
  });
}

// ── Circle section layout fix ────────────────────────────
function initCircle() {
  const sec = document.querySelector('[data-key="circle-wipe"]');
  if (!sec) return;
  // Replace placeholder with actual circle
  const bg = sec.querySelector('.circle-bg');
  if (bg && !bg.querySelector('.circle-inner')) {
    bg.innerHTML = `
      <div class="circle-inner" style="clip-path:circle(0% at 50% 50%)">
        <div class="circle-content">
          <span class="tag" style="color:rgba(255,255,255,0.4);text-align:center">ANIMATION · 08</span>
          <h2 class="heading" style="color:#fff;font-size:clamp(3rem,8vw,6rem);text-align:center">Canvas<br>Reveals</h2>
          <p class="body-text" style="color:rgba(255,255,255,0.6);text-align:center">The canvas expands from<br>center as hero scrolls away</p>
        </div>
      </div>`;
  }
}

// ── Init ─────────────────────────────────────────────────
initCircle();
sections.forEach(animateSection);
initMarquee();
initCounters();
