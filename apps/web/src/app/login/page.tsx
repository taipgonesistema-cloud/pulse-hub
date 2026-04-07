import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { LoginForm } from '@/components/login-form';
import { ThemeToggle } from '@/components/theme-toggle';

export const metadata: Metadata = {
  title: 'Pulse Hub | Sign in',
  description: 'Acesso da operacao Pulse Hub para atendentes e supervisores.',
};

export default function LoginPage() {
  return (
    <main
      className="relative min-h-screen overflow-hidden px-4 py-8 text-[var(--foreground)] sm:px-6 lg:px-10 lg:py-10"
      style={{ background: 'var(--login-background)' }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:120px_120px] [mask-image:radial-gradient(circle_at_center,black,transparent_90%)]" />

      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-7xl flex-col justify-between gap-8">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/72 transition hover:border-white/20 hover:bg-white/8 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar para dashboard
          </Link>

          <div className="flex items-center gap-3">
            <div className="rounded-full border border-[rgba(255,255,255,0.08)] bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/55">
              Pulse Hub access
            </div>
            <ThemeToggle />
          </div>
        </div>

        <section className="flex min-h-[calc(100vh-9rem)] items-center justify-center">
          <div className="w-full max-w-xl">
            <LoginForm />
          </div>
        </section>
      </div>
    </main>
  );
}
