'use client';

import { ArrowRight, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useMemo, useState } from 'react';
import { persistAuthSession, signIn } from '@/lib/pulse-hub';

type SubmitState =
  | { kind: 'idle'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'success'; message: string };

const initialState: SubmitState = {
  kind: 'idle',
  message: '',
};

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>(initialState);

  const statusClasses = useMemo(() => {
    if (submitState.kind === 'error') {
      return 'border-rose-400/25 bg-rose-500/10 text-rose-100';
    }

    if (submitState.kind === 'success') {
      return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100';
    }

    return 'border-white/10 bg-white/5 text-white/70';
  }, [submitState.kind]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.trim() || !password.trim()) {
      setSubmitState({
        kind: 'error',
        message: 'Fill in email and password to continue.',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signIn({
        email: email.trim(),
        password,
      });

      persistAuthSession(result);

      setSubmitState({
        kind: 'success',
        message: `Access granted for ${result.user.name}. Redirecting to the dashboard...`,
      });

      setTimeout(() => {
        router.push('/');
      }, 500);
    } catch (error) {
      setSubmitState({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to authenticate user.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[var(--surface-variant)] p-5 shadow-[0_30px_100px_rgba(0,0,0,0.24)] backdrop-blur-2xl sm:p-7">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(93,253,138,0.12),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(127,175,255,0.16),transparent_30%)]" />

      <div className="relative flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-headline text-xs font-semibold uppercase tracking-[0.35em] text-[var(--secondary)]">
              Sign in
            </p>
            <h1 className="font-headline mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Enter the operation
            </h1>
          </div>

          <div className="hidden h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[var(--secondary)] sm:flex">
            <ShieldCheck className="h-5 w-5" />
          </div>
        </div>

        <p className="max-w-md text-sm leading-6 text-white/70 sm:text-base">
          Lean access for operators, supervisors, and admins. Only the essential
          flow to sign in fast and land directly in the inbox.
        </p>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/72">Email</span>
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white transition focus-within:border-[var(--primary)] focus-within:bg-white/8">
              <Mail className="h-4 w-4 text-[var(--primary)]" />
              <input
                className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
                type="email"
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@empresa.com"
                autoComplete="email"
              />
            </div>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/72">Password</span>
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white transition focus-within:border-[var(--secondary)] focus-within:bg-white/8">
              <KeyRound className="h-4 w-4 text-[var(--secondary)]" />
              <input
                className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
              />
            </div>
          </label>

          <button
            className="group mt-2 inline-flex items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,var(--primary),#9bd2ff)] px-5 py-3 text-sm font-semibold text-slate-950 transition hover:scale-[1.01] hover:shadow-[0_12px_32px_rgba(127,175,255,0.28)] disabled:cursor-not-allowed disabled:opacity-80"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Validating access...' : 'Sign in now'}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </button>
        </form>

        {submitState.message ? (
          <div className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${statusClasses}`}>
            {submitState.message}
          </div>
        ) : null}

        <div className="border-t border-white/8 pt-4 text-center text-sm text-white/62">
          By continuing, you agree with our{' '}
          <Link
            href="/politica-de-privacidade"
            className="font-medium text-[var(--primary)] underline-offset-4 transition hover:underline"
          >
            Privacy Policy
          </Link>
          .
        </div>
      </div>
    </div>
  );
}
