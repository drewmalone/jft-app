export const STORAGE_KEY = 'doorknob.shares.v1';
export const reflection = {
  id: 'acceptance-2025-04-23',
  date: '2025-04-23',
  title: 'Acceptance is the answer to all my problems today.',
  body: 'Today, I can practice meeting life as it is. Acceptance gives me room to pause, let go of what I cannot change, and take one small step toward what I can.',
};
export type Share = {
  id: string;
  createdAt: string;
  kind: 'text';
  reflection: typeof reflection;
  text: string;
};
export function parseShares(raw: string | null): Share[] {
  if (raw === null) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || !data.every(isShare)) throw new Error('Invalid saved shares');
  return data.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
function isShare(value: unknown): value is Share {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Share>;
  return typeof s.id === 'string' && s.id.length > 0 && s.kind === 'text' &&
    typeof s.createdAt === 'string' && Number.isFinite(Date.parse(s.createdAt)) &&
    typeof s.text === 'string' && s.text.trim().length > 0 && !!s.reflection &&
    ['id', 'date', 'title', 'body'].every(key => typeof s.reflection?.[key as keyof typeof reflection] === 'string');
}
export function createShare(text: string): Share {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Write a few words before saving your share.');
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), kind: 'text', reflection: { ...reflection }, text: trimmed };
}
