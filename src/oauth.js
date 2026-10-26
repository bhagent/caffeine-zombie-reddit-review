import { AuthorizationCode } from 'simple-oauth2';
import debug from 'debug';
// The OAuth client debug namespace can include credentials. Disable it for this process.
debug.disable();
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { requireOAuthProvider, accounts } from './config.js';
import { api } from './adapters.js';
export function provider(p,config) {
  requireOAuthProvider(p); const e = config.env; const key = p.toUpperCase();
  const id = e[`${key}_CLIENT_ID`]; const secret = e[`${key}_CLIENT_SECRET`] || '';
  if (!id || (p !== 'x' && !secret)) throw new Error(`Configure ${key}_CLIENT_ID and required CLIENT_SECRET first.`);
  if (p === 'facebook' && !/^v\d+\.\d+$/.test(e.META_GRAPH_VERSION || '')) throw new Error('Configure META_GRAPH_VERSION first.');
  const configs = {
    google_ads:{ authorize:'https://accounts.google.com/o/oauth2/v2/auth', token:'https://oauth2.googleapis.com/token', scope:'https://www.googleapis.com/auth/adwords', pkce:true, extra:{access_type:'offline',prompt:'consent select_account'} },
    youtube:{ authorize:'https://accounts.google.com/o/oauth2/v2/auth', token:'https://oauth2.googleapis.com/token', scope:'https://www.googleapis.com/auth/youtube.readonly', pkce:true, extra:{access_type:'offline',prompt:'consent select_account'} },
    x:{ authorize:'https://x.com/i/oauth2/authorize', token:'https://api.x.com/2/oauth2/token', scope:'tweet.read tweet.write users.read offline.access', pkce:true },
    instagram:{ authorize:'https://www.instagram.com/oauth/authorize', token:'https://api.instagram.com/oauth/access_token', scope:'instagram_business_basic,instagram_business_content_publish' },
    threads:{ authorize:'https://threads.net/oauth/authorize', token:'https://graph.threads.net/oauth/access_token', scope:'threads_basic,threads_content_publish' },
    facebook:{ authorize:`https://www.facebook.com/${e.META_GRAPH_VERSION}/dialog/oauth`, token:`https://graph.facebook.com/${e.META_GRAPH_VERSION}/oauth/access_token`, scope:'pages_show_list,pages_read_engagement,pages_manage_posts' },
    reddit:{ authorize:'https://www.reddit.com/api/v1/authorize', token:'https://www.reddit.com/api/v1/access_token', scope:'identity submit', extra:{duration:'permanent'} }
  };
  const info = configs[p];
  const redirect = e[`${key}_REDIRECT_URI`] || `${config.origin}/oauth/callback/${p}`;
  if (redirect !== `${config.origin}/oauth/callback/${p}`) throw new Error('This MVP supports only its exact loopback callback. Meta HTTPS setup may require a later tunnel configuration.');
  const a = new URL(info.authorize); const t = new URL(info.token);
  const client = new AuthorizationCode({
    client:{id,secret},
    auth:{authorizeHost:a.origin,authorizePath:a.pathname,tokenHost:t.origin,tokenPath:t.pathname},
    options:{authorizationMethod:(p === 'reddit' || (p === 'x' && secret)) ? 'header':'body',bodyFormat:'form',scopeSeparator:info.scope.includes(',') ? ',':' '},
    http:{timeout:15000,redirects:0,headers:p === 'reddit' ? {'User-Agent':e.REDDIT_USER_AGENT || 'CaffeineZombieMarketingStudio/0.1'} : {}}
  });
  return {client,info,redirect,id};
}
export class OAuth {
  constructor(store,{resolveProvider=provider}={}) { this.store = store; this.pending = new Map(); this.resolveProvider = resolveProvider; }
  begin(p,browser) {
    this.store.key();
    const {client,info,redirect} = this.resolveProvider(p,this.store.config);
    for (const [key,entry] of this.pending) if (entry.expires < Date.now()) this.pending.delete(key);
    if (this.pending.size >= 100) throw new Error('Too many pending OAuth requests.');
    const state = randomBytes(32).toString('base64url'); const verifier = randomBytes(48).toString('base64url');
    this.pending.set(state,{p,browser,verifier,expires:Date.now()+600000});
    const params = {redirect_uri:redirect,scope:info.scope,state,...info.extra};
    if (info.pkce) Object.assign(params,{code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return client.authorizeURL(params);
  }
  consume(p,state,browser,now = Date.now()) {
    const entry = this.pending.get(state);
    // Invalid callbacks cannot consume another browser's valid state.
    if (!entry || entry.p !== p || entry.expires < now || typeof browser !== 'string' || Buffer.byteLength(browser) !== Buffer.byteLength(entry.browser) || !timingSafeEqual(Buffer.from(browser),Buffer.from(entry.browser))) throw new Error('OAuth state is invalid, expired, or belongs to another browser.');
    this.pending.delete(state);
    return entry;
  }
  async callback(p,state,browser,code) {
    const entry = this.consume(p,state,browser);
    if (typeof code !== 'string' || !code || code.length > 4096) throw new Error('OAuth code is missing.');
    const {client,info,redirect,id} = this.resolveProvider(p,this.store.config);
    let token;
    try {
      const result = await client.getToken({code,redirect_uri:redirect,client_id:id,...(info.pkce ? {code_verifier:entry.verifier} : {})});
      token = result.token;
      if (Array.isArray(token.data)) token = token.data[0];
      if (!token?.access_token) throw new Error('Missing token.');
      if (p === 'facebook') {
        const e = this.store.config.env;
        if (e.FACEBOOK_PAGE_ID !== accounts.facebook.candidateId || e.FACEBOOK_PAGE_CONFIRMED !== 'true') throw new Error('Confirm the requested Page first.');
        const pages = await api(`https://graph.facebook.com/${e.META_GRAPH_VERSION}/me/accounts?fields=id,access_token,tasks`,token.access_token,this.store.config);
        const page = pages.data?.find(x => x.id === e.FACEBOOK_PAGE_ID);
        if (!page?.access_token || !page.tasks?.some(t => ['CREATE_CONTENT','MANAGE','PROFILE_PLUS_CREATE_CONTENT'].includes(t))) throw new Error('The requested Page is not managed by this user.');
        token = {access_token:page.access_token,token_type:'bearer'};
      }
    } catch { throw new Error('OAuth exchange failed. Check developer settings, callback, permissions, and account selection.'); }
    if (!token.expires_at && token.expires_in) token.expires_at = new Date(Date.now()+Number(token.expires_in)*1000).toISOString();
    this.store.saveToken(p,token);
  }
  async refresh(p) {
    if (!['youtube','x','reddit','google_ads'].includes(p)) throw new Error('Reconnect this platform. Meta long-lived token renewal is not implemented.');
    let token = this.store.token(p);
    if (!token && p === 'x') {
      const e = this.store.config.env;
      token = {access_token:e.X_ACCESS_TOKEN,refresh_token:e.X_RENEW_TOKEN,token_type:'bearer'};
    }
    if (!token?.refresh_token) throw new Error('No refresh token. Reconnect.');
    // Fail before a rotating token can be exchanged if local storage is not ready.
    this.store.key();
    const {client,id} = this.resolveProvider(p,this.store.config);
    try {
      const updated = (await client.createToken(token).refresh({client_id:id})).token;
      if (!updated?.access_token) throw new Error('Missing access token.');
      this.store.saveToken(p,{...updated,refresh_token:updated.refresh_token || token.refresh_token});
    } catch { throw new Error('Token refresh failed. Reconnect.'); }
  }
}
