import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Award, ChefHat, TrendingUp, Users, Star, Shield, Play, X, Globe, Zap, BookOpen, Target, Heart, ArrowRight } from 'lucide-react';
import { collection, query, orderBy, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

// --- Color palette matching the physical certificate ---
const GOLD       = '#C9A84C';
const GOLD_LIGHT = '#E8C878';
const GOLD_DARK  = '#A07830';
const CREAM      = '#FAF7F0';
const CREAM_DARK = '#F0EAD6';
const BROWN      = '#3D2B1F';
const BROWN_MID  = '#6B4C38';

// --- Shared decorative sub-components ---

function GoldRule({ width = 180 }: { width?: number }) {
  return (
    <svg
      width={width}
      height="14"
      viewBox={`0 0 ${width} 14`}
      className="block mx-auto my-4"
    >
      <line x1="0" y1="7" x2={width * 0.41} y2="7" stroke={GOLD} strokeWidth="1" />
      <circle cx={width / 2} cy="7" r="5" fill="none" stroke={GOLD} strokeWidth="1.5" />
      <line x1={width * 0.59} y1="7" x2={width} y2="7" stroke={GOLD} strokeWidth="1" />
    </svg>
  );
}

function CornerLaurel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" className={className} style={style}>
      <path
        d="M10 70 Q22 48 38 28 Q52 10 70 6"
        stroke={GOLD}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="26" cy="50" rx="8" ry="3.5" fill={GOLD} opacity="0.55" transform="rotate(-42 26 50)" />
      <ellipse cx="42" cy="32" rx="7" ry="3" fill={GOLD} opacity="0.45" transform="rotate(-58 42 32)" />
      <ellipse cx="57" cy="18" rx="6" ry="2.5" fill={GOLD} opacity="0.35" transform="rotate(-68 57 18)" />
    </svg>
  );
}

// --- Section A: Hero ---

function HeroSection() {
  return (
    <section style={{ background: CREAM }} className="px-6 py-24 text-center relative">
      <CornerLaurel className="absolute top-6 left-2 opacity-40 pointer-events-none" />
      <CornerLaurel className="absolute top-6 right-2 opacity-40 pointer-events-none" style={{ transform: 'scaleX(-1)' }} />
      <CornerLaurel className="absolute bottom-16 left-2 opacity-25 pointer-events-none" style={{ transform: 'rotate(180deg) scaleX(-1)' }} />
      <CornerLaurel className="absolute bottom-16 right-2 opacity-25 pointer-events-none" style={{ transform: 'rotate(180deg)' }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="mb-8"
          >
            <img
              src="/PCC_logo.png"
              alt="Polynesian Cultural Center"
              className="h-20 sm:h-24 w-auto mx-auto"
              onError={e => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = 'block';
              }}
            />
            <div style={{ display: 'none', color: GOLD, fontFamily: 'Outfit, sans-serif' }} className="text-4xl font-black tracking-widest">PCC</div>
          </motion.div>

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.6 }}
            style={{ color: BROWN_MID, letterSpacing: '0.2em' }} className="text-[10px] sm:text-xs font-bold uppercase mb-1">
            Polynesian Cultural Center
          </motion.p>

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.6 }}
            style={{ color: GOLD, letterSpacing: '0.35em' }} className="text-[10px] sm:text-xs font-black uppercase mb-3">
            Certificate of Achievement
          </motion.p>

          <GoldRule width={200} />

          <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.7, type: 'spring', stiffness: 200 }}
            style={{ color: BROWN, fontFamily: 'Outfit, sans-serif' }} className="text-5xl sm:text-7xl font-black leading-none mb-3">
            CCBL
          </motion.h1>

          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.58, duration: 0.5 }}
            style={{ color: BROWN_MID, fontFamily: 'Outfit, sans-serif' }}
            className="text-sm sm:text-base font-semibold tracking-wide mb-5">
            Center for Culinary Excellence and Leadership
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65, duration: 0.6 }}
            className="mb-8 max-w-xs sm:max-w-sm mx-auto text-center">
            <p style={{ color: BROWN_MID, fontFamily: 'Outfit, sans-serif' }} className="text-sm sm:text-base font-bold tracking-wide mb-2">
              Real Operations. Real Discipline. Real Leadership.
            </p>
            <p style={{ color: BROWN_MID, fontFamily: 'Outfit, sans-serif' }} className="text-xs sm:text-sm leading-relaxed opacity-80">
              At the Polynesian Cultural Center, the Center is a live training and development system embedded within real culinary operations—serving thousands of guests daily while developing apprentices into professionals who can execute, think, and lead at a high level.
            </p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8, duration: 0.6 }}
            style={{ borderColor: `${GOLD}50`, background: `${GOLD}08` }} className="border rounded-2xl px-6 py-5 max-w-sm mx-auto">
            <p style={{ color: BROWN_MID }} className="text-sm leading-relaxed">
              This certificate recognizes the successful completion of a rigorous,{' '}
              <span style={{ color: GOLD }} className="font-bold">2,000+ hour</span>{' '}
              culinary leadership program at the Polynesian Cultural Center in Laie, Hawai'i.
            </p>
          </motion.div>

          <motion.div animate={{ y: [0, 8, 0] }} transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
            style={{ color: GOLD, marginTop: 40 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </motion.div>
        </div>
    </section>
  );
}

// --- Section B: Verification Seal ---

function VerificationSealSection() {
  return (
    <section style={{ background: BROWN }} className="px-6 py-16 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.7, type: 'spring', stiffness: 180 }}
        className="flex flex-col items-center gap-4 max-w-sm mx-auto"
      >
        {/* Spinning dashed ring + static award icon */}
        <div className="relative w-28 h-28 flex items-center justify-center mb-2">
          <motion.svg
            width="112"
            height="112"
            viewBox="0 0 112 112"
            animate={{ rotate: 360 }}
            transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
            className="absolute inset-0"
          >
            <circle cx="56" cy="56" r="52" fill="none" stroke={GOLD} strokeWidth="1.5" strokeDasharray="6 4" />
          </motion.svg>
          <div
            style={{ border: `2px solid ${GOLD}`, background: `${GOLD}18` }}
            className="w-20 h-20 rounded-full flex items-center justify-center"
          >
            <Award size={32} color={GOLD} />
          </div>
        </div>

        <p
          style={{ color: `${CREAM}80`, letterSpacing: '0.28em' }}
          className="text-[10px] uppercase font-bold"
        >
          Officially Issued By
        </p>

        <h2
          style={{ color: CREAM, fontFamily: 'Outfit, sans-serif' }}
          className="text-2xl sm:text-3xl font-black leading-tight"
        >
          Polynesian Cultural Center
        </h2>

        <p style={{ color: GOLD }} className="text-sm font-semibold tracking-wide">
          Laie, Hawai'i
        </p>

        <GoldRule width={160} />

        <p style={{ color: `${CREAM}CC` }} className="text-sm">
          <span style={{ color: GOLD }} className="font-bold">Felix Tai</span>
          {' · Director of Culinary Operations'}
        </p>

        <p style={{ color: `${CREAM}70` }} className="text-xs max-w-xs leading-relaxed mt-1">
          Certifies demonstrated mastery across all CCBL competency pillars through
          documented field performance and real-world assessment.
        </p>
      </motion.div>
    </section>
  );
}

// --- Section C: Journey / 2,000+ Hours ---
// Must be a proper component (uses hooks)

function JourneySection() {
  const counterRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = counterRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !started) setStarted(true); },
      { threshold: 0.4 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const target = 2000;
    const stepMs = 16;
    const totalSteps = 1800 / stepMs;
    const increment = Math.ceil(target / totalSteps);
    const id = setInterval(() => {
      setCount(prev => {
        if (prev >= target) { clearInterval(id); return target; }
        return Math.min(prev + increment, target);
      });
    }, stepMs);
    return () => clearInterval(id);
  }, [started]);

  const areas = [
    { label: 'Kitchen Operations',      hours: '~350+ hrs', icon: ChefHat },
    { label: 'Serving Line Excellence', hours: '~300+ hrs', icon: Users },
    { label: 'Leadership Development',  hours: '~250+ hrs', icon: Star },
    { label: 'Financial Strategy',      hours: '~200+ hrs', icon: TrendingUp },
    { label: 'Hospitality Excellence',  hours: '~400+ hrs', icon: Award },
    { label: 'Real-World Environments', hours: '~500+ hrs', icon: Shield },
  ];

  return (
    <section style={{ background: CREAM }} className="relative px-4 py-16 overflow-hidden">
      <div className="max-w-6xl mx-auto text-center" style={{ position: 'relative', zIndex: 2 }}>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <p
            style={{ color: GOLD, letterSpacing: '0.3em' }}
            className="text-[10px] sm:text-xs uppercase font-black mb-2"
          >
            The Apprenticeship
          </p>
          <h2
            style={{ color: BROWN, fontFamily: 'Outfit, sans-serif' }}
            className="text-2xl sm:text-3xl font-black mb-1"
          >
            Culinary Leadership Apprenticeship
          </h2>
          <GoldRule width={160} />
        </motion.div>

        {/* Animated counter */}
        <div ref={counterRef} className="my-10">
          <p
            style={{ color: GOLD, fontFamily: 'Outfit, sans-serif' }}
            className="text-7xl sm:text-8xl font-black tabular-nums leading-none"
          >
            {count.toLocaleString()}+
          </p>
          <p
            style={{ color: BROWN_MID }}
            className="text-xs uppercase tracking-widest font-semibold mt-3"
          >
            Hours of Applied Training
          </p>
        </div>

        {/* Training area grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 text-left">
          {areas.map(({ label, hours, icon: Icon }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              style={{
                background: '#FFFFFF',
                border: `1px solid ${GOLD}40`,
                borderRadius: '1rem',
                boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              }}
              className="p-4 flex flex-col items-center gap-2 text-center"
            >
              <div
                style={{ background: `${GOLD}18`, borderRadius: '50%' }}
                className="w-10 h-10 flex items-center justify-center"
              >
                <Icon size={18} color={GOLD} />
              </div>
              <p style={{ color: BROWN, fontSize: '0.75rem', fontWeight: 600 }} className="leading-tight">
                {label}
              </p>
              <p style={{ color: BROWN_MID, fontSize: '0.65rem' }}>{hours}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// --- Section: What We Are ---

function WhatWeAreSection() {
  const bullets = [
    { label: 'skill is built through execution' },
    { label: 'leadership is developed through responsibility' },
    { label: 'discipline is formed through consistency' },
  ];
  const stats = [
    { value: '1,500+', label: 'Meals Served Daily' },
    { value: '100',    label: 'Team Members in Daily Ops' },
    { value: '20+',    label: 'Countries Represented' },
  ];
  return (
    <div style={{ background: BROWN }} className="px-4 sm:px-8 py-16 sm:py-20">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">

        {/* Left — What We Are */}
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
          <p style={{ color: GOLD, letterSpacing: '0.3em' }} className="text-[10px] sm:text-xs uppercase font-black mb-2">What We Are</p>
          <h2 style={{ color: CREAM, fontFamily: 'Outfit, sans-serif' }} className="text-2xl sm:text-3xl font-black mb-1">
            A Live Culinary<br />Leadership System
          </h2>
          <GoldRule width={160} />
          <div className="mt-6 space-y-4">
            <p style={{ color: `${CREAM}99` }} className="text-sm leading-relaxed">
              We are not a classroom.<br />We are not a simulation.
            </p>
            <p style={{ color: `${CREAM}cc` }} className="text-sm leading-relaxed">
              Our apprentices train inside real kitchens, in real service, with real expectations.
            </p>
            <div>
              <p style={{ color: `${CREAM}99` }} className="text-sm mb-3">This is where:</p>
              <ul className="space-y-2">
                {bullets.map((b, i) => (
                  <motion.li key={i} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                    transition={{ delay: i * 0.1, duration: 0.4 }}
                    className="flex items-start gap-3 text-sm"
                    style={{ color: CREAM }}>
                    <span style={{ color: GOLD, marginTop: 2 }} className="text-xs">◆</span>
                    {b.label}
                  </motion.li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>

        {/* Right — By the Numbers */}
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.15 }}>
          <p style={{ color: GOLD, letterSpacing: '0.3em' }} className="text-[10px] sm:text-xs uppercase font-black mb-2">By the Numbers</p>
          <h2 style={{ color: CREAM, fontFamily: 'Outfit, sans-serif' }} className="text-2xl sm:text-3xl font-black mb-1">
            Real Scale.<br />Real Impact.
          </h2>
          <GoldRule width={160} />

          {/* Big stat row */}
          <div className="mt-6 grid grid-cols-3 gap-4 mb-8">
            {stats.map((s, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: 0.1 + i * 0.1, duration: 0.5 }}
                className="text-center">
                <p style={{ color: GOLD, fontFamily: 'Outfit, sans-serif' }} className="text-3xl sm:text-4xl font-black leading-none mb-1">{s.value}</p>
                <p style={{ color: `${CREAM}70` }} className="text-[10px] uppercase tracking-wider leading-tight">{s.label}</p>
              </motion.div>
            ))}
          </div>

          {/* Additional bullet facts */}
          <div style={{ borderTop: `1px solid ${GOLD}30` }} className="pt-5 space-y-2">
            {['Multiple venues operating simultaneously', 'High-volume, real-time service environment'].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm" style={{ color: `${CREAM}99` }}>
                <span style={{ color: GOLD }} className="text-[8px]">●</span>
                {item}
              </div>
            ))}
          </div>

          {/* Closing statement */}
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.5, duration: 0.6 }}
            style={{ borderLeft: `3px solid ${GOLD}`, background: `${GOLD}10` }}
            className="mt-6 pl-4 py-3 pr-3">
            <p style={{ color: CREAM, fontFamily: 'Outfit, sans-serif' }} className="text-sm font-semibold italic">
              "This is not theoretical training. This is operational performance."
            </p>
          </motion.div>
        </motion.div>

      </div>
    </div>
  );
}

// --- Section D: Four Pillars ---

const PILLARS = [
  {
    title: 'Culinary Execution',
    desc: 'Technique. Precision. Consistency. Speed. Apprentices develop the foundational craft of professional culinary work through daily live-service repetition.',
    icon: ChefHat,
  },
  {
    title: 'Operational Systems',
    desc: 'Workflow. Efficiency. Scalability. Understanding how a high-volume culinary operation is structured, managed, and sustained at performance level.',
    icon: Zap,
  },
  {
    title: 'Leadership',
    desc: 'Accountability. Communication. Team development. Leading by example in high-pressure environments where execution and culture are built simultaneously.',
    icon: Users,
  },
  {
    title: 'Business & Strategy',
    desc: 'Financial awareness. Planning. Performance analysis. The ability to think beyond the kitchen and contribute to the business behind the operation.',
    icon: TrendingUp,
  },
];

function PillarsSection() {
  return (
    <section style={{ background: CREAM_DARK }} className="px-4 py-16">
      <div className="max-w-2xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <p
            style={{ color: GOLD, letterSpacing: '0.3em' }}
            className="text-[10px] sm:text-xs uppercase font-black mb-2"
          >
            What We Develop
          </p>
          <h2
            style={{ color: BROWN, fontFamily: 'Outfit, sans-serif' }}
            className="text-2xl sm:text-3xl font-black mb-1"
          >
            Beyond Culinary Skill
          </h2>
          <GoldRule width={160} />
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8 text-left">
          {PILLARS.map(({ title, desc, icon: Icon }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5, type: 'spring', stiffness: 200 }}
              style={{
                background: '#FFFFFF',
                border: `1px solid ${GOLD}30`,
                borderRadius: '1.5rem',
                boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
              }}
              className="p-6"
            >
              {/* Gold top accent bar */}
              <div
                style={{
                  height: 3,
                  borderRadius: 99,
                  background: `linear-gradient(90deg, ${GOLD_DARK}, ${GOLD}, ${GOLD_LIGHT})`,
                  marginBottom: '1rem',
                }}
              />
              <div className="flex items-center gap-3 mb-3">
                <div
                  style={{ background: `${GOLD}18`, borderRadius: '50%' }}
                  className="w-9 h-9 flex items-center justify-center shrink-0"
                >
                  <Icon size={16} color={GOLD} />
                </div>
                <h3
                  style={{ color: BROWN, fontFamily: 'Outfit, sans-serif' }}
                  className="text-base font-bold leading-tight"
                >
                  {title}
                </h3>
              </div>
              <p style={{ color: BROWN_MID, fontSize: '0.8rem', lineHeight: 1.65 }}>
                {desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// --- Section E: About PCC ---

const STATS = [
  { value: '1963',          label: 'Founded' },
  { value: '40+',           label: 'Nations Represented' },
  { value: "Laie, Hawai'i", label: 'Home' },
];

function AboutPCCSection() {
  return (
    <section style={{ background: BROWN }} className="px-6 py-16 text-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="max-w-xl mx-auto"
      >
        <p
          style={{ color: `${CREAM}60`, letterSpacing: '0.3em' }}
          className="text-[10px] uppercase font-bold mb-2"
        >
          About the Institution
        </p>
        <h2
          style={{ color: CREAM, fontFamily: 'Outfit, sans-serif' }}
          className="text-xl sm:text-2xl font-black mb-1"
        >
          Polynesian Cultural Center
        </h2>
        <GoldRule width={140} />
        <p style={{ color: `${CREAM}CC`, lineHeight: 1.8 }} className="text-sm sm:text-base mt-4">
          The Polynesian Cultural Center in Laie, Hawai'i is a premier cultural institution
          welcoming hundreds of thousands of guests annually. Its culinary operations span
          multiple dining venues and serve as a living classroom for the CCBL program —
          one of the most rigorous food service leadership tracks in the Pacific.
        </p>
        <div style={{ borderTop: `1px solid ${GOLD}30`, marginTop: '2rem', paddingTop: '1.5rem' }}>
          <p style={{ color: GOLD, letterSpacing: '0.3em' }} className="text-[10px] uppercase font-black mb-2">Our Purpose</p>
          <p style={{ color: `${CREAM}99`, lineHeight: 1.8 }} className="text-sm italic">
            "To contribute to the educational development and growth of all employees while sharing the cultures and spirit of Polynesia."
          </p>
        </div>

        <div className="flex flex-col sm:flex-row justify-center gap-8 sm:gap-12 mt-10">
          {STATS.map(({ value, label }) => (
            <div key={label} className="text-center">
              <p
                style={{ color: GOLD, fontFamily: 'Outfit, sans-serif' }}
                className="text-2xl font-black"
              >
                {value}
              </p>
              <p
                style={{ color: `${CREAM}60` }}
                className="text-[10px] uppercase tracking-widest mt-1"
              >
                {label}
              </p>
            </div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}

// --- Section F: Footer ---

function FooterSection() {
  return (
    <footer
      style={{
        background: CREAM,
        borderTop: `3px solid ${GOLD}50`,
      }}
      className="px-6 pt-12 pb-10 text-center"
    >
      {/* CCBL Seal */}
      <div className="relative inline-flex items-center justify-center w-20 h-20 mb-6">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="37" fill="none" stroke={GOLD} strokeWidth="2" />
          <circle cx="40" cy="40" r="29" fill="none" stroke={GOLD} strokeWidth="0.8" strokeDasharray="3 2" />
          <circle cx="40" cy="40" r="24" fill={`${GOLD}18`} />
        </svg>
        <Award
          size={28}
          color={GOLD}
          style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
        />
      </div>

      <p
        style={{ color: GOLD, letterSpacing: '0.22em' }}
        className="text-[10px] uppercase font-black mb-3"
      >
        CCBL · Certified Culinary Business Leader
      </p>

      <p style={{ color: BROWN }} className="text-sm font-semibold mb-1">
        Culinary Director: Felix Tai
      </p>

      <p style={{ color: BROWN_MID }} className="text-xs mb-8">
        Polynesian Cultural Center · Laie, Hawai'i
      </p>

      {/* Gold fade rule */}
      <div
        style={{
          height: 2,
          background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
        }}
        className="mx-auto max-w-xs rounded-full"
      />

      <p
        style={{ color: `${BROWN}50` }}
        className="text-[9px] uppercase tracking-widest mt-4"
      >
        polynesia.com
      </p>
    </footer>
  );
}

// --- Section G: Media Gallery ---

type CcblMedia = { id: string; url: string; thumbUrl?: string; storagePath: string; type: 'photo' | 'video'; name: string };
type CcblApprentice = { id: string; name: string; role?: string; location?: string; desc?: string; sortOrder: number };
type CcblApprenticeMedia = { id: string; apprenticeId: string; url: string; type: 'photo' | 'video'; name: string };

function MediaGallerySection() {
  const [media,     setMedia]     = useState<CcblMedia[]>([]);
  const [lightbox,  setLightbox]  = useState<CcblMedia | null>(null);
  const [inView,    setInView]    = useState(true);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'ccbl_media'), orderBy('uploadedAt', 'desc'));
    return onSnapshot(q, snap => setMedia(snap.docs.map(d => ({ id: d.id, ...d.data() } as CcblMedia))));
  }, []);

  // Pause animation when section is off-screen
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.05 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const BROWSER_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'];
  const supportedPhoto = (m: CcblMedia) => {
    const ext = m.name.split('.').pop()?.toLowerCase() ?? '';
    return BROWSER_IMAGE_EXTS.includes(ext);
  };
  // Deduplicate videos by storagePath (same file toggled multiple times = different tokens but same path)
  const videos = media
    .filter(m => m.type === 'video')
    .filter((m, i, arr) => arr.findIndex(x => x.storagePath === m.storagePath) === i);
  const photos = media.filter(m => m.type === 'photo' && supportedPhoto(m));

  if (media.length === 0) return null;

  return (
    <section ref={sectionRef} className="w-full py-16 overflow-hidden">
      <div className="max-w-3xl mx-auto text-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <p style={{ color: GOLD, letterSpacing: '0.3em' }} className="text-[10px] sm:text-xs uppercase font-black mb-2">
            Moments
          </p>
          <h2 style={{ color: BROWN, fontFamily: 'Outfit, sans-serif' }} className="text-2xl sm:text-3xl font-black mb-1">
            Gallery
          </h2>
          <GoldRule width={160} />
        </motion.div>
      </div>

      {/* ── Videos ── */}
      {videos.length > 0 && (
        <div className="max-w-4xl mx-auto mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4 px-4">
          {videos.map((item, i) => (
            <motion.button
              key={item.id}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              onClick={() => setLightbox(item)}
              className="relative rounded-2xl overflow-hidden group"
              style={{ aspectRatio: '16/9', border: `1px solid ${GOLD}30`, boxShadow: '0 2px 16px rgba(0,0,0,0.10)' }}
            >
              <video
                src={item.url}
                className="w-full h-full object-cover"
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={e => { (e.currentTarget as HTMLVideoElement).currentTime = 1; }}
                onError={e => {
                  const btn = (e.currentTarget as HTMLVideoElement).closest('button') as HTMLElement | null;
                  if (btn) btn.style.display = 'none';
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
                <div style={{ background: `${GOLD}CC` }} className="w-12 h-12 rounded-full flex items-center justify-center">
                  <Play size={22} color={BROWN} fill={BROWN} />
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {/* ── Photo marquee rows ── */}
      {photos.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 40 }}>
        <div style={{
          width: '100%',
          maxWidth: 1040,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          position: 'relative',
        }}>
          {/* Side fades as plain divs — avoids expensive CSS maskImage on scroll */}
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '12%', background: `linear-gradient(to right, ${CREAM_DARK}, transparent)`, pointerEvents: 'none', zIndex: 2 }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '12%', background: `linear-gradient(to left, ${CREAM_DARK}, transparent)`, pointerEvents: 'none', zIndex: 2 }} />
          {[0, 1, 2].map(row => {
            const raw = photos.slice(0, 8);
            const base: CcblMedia[] = row === 1 ? [...raw].reverse() : raw;
            // Pad so the first half always fills the container (272px per card)
            const minCount = Math.ceil(1040 / 272) + 1;
            const padded = base.length >= minCount
              ? base
              : Array.from({ length: Math.ceil(minCount / base.length) }, () => base).flat().slice(0, minCount);
            const repeated = [...padded, ...padded];
            const dir = row === 1 ? 'ccbl-scroll-right' : 'ccbl-scroll-left';
            const duration = `${Math.max(20, base.length * 3)}s`;
            return (
              <div key={row} style={{
                display: 'flex',
                gap: 12,
                width: 'max-content',
                animation: `${dir} ${duration} linear infinite`,
                animationPlayState: inView ? 'running' : 'paused',
                willChange: 'transform',
              }}>
                {repeated.map((item, i) => (
                  <button
                    key={`${item.id}-${i}`}
                    onClick={() => setLightbox(item)}
                    style={{
                      width: 260, height: 195,
                      flexShrink: 0,
                      borderRadius: 12,
                      overflow: 'hidden',
                      border: `1px solid ${GOLD}30`,
                      boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                      position: 'relative',
                    }}
                  >
                    <img
                      src={item.thumbUrl ?? item.url}
                      alt={item.name}
                      decoding="async"
                      width={260}
                      height={195}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={e => { (e.currentTarget.closest('button') as HTMLElement).style.display = 'none'; }}
                    />
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
          >
            <X size={20} />
          </button>
          <div onClick={e => e.stopPropagation()} className="max-w-3xl w-full max-h-[85vh]">
            {lightbox.type === 'video' ? (
              <video src={lightbox.url} controls autoPlay className="w-full max-h-[85vh] rounded-2xl" />
            ) : (
              <img src={lightbox.url} alt={lightbox.name} className="w-full max-h-[85vh] object-contain rounded-2xl" />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// --- Section H: Apprentices ---

function ApprenticesSection() {
  const [apprentices, setApprentices] = useState<CcblApprentice[]>([]);
  const [allMedia, setAllMedia] = useState<CcblApprenticeMedia[]>([]);
  const [selectedApprentice, setSelectedApprentice] = useState<CcblApprentice | null>(null);
  const [lightbox, setLightbox] = useState<CcblApprenticeMedia | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'ccbl_apprentices'), orderBy('sortOrder'));
    return onSnapshot(q, snap =>
      setApprentices(snap.docs.map(d => ({ id: d.id, ...d.data() } as CcblApprentice)))
    );
  }, []);

  useEffect(() => {
    getDocs(query(collection(db, 'ccbl_apprentice_media'))).then(snap =>
      setAllMedia(snap.docs.map(d => ({ id: d.id, ...d.data() } as CcblApprenticeMedia)))
    );
  }, []);

  if (apprentices.length === 0) return null;

  const portfolioPhotos = selectedApprentice
    ? allMedia.filter(m => m.apprenticeId === selectedApprentice.id && m.type === 'photo')
    : [];
  const portfolioVideos = selectedApprentice
    ? allMedia.filter(m => m.apprenticeId === selectedApprentice.id && m.type === 'video')
    : [];

  return (
    <section className="px-4 py-16 h-full">
      <div className="max-w-3xl mx-auto">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <p
            style={{ color: GOLD, letterSpacing: '0.3em' }}
            className="text-[10px] sm:text-xs uppercase font-black mb-2"
          >
            Our People
          </p>
          <h2
            style={{ color: BROWN, fontFamily: 'Outfit, sans-serif' }}
            className="text-2xl sm:text-3xl font-black mb-1"
          >
            Apprentices
          </h2>
          <GoldRule width={160} />
        </motion.div>

        {/* Apprentice card grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {apprentices.map((apprentice, i) => (
            <motion.button
              key={apprentice.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.07, duration: 0.4 }}
              onClick={() => setSelectedApprentice(apprentice)}
              className="flex flex-col items-start text-left p-5 rounded-2xl transition-all"
              style={{
                background: '#FFFFFF',
                border: `1.5px solid ${GOLD}40`,
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 4px 24px ${GOLD}50`;
                (e.currentTarget as HTMLButtonElement).style.borderColor = GOLD;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = `${GOLD}40`;
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  background: `linear-gradient(135deg, ${GOLD_DARK}, ${GOLD})`,
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 10,
                  flexShrink: 0,
                }}
              >
                <Users size={18} color={CREAM} />
              </div>
              <p style={{ color: BROWN, fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.3 }}>
                {apprentice.name}
              </p>
              {apprentice.role && (
                <p style={{ color: GOLD, fontSize: '0.68rem', fontWeight: 700, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {apprentice.role}
                </p>
              )}
              {apprentice.location && (
                <p style={{ color: BROWN_MID, fontSize: '0.7rem', marginTop: 2 }}>
                  {apprentice.location}
                </p>
              )}
              {apprentice.desc && (
                <p style={{ color: BROWN_MID, fontSize: '0.75rem', marginTop: 6, lineHeight: 1.5 }}>
                  {apprentice.desc}
                </p>
              )}
              <p style={{ color: GOLD, fontSize: '0.65rem', marginTop: 8, fontWeight: 600, letterSpacing: '0.05em' }}>
                View Portfolio →
              </p>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Portfolio modal */}
      {selectedApprentice && (
        <div
          className="fixed inset-0 z-[9990] flex items-start justify-center overflow-y-auto"
          style={{ background: 'rgba(0,0,0,0.82)' }}
          onClick={() => setSelectedApprentice(null)}
        >
          <div
            className="relative w-full max-w-3xl mx-auto my-8 rounded-3xl overflow-hidden"
            style={{ background: CREAM }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              style={{
                background: BROWN,
                padding: '1.5rem 2rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <p style={{ color: `${CREAM}70`, fontSize: '0.65rem', letterSpacing: '0.25em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>
                  Portfolio
                </p>
                <h3 style={{ color: CREAM, fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '1.4rem', lineHeight: 1.2 }}>
                  {selectedApprentice.name}
                </h3>
                {selectedApprentice.role && (
                  <p style={{ color: GOLD, fontSize: '0.78rem', marginTop: 2, fontWeight: 600 }}>
                    {selectedApprentice.role}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelectedApprentice(null)}
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  border: 'none',
                  borderRadius: '50%',
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: CREAM,
                  flexShrink: 0,
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 sm:p-8">
              {portfolioPhotos.length === 0 && portfolioVideos.length === 0 && (
                <p style={{ color: BROWN_MID, textAlign: 'center', padding: '2rem 0', fontSize: '0.9rem' }}>
                  No portfolio media yet.
                </p>
              )}

              {/* Photo grid */}
              {portfolioPhotos.length > 0 && (
                <>
                  <p style={{ color: GOLD, fontSize: '0.65rem', letterSpacing: '0.25em', textTransform: 'uppercase', fontWeight: 800, marginBottom: 12 }}>
                    Photos
                  </p>
                  <div className="grid grid-cols-3 gap-3 mb-8">
                    {portfolioPhotos.map((photo, i) => (
                      <motion.button
                        key={photo.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.05 }}
                        onClick={() => setLightbox(photo)}
                        className="rounded-xl overflow-hidden"
                        style={{ aspectRatio: '1', border: `1px solid ${GOLD}30`, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                      >
                        <img
                          src={photo.url}
                          alt={photo.name}
                          className="w-full h-full object-cover"
                          onError={e => { (e.currentTarget.closest('button') as HTMLElement).style.display = 'none'; }}
                        />
                      </motion.button>
                    ))}
                  </div>
                </>
              )}

              {/* Video grid */}
              {portfolioVideos.length > 0 && (
                <>
                  <p style={{ color: GOLD, fontSize: '0.65rem', letterSpacing: '0.25em', textTransform: 'uppercase', fontWeight: 800, marginBottom: 12 }}>
                    Videos
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {portfolioVideos.map((vid, i) => (
                      <motion.button
                        key={vid.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.08 }}
                        onClick={() => setLightbox(vid)}
                        className="relative rounded-2xl overflow-hidden group"
                        style={{ aspectRatio: '16/9', border: `1px solid ${GOLD}30`, boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}
                      >
                        <video
                          src={vid.url}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={e => { (e.currentTarget as HTMLVideoElement).currentTime = 1; }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
                          <div style={{ background: `${GOLD}CC` }} className="w-12 h-12 rounded-full flex items-center justify-center">
                            <Play size={22} color={BROWN} fill={BROWN} />
                          </div>
                        </div>
                      </motion.button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
          >
            <X size={20} />
          </button>
          <div onClick={e => e.stopPropagation()} className="max-w-3xl w-full max-h-[85vh]">
            {lightbox.type === 'video' ? (
              <video src={lightbox.url} controls autoPlay className="w-full max-h-[85vh] rounded-2xl" />
            ) : (
              <img src={lightbox.url} alt={lightbox.name} className="w-full max-h-[85vh] object-contain rounded-2xl" />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// --- Section: Built on Opportunity ---

function BuiltOnOpportunitySection() {
  const steps = [
    { label: 'They enter as participants.' },
    { label: 'They develop as apprentices.' },
    { label: 'They perform as team members.' },
  ];
  return (
    <section style={{ background: CREAM_DARK }} className="px-4 sm:px-8 py-16 sm:py-20">
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <motion.div initial={{ opacity: 0, x: -24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
          <p style={{ color: GOLD, letterSpacing: '0.3em' }} className="text-[10px] sm:text-xs uppercase font-black mb-2">Built on Opportunity</p>
          <h2 style={{ color: BROWN, fontFamily: 'Outfit, sans-serif' }} className="text-2xl sm:text-4xl font-black mb-1 leading-tight">
            We Develop<br />Talent
          </h2>
          <GoldRule width={140} />
          <p style={{ color: BROWN_MID }} className="text-sm leading-relaxed mt-5">
            Many who enter our system have no prior culinary experience. For many, this is their first job.
          </p>
          <p style={{ color: BROWN_MID }} className="text-sm leading-relaxed mt-3">
            We do not recruit finished professionals. <strong style={{ color: BROWN }}>We build them.</strong>
          </p>
          <p style={{ color: BROWN_MID }} className="text-sm leading-relaxed mt-3">
            Through structured training, repetition, accountability, and real-world execution, individuals are developed into professionals capable of performing under pressure.
          </p>
        </motion.div>
        <motion.div initial={{ opacity: 0, x: 24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.15 }}>
          <div className="space-y-4">
            {steps.map((s, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: 0.1 + i * 0.12, duration: 0.4 }}
                style={{ background: '#fff', border: `1px solid ${GOLD}35`, borderRadius: '1rem', borderLeft: `4px solid ${GOLD}` }}
                className="p-4 flex items-center gap-4">
                <span style={{ color: GOLD, fontFamily: 'Outfit, sans-serif', fontSize: '1.4rem', fontWeight: 900, minWidth: 28 }}>{i + 1}</span>
                <p style={{ color: BROWN, fontWeight: 600 }} className="text-sm">{s.label}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// --- Section: Global Training Ground ---

const COUNTRIES = ['Indonesia', 'Malaysia', 'Philippines', 'United States', 'Mongolia', 'Kiribati', 'Samoa', 'Thailand', 'Fiji', 'Papua New Guinea', 'Korea', 'Cambodia', 'Taiwan', 'Mexico', 'Vietnam', 'England', 'Hong Kong', 'New Zealand', 'Japan', 'Bangladesh', 'Pakistan', 'India', 'Tahiti', 'Peru'];

function GlobalTrainingGroundSection() {
  return (
    <section style={{ background: BROWN }} className="px-4 sm:px-8 py-16 sm:py-20 overflow-hidden">
      <div className="max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
          className="text-center mb-10">
          <p style={{ color: GOLD, letterSpacing: '0.3em' }} className="text-[10px] sm:text-xs uppercase font-black mb-2">A Global Training Ground</p>
          <h2 style={{ color: CREAM, fontFamily: 'Outfit, sans-serif' }} className="text-2xl sm:text-4xl font-black mb-1">
            Talent Without Borders
          </h2>
          <GoldRule width={160} />
          <p style={{ color: `${CREAM}99` }} className="text-sm leading-relaxed mt-5 max-w-2xl mx-auto">
            Our apprentices come from across the world—creating a diverse, high-performance environment. This is where global potential is developed into real-world capability.
          </p>
        </motion.div>
        <div className="flex flex-wrap justify-center gap-2">
          {COUNTRIES.map((c, i) => (
            <motion.span key={c} initial={{ opacity: 0, scale: 0.85 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
              transition={{ delay: i * 0.03, duration: 0.3 }}
              style={{ background: `${GOLD}18`, border: `1px solid ${GOLD}40`, color: CREAM, borderRadius: 999 }}
              className="text-xs px-3 py-1.5 font-medium flex items-center gap-1.5">
              <Globe size={10} style={{ color: GOLD }} />{c}
            </motion.span>
          ))}
        </div>
      </div>
    </section>
  );
}

// --- Section: Apprentice Outcomes ---

function ApprenticeOutcomesSection() {
  const [graduates, setGraduates] = useState<CcblApprentice[]>([]);
  const [allMedia, setAllMedia] = useState<CcblApprenticeMedia[]>([]);
  const [selectedGraduate, setSelectedGraduate] = useState<CcblApprentice | null>(null);
  const [lightbox, setLightbox] = useState<CcblApprenticeMedia | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'ccbl_apprentices'), orderBy('sortOrder'));
    return onSnapshot(q, snap =>
      setGraduates(snap.docs.map(d => ({ id: d.id, ...d.data() } as CcblApprentice)))
    );
  }, []);

  useEffect(() => {
    getDocs(query(collection(db, 'ccbl_apprentice_media'))).then(snap =>
      setAllMedia(snap.docs.map(d => ({ id: d.id, ...d.data() } as CcblApprenticeMedia)))
    );
  }, []);

  const portfolioPhotos = selectedGraduate
    ? allMedia.filter(m => m.apprenticeId === selectedGraduate.id && m.type === 'photo')
    : [];
  const portfolioVideos = selectedGraduate
    ? allMedia.filter(m => m.apprenticeId === selectedGraduate.id && m.type === 'video')
    : [];

  const outcomes = [
    'Lead teams within culinary operations',
    'Step into supervisory and management roles',
    'Contribute to hospitality organizations globally',
    'Operate effectively within high-volume environments',
    'Continue developing as leaders within their communities',
  ];
  return (
    <>
    <section style={{ background: CREAM }} className="px-4 sm:px-8 py-16 sm:py-20">
      <div className="max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
          className="text-center mb-10">
          <p style={{ color: GOLD, letterSpacing: '0.3em' }} className="text-[10px] sm:text-xs uppercase font-black mb-2">Apprentice Outcomes</p>
          <h2 style={{ color: BROWN, fontFamily: 'Outfit, sans-serif' }} className="text-2xl sm:text-4xl font-black mb-1">
            From Apprenticeship<br />to Impact
          </h2>
          <GoldRule width={160} />
          <p style={{ color: BROWN_MID }} className="text-sm leading-relaxed mt-4 max-w-xl mx-auto">
            Our apprentices do not complete a program. They leave with the capability to perform and lead.
          </p>
        </motion.div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-14">
          <div>
            <p style={{ color: GOLD, letterSpacing: '0.2em' }} className="text-[10px] uppercase font-black mb-4">Graduates Go On To:</p>
            <ul className="space-y-3">
              {outcomes.map((o, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.4 }}
                  className="flex items-start gap-3 text-sm" style={{ color: BROWN_MID }}>
                  <ArrowRight size={14} style={{ color: GOLD, marginTop: 2, flexShrink: 0 }} />{o}
                </motion.li>
              ))}
            </ul>
          </div>
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.2 }}
            style={{ background: BROWN, borderRadius: '1.5rem', padding: '2rem' }}>
            <p style={{ color: GOLD, letterSpacing: '0.2em' }} className="text-[10px] uppercase font-black mb-3">Outcome</p>
            <p style={{ color: CREAM, fontFamily: 'Outfit, sans-serif' }} className="text-xl font-black mb-1">CCBL</p>
            <p style={{ color: `${CREAM}99` }} className="text-sm">Certified Culinary Business Leader</p>
            <div style={{ height: 1, background: `${GOLD}30`, margin: '1rem 0' }} />
            <p style={{ color: `${CREAM}80` }} className="text-xs leading-relaxed">
              A credential that represents demonstrated mastery across culinary execution, operational systems, leadership, and business strategy—earned through real performance.
            </p>
          </motion.div>
        </div>

        {graduates.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {graduates.map((g, i) => (
              <motion.button
                key={g.id}
                onClick={() => setSelectedGraduate(g)}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                style={{ background: '#fff', border: `1px solid ${GOLD}30`, borderRadius: '1.25rem', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', textAlign: 'left' }}
                className="p-5 transition-all"
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 4px 24px ${GOLD}50`;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = GOLD;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.05)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = `${GOLD}30`;
                }}
              >
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: `linear-gradient(135deg, ${GOLD_DARK}, ${GOLD})` }}
                  className="flex items-center justify-center mb-3">
                  <Users size={18} color={CREAM} />
                </div>
                <p style={{ color: BROWN, fontFamily: 'Outfit, sans-serif' }} className="font-black text-sm mb-0.5">{g.name}</p>
                {g.role && <p style={{ color: GOLD }} className="text-[10px] font-semibold uppercase tracking-wide mb-0.5">{g.role}</p>}
                {g.location && <p style={{ color: BROWN_MID }} className="text-[10px] mb-2">{g.location}</p>}
                {g.desc && <p style={{ color: BROWN_MID }} className="text-xs leading-relaxed">{g.desc}</p>}
                <p style={{ color: GOLD, fontSize: '0.65rem', marginTop: 8, fontWeight: 600, letterSpacing: '0.05em' }}>View Portfolio →</p>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </section>

    {/* Portfolio modal */}
    {selectedGraduate && (
      <div
        className="fixed inset-0 z-[9990] flex items-start justify-center overflow-y-auto"
        style={{ background: 'rgba(0,0,0,0.82)' }}
        onClick={() => setSelectedGraduate(null)}
      >
        <div
          className="relative w-full max-w-3xl mx-auto my-8 rounded-3xl overflow-hidden"
          style={{ background: CREAM }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ background: BROWN, padding: '1.5rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ color: `${CREAM}70`, fontSize: '0.65rem', letterSpacing: '0.25em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Portfolio</p>
              <h3 style={{ color: CREAM, fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '1.4rem', lineHeight: 1.2 }}>{selectedGraduate.name}</h3>
              {selectedGraduate.role && <p style={{ color: GOLD, fontSize: '0.78rem', marginTop: 2, fontWeight: 600 }}>{selectedGraduate.role}</p>}
              {selectedGraduate.location && <p style={{ color: `${CREAM}80`, fontSize: '0.72rem', marginTop: 2 }}>{selectedGraduate.location}</p>}
            </div>
            <button
              onClick={() => setSelectedGraduate(null)}
              style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: CREAM, flexShrink: 0 }}
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-6 sm:p-8">
            {portfolioPhotos.length === 0 && portfolioVideos.length === 0 && (
              <p style={{ color: BROWN_MID, textAlign: 'center', padding: '2rem 0', fontSize: '0.9rem' }}>No portfolio media yet.</p>
            )}
            {portfolioPhotos.length > 0 && (
              <>
                <p style={{ color: GOLD, fontSize: '0.65rem', letterSpacing: '0.25em', textTransform: 'uppercase', fontWeight: 800, marginBottom: 12 }}>Photos</p>
                <div className="grid grid-cols-3 gap-3 mb-8">
                  {portfolioPhotos.map((photo, i) => (
                    <motion.button key={photo.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}
                      onClick={() => setLightbox(photo)} className="rounded-xl overflow-hidden"
                      style={{ aspectRatio: '1', border: `1px solid ${GOLD}30`, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                      <img src={photo.url} alt={photo.name} className="w-full h-full object-cover"
                        onError={e => { (e.currentTarget.closest('button') as HTMLElement).style.display = 'none'; }} />
                    </motion.button>
                  ))}
                </div>
              </>
            )}
            {portfolioVideos.length > 0 && (
              <>
                <p style={{ color: GOLD, fontSize: '0.65rem', letterSpacing: '0.25em', textTransform: 'uppercase', fontWeight: 800, marginBottom: 12 }}>Videos</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {portfolioVideos.map((vid, i) => (
                    <motion.button key={vid.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
                      onClick={() => setLightbox(vid)} className="relative rounded-2xl overflow-hidden group"
                      style={{ aspectRatio: '16/9', border: `1px solid ${GOLD}30`, boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
                      <video src={vid.url} className="w-full h-full object-cover" muted playsInline preload="metadata"
                        onLoadedMetadata={e => { (e.currentTarget as HTMLVideoElement).currentTime = 1; }} />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
                        <div style={{ background: `${GOLD}CC` }} className="w-12 h-12 rounded-full flex items-center justify-center">
                          <Play size={22} color={BROWN} fill={BROWN} />
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Lightbox */}
    {lightbox && (
      <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
        <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
          <X size={20} />
        </button>
        <div onClick={e => e.stopPropagation()} className="max-w-3xl w-full max-h-[85vh]">
          {lightbox.type === 'video'
            ? <video src={lightbox.url} controls autoPlay className="w-full max-h-[85vh] rounded-2xl" />
            : <img src={lightbox.url} alt={lightbox.name} className="w-full max-h-[85vh] object-contain rounded-2xl" />}
        </div>
      </div>
    )}
    </>
  );
}

// --- Section: Collaborations ---

function CollaborationsSection() {
  const pillars = ['Hands-on experience', 'Shared operational environments', 'Mutual development'];
  return (
    <section style={{ background: CREAM_DARK }} className="px-4 sm:px-8 py-14 sm:py-16">
      <div className="max-w-3xl mx-auto text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <p style={{ color: GOLD, letterSpacing: '0.3em' }} className="text-[10px] sm:text-xs uppercase font-black mb-2">Strategic Collaborations</p>
          <h2 style={{ color: BROWN, fontFamily: 'Outfit, sans-serif' }} className="text-xl sm:text-2xl font-black mb-1">
            Expanding Real-World Exposure
          </h2>
          <GoldRule width={140} />
          <p style={{ color: BROWN_MID }} className="text-sm leading-relaxed mt-4 max-w-xl mx-auto">
            The Center engages in select professional collaborations that expand training environments and real-world exposure. All engagements are structured around:
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            {pillars.map((p, i) => (
              <motion.span key={i} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.4 }}
                style={{ border: `1px solid ${GOLD}50`, color: BROWN, borderRadius: 999, background: '#fff' }}
                className="text-xs px-4 py-2 font-semibold">{p}
              </motion.span>
            ))}
          </div>
          <p style={{ color: BROWN_MID }} className="text-xs mt-4 italic">
            All collaborations are conducted in alignment with established partnership guidelines.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// --- Section: Leadership + Quote ---

function LeadershipQuoteSection() {
  return (
    <>
      {/* Leadership */}
      <section style={{ background: BROWN }} className="px-4 sm:px-8 py-14 sm:py-16">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
            <p style={{ color: GOLD, letterSpacing: '0.3em' }} className="text-[10px] sm:text-xs uppercase font-black mb-2">Leadership</p>
            <h2 style={{ color: CREAM, fontFamily: 'Outfit, sans-serif' }} className="text-xl sm:text-2xl font-black mb-1">Felix Tai</h2>
            <GoldRule width={120} />
            <p style={{ color: `${CREAM}99` }} className="text-sm leading-relaxed mt-5 max-w-xl mx-auto">
              Under the leadership of Felix Tai, the Center is built as a high-performance system focused on developing individuals through real operations, disciplined execution, and continuous improvement.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Full-width Quote */}
      <section style={{ background: `linear-gradient(135deg, ${BROWN} 0%, #2a1810 100%)`, borderTop: `1px solid ${GOLD}25`, borderBottom: `1px solid ${GOLD}25` }}
        className="px-4 sm:px-12 py-16 sm:py-24">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }}
          className="max-w-3xl mx-auto text-center">
          <div style={{ color: GOLD, fontSize: '4rem', lineHeight: 1, marginBottom: '1rem', fontFamily: 'Georgia, serif' }}>&ldquo;</div>
          <blockquote style={{ color: CREAM, fontFamily: 'Outfit, sans-serif', lineHeight: 1.75 }} className="text-base sm:text-xl font-medium italic">
            We believe every individual has a purpose.
            Here, through real work, discipline, and accountability, that purpose is discovered, developed, and proven.
            We are entrusted with people—to help them see who they are, take ownership of who they are becoming, and have the capability to fulfill it.
            Accountability is where potential becomes ownership, and ownership becomes capability.
            This is more than a kitchen.{' '}
            <strong style={{ color: GOLD }}>This is where people are changed.</strong>
          </blockquote>
          <p style={{ color: GOLD }} className="text-sm font-black uppercase tracking-widest mt-6">— Felix Tai</p>
        </motion.div>
      </section>
    </>
  );
}

// --- Section: Closing CTA ---

function ClosingCTASection() {
  return (
    <section style={{ background: CREAM }} className="px-4 sm:px-8 py-16 sm:py-20 text-center">
      <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
        className="max-w-2xl mx-auto">
        <p style={{ color: GOLD, letterSpacing: '0.3em' }} className="text-[10px] sm:text-xs uppercase font-black mb-3">One 'Ohana. Sharing Aloha.</p>
        <h2 style={{ color: BROWN, fontFamily: 'Outfit, sans-serif' }} className="text-2xl sm:text-4xl font-black mb-2 leading-tight">
          Developing individuals who will lead, serve, and create impact around the world.
        </h2>
        <GoldRule width={160} />
        <div className="flex flex-col sm:flex-row justify-center gap-4 mt-10">
          {[
            { label: 'Apply for Apprenticeship', href: '#', primary: true },
            { label: 'Partner With the Center', href: '#', primary: false },
            { label: 'Learn More', href: '#', primary: false },
          ].map(({ label, href, primary }, i) => (
            <motion.a key={i} href={href} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              style={primary
                ? { background: GOLD, color: BROWN, borderRadius: 999, fontWeight: 700 }
                : { border: `1.5px solid ${GOLD}`, color: BROWN, borderRadius: 999, fontWeight: 600 }
              }
              className="px-6 py-3 text-sm flex items-center justify-center gap-2 hover:opacity-80 transition-opacity">
              {label}{primary && <ArrowRight size={14} />}
            </motion.a>
          ))}
        </div>
      </motion.div>
    </section>
  );
}

// --- Root Component ---

export default function CCBLLandingPage() {
  // Override the dark body background set by global CSS
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = CREAM;
    return () => { document.body.style.background = prev; };
  }, []);

  return (
    <div style={{ background: CREAM, minHeight: '100vh', color: BROWN }}>
      {/* Top gold bar */}
      <div
        style={{
          height: 4,
          background: `linear-gradient(90deg, ${GOLD_DARK}, ${GOLD}, ${GOLD_LIGHT}, ${GOLD}, ${GOLD_DARK})`,
        }}
      />


      <HeroSection />
      <WhatWeAreSection />
      <BuiltOnOpportunitySection />
      <JourneySection />
      <GlobalTrainingGroundSection />
      <PillarsSection />
      <div style={{ background: CREAM_DARK }}>
        <MediaGallerySection />
      </div>
      <ApprenticeOutcomesSection />
      <VerificationSealSection />
      <AboutPCCSection />
      <CollaborationsSection />
      <LeadershipQuoteSection />
      <ClosingCTASection />
      <FooterSection />

      {/* Bottom gold bar */}
      <div
        style={{
          height: 4,
          background: `linear-gradient(90deg, ${GOLD_DARK}, ${GOLD}, ${GOLD_LIGHT}, ${GOLD}, ${GOLD_DARK})`,
        }}
      />
    </div>
  );
}
