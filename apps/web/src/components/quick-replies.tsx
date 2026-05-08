'use client';

import { Eye, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AuthUser, QuickReplyRecord, SaveQuickReplyPayload } from '@/lib/pulse-hub';

type QuickReplyFormState = SaveQuickReplyPayload;

export function QuickRepliesSettingsPanel({
  items,
  isLoading,
  searchTerm,
  selectedIds,
  users,
  onSearchChange,
  onOpenCreate,
  onPreview,
  onEdit,
  onDelete,
  onToggleSelection,
  onToggleAll,
}: {
  items: QuickReplyRecord[];
  isLoading: boolean;
  searchTerm: string;
  selectedIds: string[];
  users: AuthUser[];
  onSearchChange: (value: string) => void;
  onOpenCreate: () => void;
  onPreview: (item: QuickReplyRecord) => void;
  onEdit: (item: QuickReplyRecord) => void;
  onDelete: (item: QuickReplyRecord) => void;
  onToggleSelection: (id: string) => void;
  onToggleAll: () => void;
}) {
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
            Quick replies
          </p>
          <h3 className="font-headline mt-2 text-2xl font-semibold text-white">
            Centralize reusable support shortcuts
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Create ready-to-use replies with controlled visibility to speed up support and trigger chat autocomplete by typing <code>/</code>.
          </p>
        </div>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-5 py-3 text-sm font-semibold text-black"
          onClick={onOpenCreate}
          type="button"
        >
          <Plus className="h-4 w-4" strokeWidth={2.2} />
          New quick reply
        </button>
      </div>

      <div className="glass-panel rounded-[30px] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full max-w-xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" strokeWidth={2.1} />
            <input
              className="w-full rounded-[22px] border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none transition focus:border-[var(--primary)]/30"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search by name, shortcut, or content"
              value={searchTerm}
            />
          </label>
          <span className="rounded-full bg-white/5 px-3 py-1.5 text-[11px] text-[var(--muted)]">
            {items.length} replies
          </span>
        </div>

        <div className="app-panel-contrast mt-5 overflow-x-auto rounded-[24px] border border-white/8">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-white/8 bg-white/[0.03] text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              <tr>
                <th className="px-4 py-4">
                  <input checked={allSelected} onChange={onToggleAll} type="checkbox" />
                </th>
                <th className="px-4 py-4">Name</th>
                <th className="px-4 py-4">Created</th>
                <th className="px-4 py-4">Visible to</th>
                <th className="px-4 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <tr key={index}>
                    <td className="px-4 py-4" colSpan={5}>
                      <div className="h-14 animate-pulse rounded-2xl bg-white/5" />
                    </td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td className="px-4 py-12 text-center text-sm text-zinc-500" colSpan={5}>
                    No quick reply found.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="transition hover:bg-white/[0.03]">
                    <td className="px-4 py-4 align-top">
                      <input checked={selectedIds.includes(item.id)} onChange={() => onToggleSelection(item.id)} type="checkbox" />
                    </td>
                    <td className="px-4 py-4 align-top">
                      <div>
                        <p className="font-semibold text-white">{item.name}</p>
                        <p className="mt-1 text-xs text-zinc-500">/{item.shortcut}</p>
                        <p className="mt-2 line-clamp-2 max-w-xl text-sm text-zinc-400">{item.content}</p>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top text-sm text-zinc-400">{formatTimestamp(item.createdAt)}</td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-white/6 px-3 py-1 text-[11px] font-semibold text-zinc-300">
                          {formatVisibilityLabel(item, users)}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${item.status === 'active' ? 'bg-[var(--secondary)]/14 text-[var(--secondary)]' : 'bg-rose-500/14 text-rose-300'}`}>
                          {item.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex justify-end gap-2">
                        <ActionButton icon={<Eye className="h-4 w-4" />} label="Preview" onClick={() => onPreview(item)} />
                        <ActionButton icon={<Pencil className="h-4 w-4" />} label="Edit" onClick={() => onEdit(item)} />
                        <ActionButton destructive icon={<Trash2 className="h-4 w-4" />} label="Delete" onClick={() => onDelete(item)} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function QuickReplyFormModal({
  mode,
  users,
  value,
  isBusy,
  onClose,
  onChange,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  users: AuthUser[];
  value: QuickReplyFormState;
  isBusy: boolean;
  onClose: () => void;
  onChange: (next: QuickReplyFormState) => void;
  onSubmit: () => void;
}) {
  return (
    <QuickReplyModalShell onClose={onClose} title={mode === 'create' ? 'New quick reply' : 'Edit quick reply'}>
      <div className="space-y-4">
        <LabeledInput label="Name" value={value.name} onChange={(name) => onChange({ ...value, name })} />
        <LabeledInput
          label="Shortcut"
          prefix="/"
          value={value.shortcut}
          onChange={(shortcut) => onChange({ ...value, shortcut: sanitizeQuickReplyShortcut(shortcut) })}
        />
        <LabeledTextarea label="Content" value={value.content} onChange={(content) => onChange({ ...value, content })} />
        <LabeledInput label="Category" value={value.category ?? ''} onChange={(category) => onChange({ ...value, category })} />

        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Visibility</p>
          <div className="grid gap-2 md:grid-cols-2">
            <button
              className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${value.visibilityScope === 'all' ? 'border-[var(--primary)]/30 bg-[var(--primary)]/12 text-white' : 'border-white/10 bg-white/5 text-zinc-300 hover:text-white'}`}
              onClick={() => onChange({ ...value, visibilityScope: 'all', visibilityUserId: '' })}
              type="button"
            >
              Everyone
            </button>
            <button
              className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${value.visibilityScope === 'user' ? 'border-[var(--primary)]/30 bg-[var(--primary)]/12 text-white' : 'border-white/10 bg-white/5 text-zinc-300 hover:text-white'}`}
              onClick={() => onChange({ ...value, visibilityScope: 'user' })}
              type="button"
            >
              Specific user
            </button>
          </div>
          {value.visibilityScope === 'user' ? (
            <select
              className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
              onChange={(event) => onChange({ ...value, visibilityUserId: event.target.value })}
              value={value.visibilityUserId ?? ''}
            >
              <option value="">Select the user</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Status</p>
            <div className="grid grid-cols-2 gap-2 rounded-[1.35rem] border border-white/10 bg-white/5 p-2">
              {(['active', 'inactive'] as const).map((status) => (
                <button
                  key={status}
                  className={`rounded-2xl px-3 py-3 text-sm font-medium transition ${value.status === status ? 'bg-[linear-gradient(135deg,#7fafff,#64a1ff)] text-black' : 'bg-white/5 text-zinc-300 hover:text-white'}`}
                  onClick={() => onChange({ ...value, status })}
                  type="button"
                >
                  {status === 'active' ? 'Active' : 'Inactive'}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-[1.35rem] border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Preview</p>
            <p className="mt-2 text-sm text-zinc-300">/{value.shortcut || 'shortcut'} - {value.name || 'Reply name'}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white">{value.content || 'Type the content to preview the final text.'}</p>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button className="rounded-full bg-white/5 px-4 py-2 text-sm text-zinc-300" onClick={onClose} type="button">
          Cancel
        </button>
        <button className="rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-5 py-2 text-sm font-semibold text-black disabled:opacity-60" disabled={isBusy} onClick={onSubmit} type="button">
          {mode === 'create' ? 'Create reply' : 'Save reply'}
        </button>
      </div>
    </QuickReplyModalShell>
  );
}

export function QuickReplyPreviewModal({
  item,
  users,
  onClose,
}: {
  item: QuickReplyRecord;
  users: AuthUser[];
  onClose: () => void;
}) {
  return (
    <QuickReplyModalShell onClose={onClose} title={item.name}>
      <div className="space-y-4 rounded-[24px] border border-white/8 bg-white/5 p-5">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-[var(--primary)]/12 px-3 py-1 text-[11px] font-semibold text-[var(--primary)]">/{item.shortcut}</span>
          <span className="rounded-full bg-white/6 px-3 py-1 text-[11px] font-semibold text-zinc-300">{item.category || 'Uncategorized'}</span>
          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${item.status === 'active' ? 'bg-[var(--secondary)]/14 text-[var(--secondary)]' : 'bg-rose-500/14 text-rose-300'}`}>{item.status === 'active' ? 'Active' : 'Inactive'}</span>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Visible to</p>
          <p className="mt-2 text-sm text-white">{formatVisibilityLabel(item, users)}</p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Content</p>
          <p className="app-panel-contrast mt-2 whitespace-pre-wrap rounded-[22px] border border-white/8 px-4 py-4 text-sm leading-7 text-white">{item.content}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <MetaCard label="Created" value={`${formatTimestamp(item.createdAt)} by ${item.createdBy || 'system'}`} />
          <MetaCard label="Updated" value={`${formatTimestamp(item.updatedAt)} by ${item.updatedBy || 'system'}`} />
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <button className="rounded-full bg-white/5 px-4 py-2 text-sm text-zinc-300" onClick={onClose} type="button">
          Close
        </button>
      </div>
    </QuickReplyModalShell>
  );
}

export function QuickReplyDeleteModal({
  item,
  isBusy,
  onClose,
  onConfirm,
}: {
  item: QuickReplyRecord;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <QuickReplyModalShell onClose={onClose} title="Delete quick reply">
      <p className="text-sm leading-7 text-zinc-300">
        You are about to delete <span className="font-semibold text-white">{item.name}</span> ({`/${item.shortcut}`}). This action removes the shortcut from chat autocomplete.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button className="rounded-full bg-white/5 px-4 py-2 text-sm text-zinc-300" onClick={onClose} type="button">
          Cancel
        </button>
        <button className="rounded-full bg-rose-500/90 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={isBusy} onClick={onConfirm} type="button">
          Delete
        </button>
      </div>
    </QuickReplyModalShell>
  );
}

export function QuickReplyAutocomplete({
  items,
  activeIndex,
  isLoading,
  open,
  query,
  onHover,
  onSelect,
}: {
  items: QuickReplyRecord[];
  activeIndex: number;
  isLoading: boolean;
  open: boolean;
  query: string;
  onHover: (index: number) => void;
  onSelect: (item: QuickReplyRecord) => void;
}) {
  if (!open) {
    return null;
  }

  const safeActiveIndex = items.length > 0 ? Math.min(activeIndex, items.length - 1) : 0;

  return (
    <div className="absolute bottom-[calc(100%+0.8rem)] left-0 right-0 z-20 overflow-hidden rounded-[26px] border border-white/10 bg-[rgba(12,15,20,0.96)] shadow-[0_24px_48px_-18px_rgba(0,0,0,0.95)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Quick replies</p>
          <p className="mt-1 text-xs text-zinc-400">
            {query
              ? <>Searching for <span className="font-semibold text-white">/{query}</span></>
              : 'Type to filter or choose a ready-to-use reply.'}
          </p>
        </div>
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Enter or Tab
        </span>
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        {isLoading ? (
          <div className="space-y-2 p-1">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-[20px] bg-white/5" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-white/8 px-4 py-6 text-center text-sm text-zinc-500">
            {query ? 'No quick reply found for this shortcut.' : 'No quick reply available.'}
          </div>
        ) : (
          items.map((item, index) => (
            <button
              key={item.id}
              className={`w-full rounded-[20px] px-4 py-3 text-left transition ${safeActiveIndex === index ? 'bg-[var(--primary)]/14 text-white' : 'text-zinc-300 hover:bg-white/5 hover:text-white'}`}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(item);
              }}
              onMouseEnter={() => onHover(index)}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{item.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">/{item.shortcut} · {item.category || 'Uncategorized'}</p>
                </div>
                <span className="rounded-full bg-white/6 px-2.5 py-1 text-[10px] font-semibold text-zinc-400">{item.visibilityScope === 'all' ? 'Everyone' : 'User'}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-400">{item.content}</p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function QuickReplyModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="app-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center px-4 py-8 backdrop-blur-md">
      <div className="app-modal-surface w-full max-w-3xl rounded-[32px] border border-white/10 p-6 md:p-7">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-headline text-2xl font-semibold text-white">{title}</h3>
          <button className="rounded-full bg-white/5 px-3 py-2 text-sm text-zinc-300" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  destructive = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition ${destructive ? 'border-rose-500/20 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15' : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'}`}
      onClick={onClick}
      type="button"
    >
      {icon}
    </button>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  prefix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
}) {
  return (
    <label className="block">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
        {prefix ? <span className="mr-2 text-sm text-zinc-500">{prefix}</span> : null}
        <input className="w-full bg-transparent text-sm text-white outline-none" onChange={(event) => onChange(event.target.value)} value={value} />
      </div>
    </label>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <textarea className="min-h-36 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-2 text-sm text-white">{value}</p>
    </div>
  );
}

function formatVisibilityLabel(item: QuickReplyRecord, users: AuthUser[]) {
  if (item.visibilityScope === 'all') {
    return 'Everyone';
  }

  return users.find((user) => user.id === item.visibilityUserId)?.name || 'Specific user';
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sanitizeQuickReplyShortcut(value: string) {
  return value.replaceAll('/', '').trimStart().toLowerCase();
}
