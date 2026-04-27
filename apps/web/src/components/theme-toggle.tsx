'use client';

import { MoonStar, SunMedium } from 'lucide-react';
import { useEffect, useState } from 'react';

const themeStorageKey = 'pulse-hub.theme';

type ThemeMode = 'dark' | 'light';

function resolvePreferredTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const storedTheme = window.localStorage.getItem(themeStorageKey);
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme;
  }

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(themeStorageKey, theme);
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ThemeMode>(() => resolvePreferredTheme());

  const isLight = theme === 'light';

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <button
      aria-label={`Alternar para modo ${isLight ? 'escuro' : 'claro'}`}
      className={`inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-contrast-background)] font-medium text-[var(--foreground)] transition hover:border-[var(--primary)]/30 hover:bg-[var(--surface-high)] ${
        compact ? 'px-3 py-2 text-xs' : 'px-4 py-2 text-sm'
      }`}
      onClick={() => {
        const nextTheme: ThemeMode = isLight ? 'dark' : 'light';
        setTheme(nextTheme);
      }}
      type="button"
    >
      {isLight ? <MoonStar className="h-4 w-4" strokeWidth={2.1} /> : <SunMedium className="h-4 w-4" strokeWidth={2.1} />}
      <span>{isLight ? 'Escuro' : 'Claro'}</span>
    </button>
  );
}
