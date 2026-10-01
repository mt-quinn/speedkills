/// <reference types="vite/client" />
import { describe, expect, test, beforeAll, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { generateKeyPair, exportPKCS8, decodeJwt } from 'jose';
import schema from './schema';
import { api } from './_generated/api';
const modules = import.meta.glob('./**/*.ts');
beforeAll(async()=>{
 const {privateKey}=await generateKeyPair('RS256',{extractable:true});
 process.env.JWT_PRIVATE_KEY=await exportPKCS8(privateKey);
 process.env.SITE_URL='https://hardburn.vercel.app';
 process.env.AUTH_RESEND_KEY='test-only';
 process.env.AUTH_EMAIL_FROM='Hard Burn <test@example.com>';
 process.env.CONVEX_SITE_URL='https://accounts-test.convex.site';
});
const signup=(t:any,username='PilotOne',extra={})=>t.action(api.auth.signIn,{provider:'password',params:{flow:'signUp',email:username.toLowerCase()+'@example.com',username,password:'a-test-password-123',...extra}});
async function signed(t:any,name='PilotOne') {
 const result = await signup(t,name);
 const p=await t.run((ctx:any)=>ctx.db.query('players').first());
 return {p,client:t.withIdentity({subject:decodeJwt(result.tokens.token).sub})};
}
describe('account ownership and guest gates',()=>{
 test('spectators watch and read chat without receiving a wallet; browser tokens cannot authorize money or chat',async()=>{
  const t=convexTest(schema,modules);
  const token='a'.repeat(64);
  await t.run(async ctx=>{await ctx.db.insert('players',{token,name:'Legacy',balance:50000,lastChat:0,lastRecovery:0});});
  const home=await t.query(api.game.home,{token});
  expect(home.authenticated).toBe(false);expect(home.player.balance).toBe(0);expect(home.transactions).toEqual([]);
  expect(await t.query(api.chat.list,{})).toEqual([]);
  for(const [fn,args] of [[api.game.join,{token}],[api.game.sponsor,{token}],[api.game.recovery,{token}],[api.chat.send,{token,body:'hello'}],[api.game.tryout,{token,station:'pilot'}],[api.game.profile,{token,name:'Other'}]])await expect(t.mutation(fn as any,args as any)).rejects.toThrow(/account|sign in/);
  expect(await t.run(ctx=>ctx.db.query('players').collect())).toHaveLength(1);
 });
 test('signup funds once; two authenticated devices see the same player and server username',async()=>{
  const t=convexTest(schema,modules),{p,client}=await signed(t);
  const secondId=await t.run(ctx=>ctx.db.insert('authSessions',{userId:p.userId,expirationTime:Date.now()+60000}));
  const second=t.withIdentity({subject:p.userId+'|'+secondId});
  expect((await client.query(api.game.home,{})).player.balance).toBe(50000);
  await second.mutation(api.game.join,{});
  await second.mutation(api.chat.send,{body:'Hello league'});
  expect((await client.query(api.chat.list,{}))[0].name).toBe('PilotOne');
  expect((await second.query(api.game.home,{})).player.id).toBe(p._id);
  expect(await t.run(ctx=>ctx.db.query('ledger').collect())).toHaveLength(1);
  const otherSubject=await t.run(async ctx=>{const userId=await ctx.db.insert('users',{name:'Other',email:'other@example.com'});const sessionId=await ctx.db.insert('authSessions',{userId,expirationTime:Date.now()+60000});return userId+'|'+sessionId;});
  const other=t.withIdentity({subject:otherSubject});
  expect((await other.query(api.game.home,{})).player.balance).toBe(0);
  await expect(other.mutation(api.game.sponsor,{token:'a'.repeat(64)})).rejects.toThrow(/account/);
 });
 test('claim keeps the legacy player, wallet, ship and ledger, and erases its old bearer token',async()=>{
  const t=convexTest(schema,modules),token='b'.repeat(64);
  const id=await t.run(async ctx=>{
   const id=await ctx.db.insert('players',{token,name:'Old name',balance:81200,lastChat:0,lastRecovery:0});
   await ctx.db.insert('ships',{owner:id,name:'Starling',style:'Knife',crew:[],identity:123,revision:1,earnings:10000,wins:2,fights:5,lastFight:0});
   await ctx.db.insert('ledger',{player:id,kind:'owner',amount:10000,balance:81200,note:'Owner payout'});return id;
  });
  const result=await signup(t,'NewName',{legacyToken:token});
  const p=await t.run(ctx=>ctx.db.get(id));
  expect(p?.token).toBeUndefined();expect(p?.balance).toBe(81200);expect(p?.name).toBe('NewName');
  const home=await t.withIdentity({subject:decodeJwt(result.tokens.token).sub}).query(api.game.home,{});
  expect(home.ship?.name).toBe('Starling');expect(home.transactions).toHaveLength(1);
  expect(await t.run(ctx=>ctx.db.query('players').collect())).toHaveLength(1);
 });
 test('usernames are unique without case sensitivity, and invalid usernames/passwords are rejected',async()=>{
  const t=convexTest(schema,modules);await signup(t,'PilotOne');
  await expect(signup(t,'pilotone',{email:'other@example.com'})).rejects.toThrow(/taken/);
  await expect(signup(t,'<bad>')).rejects.toThrow(/letters/);
  await expect(signup(t,'PilotTwo',{password:'short'})).rejects.toThrow(/12/);
  expect(await t.run(ctx=>ctx.db.query('players').collect())).toHaveLength(1);
 });
 test('revoked sessions immediately lose access even with an unexpired access token',async()=>{
  const t=convexTest(schema,modules),{client}=await signed(t);
  await t.run(async ctx=>{const session=await ctx.db.query('authSessions').first();await ctx.db.delete(session!._id);});
  expect((await client.query(api.game.home,{})).authenticated).toBe(false);
  await expect(client.mutation(api.chat.send,{body:'not permitted'})).rejects.toThrow(/account/);
 });
 test('password recovery requires the correct emailed code and revokes previous sessions',async()=>{
  const t=convexTest(schema,modules);await signup(t);
  const email='pilotone@example.com';
  const delivery=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:200}));
  try {
   await t.action(api.auth.signIn,{provider:'password',params:{flow:'reset',email}});
   const payload=JSON.parse(String(delivery.mock.calls[0][1]!.body));
   const code=payload.text.match(/code is ([0-9]{8})/)[1];
   const old=await t.run(ctx=>ctx.db.query('authSessions').collect());
   expect(old.length).toBeGreaterThan(0);
   await expect(t.action(api.auth.signIn,{provider:'password',params:{flow:'reset-verification',email,code:'not-a-code',newPassword:'replacement-password-456'}})).rejects.toThrow();
   const reset=await t.action(api.auth.signIn,{provider:'password',params:{flow:'reset-verification',email,code,newPassword:'replacement-password-456'}});
   expect(reset.tokens?.token).toBeTruthy();
   for(const session of old) expect(await t.run(ctx=>ctx.db.get(session._id))).toBeNull();
   await expect(t.action(api.auth.signIn,{provider:'password',params:{flow:'signIn',email,password:'a-test-password-123'}})).rejects.toThrow();
   expect((await t.action(api.auth.signIn,{provider:'password',params:{flow:'signIn',email,password:'replacement-password-456'}})).tokens?.token).toBeTruthy();
  } finally { delivery.mockRestore(); }
 });
 test('password sign-in succeeds and rejects wrong credentials',async()=>{
  const t=convexTest(schema,modules);await signup(t);
  const login={provider:'password',params:{flow:'signIn',email:'pilotone@example.com',password:'a-test-password-123'}};
  expect((await t.action(api.auth.signIn,login)).tokens?.token).toBeTruthy();
  await expect(t.action(api.auth.signIn,{...login,params:{...login.params,password:'incorrect-password'}})).rejects.toThrow();
 });
});
