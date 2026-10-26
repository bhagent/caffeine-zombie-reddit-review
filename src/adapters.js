import { accounts, platforms, requirePlatform } from './config.js';
import { approvalValid, validate, fingerprint } from './drafts.js';
export class ApiError extends Error {
  constructor(status) { super(`Provider request failed (HTTP ${status}). Check permissions or reconnect.`); this.status = status; }
}
const prefix = p => p.toUpperCase();
export function requirements(p, config) {
  requirePlatform(p); const e = config.env;
  const missing = [];
  if (['facebook','instagram'].includes(p) && !/^v\d+\.\d+$/.test(e.META_GRAPH_VERSION || '')) missing.push('META_GRAPH_VERSION');
  if (p === 'youtube' && !e.YOUTUBE_CHANNEL_ID) missing.push('YOUTUBE_CHANNEL_ID');
  if (p === 'facebook') {
    if (e.FACEBOOK_PAGE_ID !== accounts.facebook.candidateId) missing.push('FACEBOOK_PAGE_ID (must match the requested account)');
    if (e.FACEBOOK_PAGE_CONFIRMED !== 'true') missing.push('FACEBOOK_PAGE_CONFIRMED=true after verifying this is a Page');
  }
  if (p === 'reddit' && !e.REDDIT_USER_AGENT) missing.push('REDDIT_USER_AGENT');
  return missing;
}
export function accessToken(store,p) {
  const e = store.config.env;
  const direct = p === 'facebook' ? e.FACEBOOK_PAGE_ACCESS_TOKEN : e[`${prefix(p)}_ACCESS_TOKEN`];
  // A rotated X token must outrank the original .env token after a restart.
  const stored = p === 'x' ? store.token(p) : null;
  if (direct && !stored) return direct;
  const t = stored || store.token(p);
  if (!t?.access_token) return null;
  if (t.expires_at && Date.parse(t.expires_at) <= Date.now() + 30000) throw new Error('OAuth token expired. Refresh or reconnect.');
  return t.access_token;
}
export async function api(url, token, config, { method = 'GET', body, fetcher = fetch } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !['www.googleapis.com','api.x.com','graph.instagram.com','graph.threads.net','graph.facebook.com','oauth.reddit.com'].includes(u.hostname)) throw new Error('Provider URL is not allowed.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (u.hostname === 'oauth.reddit.com') headers['User-Agent'] = config.env.REDDIT_USER_AGENT;
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  let response;
  try { response = await fetcher(u.toString(), { method, headers, body: body ? new URLSearchParams(body).toString() : undefined, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Provider connection failed or timed out. No automatic retry.'); }
  if (!response.ok) throw new ApiError(response.status);
  try { return await response.json(); } catch { throw new Error('Provider response was not JSON.'); }
}
export async function connect(store,p,fetcher = fetch,tokenSnapshot) {
  requirePlatform(p); const config = store.config;
  const missing = requirements(p,config);
  if (missing.length) return { platform:p, status:'blocked', missing };
  const token = tokenSnapshot ?? accessToken(store,p);
  if (!token) return { platform:p, status:'not_configured', missing:[`${prefix(p)} OAuth or access token`] };
  const e = config.env; const request = u => api(u,token,config,{fetcher});
  let id, username;
  if (p === 'youtube') {
    const r = await request('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true');
    const channel = r.items?.find(c => c.id === e.YOUTUBE_CHANNEL_ID);
    if (!channel) throw new Error('The authorized Brand channel does not match YOUTUBE_CHANNEL_ID.');
    id = channel.id;
  } else if (p === 'x') {
    const r = await request('https://api.x.com/2/users/me'); id = r.data?.id; username = r.data?.username;
  } else if (p === 'instagram') {
    const r = await request(`https://graph.instagram.com/${e.META_GRAPH_VERSION}/me?fields=user_id,username`); id = r.user_id || r.id; username = r.username;
    if (e.INSTAGRAM_USER_ID && String(id) !== e.INSTAGRAM_USER_ID) throw new Error('Instagram user ID mismatch.');
  } else if (p === 'threads') {
    const r = await request('https://graph.threads.net/v1.0/me?fields=id,username'); id = r.id; username = r.username;
    if (e.THREADS_USER_ID && String(id) !== e.THREADS_USER_ID) throw new Error('Threads user ID mismatch.');
  } else if (p === 'facebook') {
    const r = await request(`https://graph.facebook.com/${e.META_GRAPH_VERSION}/me?fields=id,name`); id = r.id;
    if (id !== e.FACEBOOK_PAGE_ID) throw new Error('The Page access token does not match the requested Page.');
  } else {
    const r = await request('https://oauth.reddit.com/api/v1/me'); id = r.id; username = r.name;
  }
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(String(id))) throw new Error('Provider did not return a valid account ID.');
  if (accounts[p].handle && username?.toLowerCase() !== accounts[p].handle.toLowerCase()) throw new Error('Connected account does not match the requested handle.');
  store.event('connection_verified',p);
  return { platform:p, status:'connected', id:String(id), ...(username ? {username} : {}), writePermissions:'not_verified' };
}
export function plan(d,identity = {}) {
  validate(d);
  const blocked = [];
  if (!approvalValid(d)) blocked.push('human_approval_required');
  if (!d.scheduledAt) blocked.push('schedule_required');
  if (d.platform === 'youtube') blocked.push('video_upload_not_implemented');
  if (d.platform === 'instagram') blocked.push('media_publish_not_implemented');
  if (d.platform === 'reddit' && !/^[A-Za-z0-9_]{3,21}$/.test(d.subreddit)) blocked.push('select_and_review_subreddit_rules');
  const routes = { x:'POST /2/tweets', threads:'POST /{user-id}/threads then /threads_publish', facebook:'POST /{page-id}/feed', reddit:'POST /api/submit', youtube:'manual video upload', instagram:'manual media upload' };
  return { draftId:d.id, platform:d.platform, accountId:identity.id || null, hash:fingerprint(d), scheduledAt:d.scheduledAt, mode:'dry-run', route:routes[d.platform], blocked, title:d.title, text:d.text, url:d.url };
}
export function tick(store,now = Date.now()) {
  const results = [];
  for (const d of store.list()) {
    if (!['scheduled','approved'].includes(d.status) || !d.scheduledAt || Date.parse(d.scheduledAt) > now) continue;
    const result = plan(d);
    results.push(result);
    if (d.lastPlanHash !== result.hash) { d.lastPlanHash = result.hash; store.put(d); store.event('dry_run_due',d.id); }
  }
  return results;
}
export async function publish(store,id,confirmation,fetcher = fetch,now = Date.now()) {
  if (store.config.env.ENABLE_LIVE_PUBLISH !== 'true') throw new Error('Live publishing is disabled.');
  if (confirmation !== id) throw new Error('Confirm the exact draft ID.');
  let d = store.get(id);
  const initialHash = fingerprint(d);
  const check = current => {
    const result = plan(current);
    if (current.status !== 'approved' || result.blocked.length || !approvalValid(current) || fingerprint(current) !== initialHash) throw new Error('Approval, schedule, content, or platform gate blocked publication.');
    if (Date.parse(current.scheduledAt) > now) throw new Error('The scheduled time has not arrived.');
  };
  check(d);
  // Use the same token for the identity check and every write, even if OAuth reconnects concurrently.
  const token = accessToken(store,d.platform);
  const identity = await connect(store,d.platform,fetcher,token);
  if (identity.status !== 'connected') throw new Error('Connect the expected account before publishing.');
  store.transaction(() => { d = store.get(id); check(d); d.status = 'dispatching'; store.put(d); store.event('publish_started',id); });
  // Reserve before the request. A crash or ambiguous response requires manual reconciliation, never an automatic retry.
  try {
    const e = store.config.env;
    const request = (u,body) => api(u,token,store.config,{method:'POST',body,fetcher});
    let result, remoteId;
    if (d.platform === 'x') {
      let response;
      try { response = await fetcher('https://api.x.com/2/tweets',{ method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify({text:d.text}), redirect:'error',signal:AbortSignal.timeout(15000) }); }
      catch { throw new Error('Publish result is uncertain.'); }
      if (!response.ok) throw new ApiError(response.status);
      result = await response.json(); remoteId = result.data?.id;
    } else if (d.platform === 'facebook') {
      result = await request(`https://graph.facebook.com/${e.META_GRAPH_VERSION}/${identity.id}/feed`,{message:d.text}); remoteId = result.id;
    } else if (d.platform === 'threads') {
      const container = await request(`https://graph.threads.net/v1.0/${identity.id}/threads`,{media_type:'TEXT',text:d.text});
      if (!container.id) throw new Error('Provider did not return a container ID.');
      result = await request(`https://graph.threads.net/v1.0/${identity.id}/threads_publish`,{creation_id:String(container.id)}); remoteId = result.id;
    } else if (d.platform === 'reddit') {
      result = await request('https://oauth.reddit.com/api/submit',{api_type:'json',kind:'self',sr:d.subreddit,title:d.title,text:d.text});
      if (result.json?.errors?.length) throw new Error('Reddit rejected this submission.');
      remoteId = result.json?.data?.name;
    }
    if (!remoteId || !/^[a-zA-Z0-9_-]+$/.test(remoteId)) throw new Error('Provider did not return a post ID.');
    d.status = 'published'; d.remoteId = remoteId; d.publishedAt = new Date().toISOString(); store.put(d); store.event('published',id,remoteId);
    return { id, status:d.status, remoteId };
  } catch {
    d.status = 'uncertain'; store.put(d); store.event('publish_uncertain',id);
    throw new Error('Publication was attempted. Inspect the account before any manual retry.');
  }
}
export function doctor(store) {
  return platforms.map(p => {
    const missing = requirements(p,store.config);
    let hasToken = false;
    try { hasToken = !!accessToken(store,p); } catch { missing.push('token unavailable, expired, or encryption key missing'); }
    if (!hasToken) missing.push(`${prefix(p)} OAuth or access token`);
    const e = store.config.env;
    return { platform:p, status:missing.length ? 'blocked':'configured_unverified', missing, oauthClientConfigured:!!e[`${prefix(p)}_CLIENT_ID`], liveAdapter:['x','threads','facebook','reddit'].includes(p) ? 'text_only':'manual_only' };
  });
}
