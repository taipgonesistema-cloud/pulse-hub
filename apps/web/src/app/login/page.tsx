import type { Metadata } from 'next';
import { LoginForm } from '@/components/login-form';
import { ThemeToggle } from '@/components/theme-toggle';

export const metadata: Metadata = {
  title: 'ether command | Sign in',
  description: 'Acesso da operacao ether command para atendentes e supervisores.',
};

export default function LoginPage() {
  return (
    <main
      className="relative min-h-[100dvh] overflow-hidden px-4 py-6 text-[var(--foreground)] sm:px-6 sm:py-8 lg:px-10 lg:py-10"
      style={{ background: 'var(--login-background)' }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:120px_120px] [mask-image:radial-gradient(circle_at_center,black,transparent_90%)]" />

      <div className="relative mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-7xl flex-col justify-between gap-6 sm:min-h-[calc(100dvh-4rem)] sm:gap-8">
        <div className="flex items-center justify-end gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-[rgba(255,255,255,0.08)] bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/55">
              ether command access
            </div>
            <ThemeToggle />
          </div>
        </div>

        <section className="flex min-h-[calc(100dvh-8rem)] items-center justify-center sm:min-h-[calc(100dvh-9rem)]">
          <div className="w-full max-w-xl">
            <LoginForm />
          </div>
        </section>
      </div>
    </main>
  );
}
