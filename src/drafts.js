import { createHash, randomUUID } from 'node:crypto';
import { campaign, platforms, requirePlatform } from './config.js';
export function steamURL(platform, name = campaign.campaign, content = 'intro') {
  requirePlatform(platform);
  const u = new URL(campaign.steamUrl);
  for (const [k,v] of Object.entries({ utm_source: platform, utm_medium: 'social', utm_campaign: name, utm_content: content })) u.searchParams.set(k,v);
  return u.toString();
}
export function fingerprint(d) {
  return createHash('sha256').update(JSON.stringify([d.platform,d.title,d.text,d.url,d.mediaUrl,d.subreddit,d.scheduledAt])).digest('hex');
}
export function createDrafts(input = {}) {
  const message = input.message ?? campaign.message;
  const name = input.campaign ?? campaign.campaign;
  if (typeof message !== 'string' || !message.trim() || message.length > 3000) throw new Error('Message must contain 1–3000 characters.');
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(name)) throw new Error('Campaign must contain 1–80 letters, numbers, underscores, or hyphens.');
  return platforms.map(platform => {
    const url = steamURL(platform, name);
    const base = `${message}\n\n${campaign.cta}: ${url}`;
    const text = platform === 'instagram' ? `${message}\n\nSteam: ${url}\n#MOSTAREMINE #indiegame\n(Link is plain caption text; update the bio manually.)`
      : platform === 'reddit' ? `Developer disclosure: We are Caffeine Zombie, the developer of MOST ARE MINE.\n\n${base}\n\nWe welcome your feedback.`
      : platform === 'x' ? `${message}\n${url}` : base;
    return { id: randomUUID(), platform, title: campaign.headline, text, url, mediaUrl: '', subreddit: '', scheduledAt: null, status: 'draft', approval: null, createdAt: new Date().toISOString() };
  });
}
export function validate(d) {
  requirePlatform(d.platform);
  if (typeof d.title !== 'string' || typeof d.text !== 'string' || !d.text.trim()) throw new Error('Title and nonempty text are required.');
  if (d.title.length > 100 && d.platform === 'youtube') throw new Error('YouTube title exceeds 100 characters.');
  const limits = { x: 280, threads: 500, instagram: 2200, facebook: 63206, reddit: 40000, youtube: 5000 };
  // Conservative raw length for X: URLs count in full, so this can reject some valid posts.
  if ([...d.text].length > limits[d.platform]) throw new Error(`${d.platform} text exceeds the conservative limit.`);
  if (d.platform === 'reddit' && d.title.length > 300) throw new Error('Reddit title exceeds 300 characters.');
  if (!d.text.includes(d.url) || d.url !== steamURL(d.platform, new URL(d.url).searchParams.get('utm_campaign'))) throw new Error('Keep the canonical per-platform Steam URL in the draft.');
  if (d.mediaUrl && (typeof d.mediaUrl !== 'string' || !d.mediaUrl.startsWith('https://'))) throw new Error('Media must use an HTTPS URL.');
}
export function editDraft(store, id, patch) {
  return store.transaction(() => {
    const d = store.get(id);
    if (['dispatching','published','uncertain'].includes(d.status)) throw new Error('Draft is locked.');
    for (const k of ['title','text','mediaUrl','subreddit']) if (k in patch) { if (typeof patch[k] !== 'string') throw new Error('Draft fields must be strings.'); d[k] = patch[k]; }
    validate(d); d.approval = null; d.status = 'draft'; store.put(d); store.event('draft_edited',id); return d;
  });
}
export function schedule(store,id,iso,now = Date.now()) {
  if (typeof iso !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(iso) || !Number.isFinite(Date.parse(iso)) || Date.parse(iso) <= now) throw new Error('Use a future ISO time with a timezone.');
  return store.transaction(() => {
    const d = store.get(id);
    if (['dispatching','published','uncertain'].includes(d.status)) throw new Error('Draft is locked.');
    d.scheduledAt = new Date(iso).toISOString(); d.approval = null; d.status = 'scheduled'; store.put(d); store.event('scheduled',id,d.scheduledAt); return d;
  });
}
export function approve(store,id,actor) {
  if (typeof actor !== 'string' || !actor.trim() || actor.length > 80) throw new Error('A human reviewer name is required.');
  return store.transaction(() => {
    const d = store.get(id); validate(d);
    if (['dispatching','published','uncertain'].includes(d.status)) throw new Error('Draft is locked.');
    d.approval = { hash: fingerprint(d), actor, at: new Date().toISOString() }; d.status = 'approved'; store.put(d); store.event('human_approved',id); return d;
  });
}
export function approvalValid(d) { return !!d.approval && d.approval.hash === fingerprint(d); }
