'use client';

import { MoonStar, SunMedium } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';

const themeStorageKey = 'pulse-hub.theme';

type ThemeMode = 'dark' | 'light';

type ThemeListener = () => void;

let currentTheme: ThemeMode = 'dark';
const themeListeners = new Set<ThemeListener>();

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

function subscribeTheme(listener: ThemeListener) {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

function getThemeSnapshot() {
  return currentTheme;
}

function getServerThemeSnapshot(): ThemeMode {
  return 'dark';
}

function updateTheme(theme: ThemeMode) {
  currentTheme = theme;
  applyTheme(theme);
  themeListeners.forEach((listener) => listener());
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);

  const isLight = theme === 'light';

  useEffect(() => {
    updateTheme(resolvePreferredTheme());
  }, []);

  return (
    <button
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      className={`inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-contrast-background)] font-medium text-[var(--foreground)] transition hover:border-[var(--primary)]/30 hover:bg-[var(--surface-high)] ${
        compact ? 'px-3 py-2 text-xs' : 'px-4 py-2 text-sm'
      }`}
      onClick={() => {
        const nextTheme: ThemeMode = isLight ? 'dark' : 'light';
        updateTheme(nextTheme);
      }}
      type="button"
    >
      {isLight ? <MoonStar className="h-4 w-4" strokeWidth={2.1} /> : <SunMedium className="h-4 w-4" strokeWidth={2.1} />}
      <span>{isLight ? 'Dark' : 'Light'}</span>
    </button>
  );
}
