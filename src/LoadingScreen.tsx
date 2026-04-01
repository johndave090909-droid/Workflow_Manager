import { motion } from 'motion/react';

const RINGS = [
  { size: 120, duration: 3,   delay: 0,    color: '#a78bfa', opacity: 0.15 },
  { size: 180, duration: 4.5, delay: 0.4,  color: '#7c3aed', opacity: 0.10 },
  { size: 250, duration: 6,   delay: 0.8,  color: '#6366f1', opacity: 0.07 },
  { size: 340, duration: 8,   delay: 1.2,  color: '#4f46e5', opacity: 0.04 },
];

const PARTICLES = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  y: Math.random() * 100,
  size: Math.random() * 2 + 1,
  duration: Math.random() * 4 + 3,
  delay: Math.random() * 3,
  color: ['#a78bfa', '#7c3aed', '#6366f1', '#ff00ff', '#00ffff'][Math.floor(Math.random() * 5)],
}));

const BARS = [0.4, 0.7, 0.5, 1, 0.6, 0.8, 0.45, 0.9, 0.55, 0.75, 0.35, 0.65];

export default function LoadingScreen() {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden select-none"
      style={{ background: '#0a0510' }}
    >
      {/* ── Ambient radial glow ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(124,58,237,0.12) 0%, transparent 70%)',
        }}
      />

      {/* ── Grid overlay ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(167,139,250,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(167,139,250,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
        }}
      />

      {/* ── Floating particles ── */}
      {PARTICLES.map(p => (
        <motion.div
          key={p.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            boxShadow: `0 0 ${p.size * 3}px ${p.color}`,
          }}
          animate={{ opacity: [0, 0.8, 0], y: [0, -30, -60], scale: [0.5, 1, 0.3] }}
          transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}

      {/* ── Pulse rings ── */}
      {RINGS.map((r, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: r.size,
            height: r.size,
            border: `1px solid ${r.color}`,
            opacity: 0,
          }}
          animate={{ opacity: [0, r.opacity, 0], scale: [0.85, 1.15, 1.35] }}
          transition={{ duration: r.duration, delay: r.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {/* ── Center logo ── */}
      <div className="relative flex items-center justify-center mb-10">
        {/* Spinning orbit ring */}
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 96,
            height: 96,
            border: '1px solid transparent',
            borderTopColor: '#a78bfa',
            borderRightColor: '#7c3aed44',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 112,
            height: 112,
            border: '1px solid transparent',
            borderBottomColor: '#6366f1',
            borderLeftColor: '#4f46e544',
          }}
          animate={{ rotate: -360 }}
          transition={{ duration: 3.6, repeat: Infinity, ease: 'linear' }}
        />

        {/* Logo box */}
        <motion.div
          className="relative z-10 flex items-center justify-center rounded-2xl"
          style={{
            width: 68,
            height: 68,
            background: 'linear-gradient(135deg, rgba(124,58,237,0.25) 0%, rgba(99,102,241,0.15) 100%)',
            border: '1px solid rgba(167,139,250,0.3)',
            boxShadow: '0 0 40px rgba(124,58,237,0.3), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <motion.span
            className="font-black text-white"
            style={{
              fontFamily: '"Outfit", sans-serif',
              fontSize: 30,
              letterSpacing: '-0.02em',
              textShadow: '0 0 20px rgba(167,139,250,0.8), 0 0 40px rgba(124,58,237,0.5)',
            }}
            animate={{ textShadow: [
              '0 0 20px rgba(167,139,250,0.8), 0 0 40px rgba(124,58,237,0.5)',
              '0 0 30px rgba(167,139,250,1),   0 0 60px rgba(124,58,237,0.8)',
              '0 0 20px rgba(167,139,250,0.8), 0 0 40px rgba(124,58,237,0.5)',
            ]}}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            W
          </motion.span>
        </motion.div>
      </div>

      {/* ── Brand text ── */}
      <motion.div
        className="text-center mb-8"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.3 }}
      >
        <p
          className="text-[9px] font-black uppercase tracking-[0.35em] mb-2"
          style={{ color: '#7c3aed' }}
        >
          PCC
        </p>
        <h1
          className="font-black text-white text-lg leading-tight"
          style={{
            fontFamily: '"Outfit", sans-serif',
            letterSpacing: '-0.01em',
            textShadow: '0 0 30px rgba(167,139,250,0.3)',
          }}
        >
          Culinary Command
          <br />
          Center
        </h1>
      </motion.div>

      {/* ── Audio-visualizer style bar loader ── */}
      <motion.div
        className="flex items-end gap-[3px] mb-6"
        style={{ height: 28 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        {BARS.map((h, i) => (
          <motion.div
            key={i}
            className="rounded-full"
            style={{
              width: 3,
              background: `linear-gradient(to top, #7c3aed, #a78bfa)`,
              boxShadow: '0 0 6px rgba(167,139,250,0.6)',
            }}
            animate={{ height: [h * 8 + 4, h * 28, h * 8 + 4] }}
            transition={{
              duration: 0.8 + (i % 4) * 0.15,
              delay: i * 0.06,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        ))}
      </motion.div>

      {/* ── Status text ── */}
      <motion.p
        className="text-[10px] font-bold uppercase tracking-[0.25em]"
        style={{ color: 'rgba(148,163,184,0.5)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.7, 0.4, 0.7] }}
        transition={{ duration: 2, delay: 0.8, repeat: Infinity }}
      >
        Initializing
      </motion.p>
    </div>
  );
}
