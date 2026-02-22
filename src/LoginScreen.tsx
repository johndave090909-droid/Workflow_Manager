import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from './firebase';

export default function LoginScreen() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // onAuthStateChanged in App.tsx handles the rest
    } catch (err: any) {
      const code = err?.code ?? '';
      if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(code)) {
        setError('Invalid email or password.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many failed attempts. Please try again later.');
      } else if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else {
        setError('Sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0510] text-white flex flex-col items-center justify-center p-8">
      <div className="mb-10 text-center">
        <div className="w-16 h-16 bg-[#ff00ff] rounded-2xl flex items-center justify-center text-white font-bold text-3xl shadow-lg shadow-pink-500/30 mx-auto mb-4">
          W
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-[#ff00ff] drop-shadow-[0_0_12px_rgba(255,0,255,0.6)]">
          Workflow Manager
        </h1>
        <p className="text-slate-400 mt-2 text-sm">Sign in to continue</p>
      </div>

      <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
            Email
          </label>
          <input
            type="email"
            autoComplete="email"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-[#ff00ff] transition-all"
            placeholder="you@company.com"
            value={email}
            onChange={e => { setEmail(e.target.value); setError(''); }}
            disabled={loading}
          />
        </div>

        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
            Password
          </label>
          <input
            type="password"
            autoComplete="current-password"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-[#ff00ff] transition-all"
            placeholder="••••••••"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            disabled={loading}
          />
        </div>

        {error && (
          <p className="text-[11px] text-[#ff4d4d] font-semibold text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-xl bg-[#ff00ff] text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-[#ff00ff]/20 flex items-center justify-center gap-2 mt-2"
        >
          {loading
            ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
            : 'Sign In'
          }
        </button>
      </form>
    </div>
  );
}
