import React from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';

interface Sample {
  num: string;
  title: string;
  desc: string;
  tags: string[];
  color: string;
  path: string | null; // null = coming soon
}

const SAMPLES: Sample[] = [
  {
    num: '01',
    title: 'Frame Scroll',
    desc: 'Video frames extracted and rendered on canvas. Scroll position scrubs through each frame — the same technique as Taste Polynesia.',
    tags: ['canvas', 'GSAP scrub', 'WebP frames', 'circle wipe', 'Lenis'],
    color: '#e8891e',
    path: '/animations/samples/01/',
  },
  {
    num: '02',
    title: 'Text Reveal',
    desc: 'Word-by-word clip-path wipe with massive typography. Hero headings that feel cinematic.',
    tags: ['clip-reveal', 'word split', 'stagger'],
    color: '#a78bfa',
    path: null,
  },
  {
    num: '03',
    title: 'Marquee Scroll',
    desc: 'Oversized text tracks scroll direction. One row forward, one reverse — creates depth and motion without video.',
    tags: ['xPercent', 'scrub', '12vw font'],
    color: '#fb923c',
    path: null,
  },
  {
    num: '04',
    title: 'Counter Stats',
    desc: 'Numbers count up from zero on scroll enter. Dark overlay section with animated stat grid.',
    tags: ['textContent tween', 'snap', 'dark overlay'],
    color: '#4ade80',
    path: null,
  },
  {
    num: '05',
    title: 'Alt Rows',
    desc: 'Text + video alternating left/right layout. Slide-left and slide-right animations create visual rhythm.',
    tags: ['slide-left', 'slide-right', 'video embed'],
    color: '#f472b6',
    path: null,
  },
  {
    num: '06',
    title: 'Full Site',
    desc: 'Complete scroll-driven site combining all techniques — frames, marquee, stats, CTA — from a single video source.',
    tags: ['all techniques', '800vh+', 'complete template'],
    color: '#60a5fa',
    path: null,
  },
];

const TECHNIQUES = [
  'fade-up', 'slide-left', 'slide-right', 'scale-up',
  'rotate-in', 'stagger-up', 'clip-reveal', 'circle-wipe', 'marquee', 'counter',
];

export default function MotionSamples({ onBackToHub }: { onBackToHub: () => void }) {
  return (
    <div className="min-h-screen bg-[#0a0510] text-white pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0510]/90 backdrop-blur-md border-b border-white/10 px-4 sm:px-8 h-16 flex items-center gap-4">
        <button onClick={onBackToHub} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-base font-bold text-white leading-tight">Motion Samples</h1>
          <p className="text-slate-500 text-xs">Scroll-driven animation library</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8">

        {/* Intro */}
        <div className="mb-8">
          <p className="text-slate-400 text-sm leading-relaxed max-w-xl">
            Reusable scroll-driven animations built with GSAP + Lenis. Each sample is a standalone page — copy the pattern, swap in your content.
          </p>
        </div>

        {/* Sample grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-10">
          {SAMPLES.map(s => {
            const live = s.path !== null;
            return (
              <div
                key={s.num}
                className={`relative rounded-2xl border border-white/10 p-5 flex flex-col gap-3 overflow-hidden transition-all ${
                  live ? 'hover:border-white/20 cursor-default' : 'opacity-40'
                }`}
              >
                {/* Glow */}
                <div
                  className="absolute -bottom-10 -right-10 w-40 h-40 rounded-full blur-3xl opacity-10 pointer-events-none"
                  style={{ backgroundColor: s.color }}
                />

                {/* Number + badge */}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-widest text-slate-600">{s.num}</span>
                  {live
                    ? <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-400">LIVE</span>
                    : <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-white/10 text-slate-600">SOON</span>
                  }
                </div>

                {/* Title */}
                <h3 className="font-bold text-lg leading-tight" style={{ color: s.color }}>{s.title}</h3>

                {/* Desc */}
                <p className="text-slate-500 text-xs leading-relaxed flex-1">{s.desc}</p>

                {/* Tags */}
                <div className="flex flex-wrap gap-1">
                  {s.tags.map(t => (
                    <span key={t} className="font-mono text-[9px] tracking-wide text-slate-600 bg-white/[0.03] border border-white/[0.06] px-2 py-0.5 rounded">{t}</span>
                  ))}
                </div>

                {/* Open button */}
                {live && (
                  <a
                    href={s.path!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 flex items-center gap-1.5 text-xs font-bold transition-colors hover:opacity-80"
                    style={{ color: s.color }}
                  >
                    <ExternalLink size={11} />
                    Open sample
                  </a>
                )}
              </div>
            );
          })}
        </div>

        {/* Technique reference link */}
        <a
          href="/animations/reference/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between px-5 py-4 rounded-2xl border border-white/[0.07] text-slate-500 hover:text-white hover:border-white/15 transition-all text-sm font-mono tracking-wide"
        >
          <span>→ Animation technique reference (all 10 types with parameters)</span>
          <ExternalLink size={13} />
        </a>

        {/* Technique tags */}
        <div className="mt-6 flex flex-wrap gap-2 items-center">
          <span className="font-mono text-[10px] tracking-widest uppercase text-slate-700 mr-1">Techniques</span>
          {TECHNIQUES.map(t => (
            <span key={t} className="font-mono text-[9px] tracking-wide text-slate-600 bg-white/[0.03] border border-white/[0.06] px-2.5 py-1 rounded">{t}</span>
          ))}
        </div>

      </div>
    </div>
  );
}
