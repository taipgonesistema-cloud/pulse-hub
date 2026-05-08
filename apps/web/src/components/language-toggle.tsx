'use client';

import { Languages } from 'lucide-react';
import { useI18n } from '@/i18n/i18n-provider';

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const nextLocale = locale === 'en-US' ? 'pt-BR' : 'en-US';

  return (
    <button
      aria-label={t('Language')}
      className={`inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-contrast-background)] font-medium text-[var(--foreground)] transition hover:border-[var(--primary)]/30 hover:bg-[var(--surface-high)] ${
        compact ? 'px-3 py-2 text-xs' : 'px-4 py-2 text-sm'
      }`}
      onClick={() => setLocale(nextLocale)}
      title={t('Language')}
      type="button"
    >
      <Languages className="h-4 w-4" strokeWidth={2.1} />
      <span>{locale === 'en-US' ? 'EN' : 'PT'}</span>
    </button>
  );
}
