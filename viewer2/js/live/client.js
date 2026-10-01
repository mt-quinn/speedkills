import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { connectCloudflare } from './cloudflare-client.js';
const ref = name => makeFunctionReference(name);
export async function connect() {
  const cfg = await fetch('/live-config.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : {});
  if (cfg.cloudflareUrl) return connectCloudflare(cfg);
  if (!cfg.convexUrl) throw new Error('The live league is not connected yet.');
  const client = new ConvexClient(cfg.convexUrl), authClient = new ConvexHttpClient(cfg.convexUrl);
  const key = `hb-auth:${cfg.convexUrl}`;
  const stored = () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const save = tokens => { if(tokens)localStorage.setItem(key,JSON.stringify(tokens));else localStorage.removeItem(key); };
  let refresh;
  async function fetchToken({forceRefreshToken}) {
    const before = stored();
    if (!before?.refreshToken) return null;
    if (!forceRefreshToken) return before.token;
    if (!refresh) {
      const work=async()=>{
        const latest=stored();
        if(!latest)return null;
        if(latest.token!==before.token)return latest.token;
        const result=await authClient.action(ref('auth:signIn'),{refreshToken:latest.refreshToken});
        // A sign-out or another sign-in during this request takes precedence.
        if(stored()?.refreshToken!==latest.refreshToken)return stored()?.token??null;
        save(result.tokens??null);return result.tokens?.token??null;
      };
      refresh=(navigator.locks ? navigator.locks.request(key,work) : work()).finally(()=>{refresh=null;});
    }
    return refresh;
  }
  function bindAuth() {
    if (!stored()) { client.setAuth(async()=>null); return Promise.resolve(false); }
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Sign-in could not reconnect. Please try again.')),20000);
      client.setAuth(fetchToken,authenticated=>{clearTimeout(timeout);resolve(authenticated);});
    });
  }
  if(stored()) { const authenticated=await bindAuth();if(authenticated)await client.mutation(ref('game:join'),{}); }
  const sync=()=>{void bindAuth().catch(()=>{});};
  window.addEventListener('storage',e=>{if(e.key===key)sync();});
  return {
    subscribe(name,args,fn,error){return client.onUpdate(ref(name),args,fn,error);},
    publicSubscribe(name,args,fn,error){return client.onUpdate(ref(name),args,fn,error);},
    call(name,args={}){return client.mutation(ref(name),args);},
    query(name,args={}){return client.query(ref(name),args);},
    action(name,args={}){return client.action(ref(name),args);},
    async signIn(params) {
      const legacyToken=params.flow==='signUp' && params.claimProgress ? localStorage.getItem('hb-session') : null;
      const {claimProgress,...fields}=params;
      const result=await authClient.action(ref('auth:signIn'),{provider:'password',params:{...fields,...(legacyToken?{legacyToken}:{})}});
      if(!result.tokens)return false;
      save(result.tokens);
      if(!await bindAuth())throw new Error('Could not verify your session. Please sign in again.');
      await client.mutation(ref('game:join'),{});
      if(legacyToken)localStorage.removeItem('hb-session');
      return true;
    },
    async signOut(){await client.action(ref('auth:signOut'),{});save(null);client.setAuth(async()=>null);},
    connected(){return client.connectionState().isWebSocketConnected;},
    close(){client.close();},
  };
}
