import { readAudioMix, saveAudioMix, readViewerSettings, saveViewerSettings, AUDIO_DEFAULTS, VIEW_DEFAULTS } from '../preferences.js';
import { renderSettings } from './settings.js';
import { toggleFightFullscreen } from '../fullscreen.js';
import { shipBetTotal } from './bet-totals.js';
import { geeResistance } from '../gee.js';
import { connect } from './client.bundle.js';
import { audioHost, captureAudioInteractions } from '../audio-context.js';
import { sessionMusic } from '../session-music.js';
import { portrait } from '../portraits.js';
import { renderBetting } from './betting.js';
import { renderResults } from './results.js';
import { renderArchive, filterFights, archiveCsv } from './archive.js';
import { rating } from '../prematch.js';
const query = new URLSearchParams(location.search);
if (query.has('studio') || query.has('audit') || query.has('auditall') || query.has('story')) {
  document.body.removeAttribute('data-screen'); await import('../main.js');
} else {
  await start();
}
async function start() {
  const shell = document.querySelector('#league-shell');
  const audio = audioHost();
  audio.musicManaged=true;
  const music=sessionMusic(audio);
  let mix=readAudioMix(),viewerSettings=readViewerSettings();
  music.setEnabled(mix.music);music.setVolume(mix.musicVolume);
  let audioPlaying = false;
  function audioStatus() {
    const button = shell.querySelector('[data-do="sound"]');
    const playing=audioPlaying||music.playing;
    if (button) {
      button.textContent = screen==='settings'?(audio.muted?'Enable sound':'Mute all'):playing ? 'Sound on' : audio.muted ? 'Sound off' : 'Enable sound';
      button.setAttribute('aria-pressed', String(screen==='settings'?!audio.muted:playing));
    }
  }
  function retryAudio(event) {
    if (event?.target?.closest?.('[data-do="sound"]')) return;
    if (!audioPlaying || music.media.paused || audio.context?.state !== 'running') {
      audio.resume();
      music.start();
      // Direct same-origin call retains the gesture; postMessage alone loses it.
      if(!audio.muted)document.querySelector('#hb-feed')?.contentWindow?.__hbRetryAudio?.();
    }
  }
  captureAudioInteractions(retryAudio);
  const credits = n => Math.round(n / 100).toLocaleString();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stations = { pilot:'Pilot', gunner:'Gunner', engineer:'Engineer', ops:'Ops' };
  const skills = { pilot:'Handling', gunner:'Gunnery', engineer:'Engineering', ops:'Defence' };
  const doctrines = { Reference:'Duelist', Knife:'Knife fighter', Counter:'Counterpuncher' };
  let dockScene, sceneLoading=false, profileSaving=false, profileSaved=false, profileOpen=false;
  let service, data, screen = 'hangar', offset = 0, busy = false, station = null, renaming = false, notice = '', archive = [], chat = [], unsubscribeChat;
  let archiveState={view:'fights',query:'',filter:'all',sort:'recent',detailTab:'combat'};
  let chatShown = localStorage.getItem('hb-chat-visible') === null ? matchMedia('(min-width:761px)').matches : localStorage.getItem('hb-chat-visible') !== 'false';
  let mountedFight, mounting, preparedMount, traceSubscription, traceUrl, feedElement, lastKey = '', lastChatKey = '';
  const readyFrames=new WeakSet();
  let draft; try { draft = JSON.parse(sessionStorage.getItem('hb-wager-draft') || 'null'); } catch {}
  const drafts = { rename:'', message:'', viewer:'' };
  const now = () => Date.now() + offset;
  const phase = f => !f || now() >= f.nextAt ? 'preparing' : now() < f.startsAt ? 'betting' : now() < f.endsAt ? 'combat' : 'results';
  const primary = (label, action, disabled = false) => `<button class="hb-primary" data-do="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  function crewTile(c, clickable = false) {
    const art = portrait(c.name), r = rating(c.skill);
    return `<${clickable ? 'button' : 'article'} class="hb-crew" ${clickable ? `data-station="${c.station}"` : ''}><div class="hb-face" style="--face:url('/assets/portraits/${art.file}');--face-color:${art.color}"></div><div class="hb-crew-copy"><span class="hb-eyebrow">${stations[c.station]}</span><b>${esc(c.name)}</b><div class="hb-rating"><span>${skills[c.station]}</span><strong>${r}<small>/99</small></strong></div><div class="hb-meter"><i style="width:${r}%"></i></div><div class="hb-rating"><span>Gee resistance</span><strong>${geeResistance(c)}<small>/10</small></strong></div></div></${clickable ? 'button' : 'article'}>`;
  }
  function livePanel() {
    const f=data.fight,p=phase(f),mine=f?.ships.some(s=>s.owner===data.player.id);
    return `<section class="dock-arena phase-${p} ${mine?'owner-fight':''}" aria-label="Live broadcast"><div class="arena-frequency"><i class="live-dot"></i><span>LIVE BROADCAST</span><small>${f?(mine?'YOUR SHIP / ':'')+'MATCH '+String(f.sequence).padStart(4,'0'):'NEXT MATCH'}</small></div><div class="arena-pair">${f?f.ships.map((s,i)=>`<b class="t${i}">${esc(s.name)}</b>${i===0?'<span>VS</span>':''}`).join(''):'<b>Matchup incoming</b>'}</div><div class="arena-status"><span>${p==='betting'?'BETTING OPEN':p==='combat'?'FIGHT IN PROGRESS':p==='results'?'FINAL / NEXT FIGHT':'PREPARING'}</span><b data-countdown></b>${data.wager?`<small>${credits(data.wager.stake)} cr backed</small>`:''}</div>${primary(p==='betting'?'Watch & bet':p==='combat'?'Watch live':p==='results'?'View result':'Open broadcast', 'broadcast')}</section>`;
  }
  function candidatePanel() {
    const cand=data.player.candidate;if(!cand)return '';
    const current=data.ship.crew.find(c=>c.station===cand.crew.station),delta=rating(cand.crew.skill)-rating(current.skill),gDelta=geeResistance(cand.crew)-geeResistance(current);
    return `<div class="dock-inline-candidate"><div class="candidate-divider"><span>CANDIDATE / ${credits(cand.paid)} CR PAID</span><i>↓</i></div>${crewTile(cand.crew)}<div class="candidate-delta"><span class="${delta>0?'positive':''}">${delta>=0?'+':''}${delta} ${skills[cand.crew.station]}</span><span class="${gDelta>0?'positive':''}">${gDelta>=0?'+':''}${gDelta} gee resistance</span></div><div class="dock-decision">${primary('Hire','accept',data.ship.locked)}<button data-do="reject">Keep ${esc(current.name)}</button></div>${data.ship.locked?'<p class="dock-small-note">Hiring opens after the fight.</p>':''}</div>`;
  }
  function ownerPanel(s, transactions) {
    const f=data.fight,p=phase(f),inMatch=f?.ships.some(ship=>ship.id===s._id),active=inMatch&&p!=='preparing',income=data.lastOwnerIncome;
    const upcoming=data.upcoming;
    const queueTitle=upcoming?upcoming.fightsRemaining===1?'Up next':`In ${upcoming.fightsRemaining} fights`:'Scheduling next appearance';
    const status=active?p==='betting'?'Betting open':p==='combat'?'Fighting now':'Result final':queueTitle;
    const opponent=active?f.ships.find(ship=>ship.id!==s._id):null;
    const activity=data.shipActivity||[],recovered=Math.min(100,s.earnings/data.economy.sponsor*100);
    return `<div class="inspector-heading owner-heading"><span>SHIP STATUS / ${esc(doctrines[s.style])}</span><b>League record</b></div>
      <section class="owner-status ${active?'is-active':''}"><div><i></i><b>${status}</b>${active?`<small>#${String(f.sequence).padStart(4,'0')}</small>`:''}</div><p>${active?`Against <strong>${esc(opponent.name)}</strong>${p==='results'?'. Crew changes are available.':'. Crew changes are locked.'}`:upcoming?`Against <strong>${esc(upcoming.opponent)}</strong>.`:'Your ship enters the shared match rotation automatically.'}</p>${active?'<button data-do="broadcast">Open live broadcast <span>↗</span></button>':`<small>${upcoming?upcoming.fightsRemaining===1?'Betting opens after the current match.':`${upcoming.fightsRemaining-1} scheduled matchups ahead of yours.`:'Waiting for the next rotation.'}</small><div class="owner-queue-note"><span>CREW CHANGES OPEN</span><small>Upgrades keep your place. Sponsored ships have queue priority.</small></div>`}</section>${active&&upcoming?`<div class="owner-next-appearance"><span>NEXT APPEARANCE</span><b>${queueTitle}</b><small>Against ${esc(upcoming.opponent)}</small></div>`:''}
      <div class="owner-career" aria-label="Career record"><div><b>${s.wins}</b><span>WINS</span></div><div><b>${s.fights}</b><span>APPEARANCES</span></div><div><b>${s.fights?Math.round(s.wins/s.fights*100):'—'}<small>${s.fights?'%':''}</small></b><span>WIN RATE</span></div></div>
      <section class="owner-recent"><header><span>RECENT RESULTS</span><small>NEWEST FIRST</small></header>${activity.length?activity.map(a=>`<article><b class="result-mark ${a.result}" aria-label="${a.result}">${{win:'W',loss:'L',draw:'D'}[a.result]}</b><div><strong>${esc(a.opponent)}</strong><small>MATCH ${String(a.sequence).padStart(4,'0')} · ${a.hull}% HULL LEFT</small></div><span class="${a.income>0?'positive':''}">${a.income>0?'+'+credits(a.income)+' cr':a.result==='loss'?'No payout':a.result==='draw'?'Draw':'0 cr'}</span></article>`).join(''):`<p>${s.fights?'Earlier appearances are outside the recent match window.':'No completed fights yet. Your first result will appear here.'}</p>`}<small class="owner-reset-note">Ship and crew are restored after each fight.</small></section>
      <section class="owner-income"><header><span>OWNER INCOME</span><b>AUTO-CREDITED</b></header><div class="owner-income-total"><strong>${credits(s.earnings)}<small>cr</small></strong><span>Lifetime earnings</span></div><div class="owner-income-row"><span>Last payout</span><b>${income?'+'+credits(income.amount)+' cr':'—'}</b></div><div class="owner-income-row"><span>Average per win</span><b>${s.wins?credits(Math.round(s.earnings/s.wins))+' cr':'—'}</b></div><div class="owner-cost-track" role="meter" aria-label="Sponsorship cost earned back" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(recovered)}"><i style="width:${recovered}%"></i></div><small class="owner-cost-label">${Math.round(recovered)}% of ${credits(data.economy.sponsor)} cr sponsorship earned back</small><details class="owner-payout-rules"><summary>How payouts work <b>1%</b></summary><p>A win pays you 1% of the profit earned by bettors who backed your ship. Stakes are excluded. Payment goes straight to your credit balance, even while you are away.</p><p>Example: 10,000 cr in bettor profit pays you 100 cr. A loss or draw pays no owner income.</p><small>This prototype includes simulated spectator bets.</small></details></section>
      ${transactions}<button class="dock-registry-action" data-do="rename-open" ${s.locked?'disabled':''}>Rename ship <span>${credits(data.economy.rename)} cr</span></button>`;
  }
  function hangar() {
    const s=data.ship,e=data.economy,afford=data.player.balance>=e.sponsor;
    const pendingStation=data.player.candidate?.crew.station;
    const blankStations=Object.entries(stations).map(([key,label],i)=>`<div class="dock-empty-station"><span class="station-number">0${i+1}</span><b>${label}</b><span class="empty-seat-mark">—</span><small>UNASSIGNED</small></div>`).join('');
    const transactions=`<details class="dock-income-log"><summary>Transaction log <span>+</span></summary><div>${data.transactions.map(t=>`<article><span>${esc(t.note)}</span><b class="${t.amount>0?'positive':''}">${t.amount>0?'+':''}${credits(t.amount)} cr</b></article>`).join('')}</div></details>`;
    const rename=renaming?`<form data-form="rename" class="dock-rename"><label for="ship-name">SHIP REGISTRY / NAME</label><input id="ship-name" name="name" value="${esc(drafts.rename)}" minlength="2" maxlength="24" required><button class="hb-primary" ${s.locked?'disabled':''}>Confirm / ${credits(e.rename)} cr</button><button type="button" data-do="rename-open">Cancel</button></form>`:'';
    const inspector=!s?`<div class="inspector-heading"><span>SPONSORSHIP</span><b>Sponsor a ship</b></div><p class="dock-intro">Earn enough credits to sponsor your own ship in the fights.</p><div class="dock-sponsor-cost"><span>SHIP + FOUR CREW</span><b>${credits(e.sponsor)}<small>CR</small></b></div><div class="dock-funding"><div><span>AVAILABLE</span><b>${credits(data.player.balance)} cr</b></div><div class="funding-track"><i style="width:${Math.min(100,100*data.player.balance/e.sponsor)}%"></i></div><small>${afford?'READY TO REGISTER':`${credits(e.sponsor-data.player.balance)} CR TO GO`}</small></div>${primary(afford?'Sponsor ship':'Watch & bet',afford?'sponsor':'broadcast')}<div class="dock-sponsor-terms"><span>01</span><p>Watch the live broadcast and bet on a duel.</p><span>02</span><p>Sponsor a ship with your earnings.</p><span>03</span><p>Hire crew. Receive income from wins.</p></div>`:renaming?rename:ownerPanel(s,transactions);
    return `<main class="dock-layout ${s?'has-ship':'no-ship'} ${pendingStation?'candidate-open':''}"><section class="dock-main"><header class="dock-registration"><div><span class="dock-overline">HANGAR / BERTH 01</span><h1>${s?esc(s.name):'Unregistered'}</h1></div><div class="dock-readiness"><i></i><b>${s?s.locked?'IN CURRENT MATCH':'LEAGUE READY':'BERTH AVAILABLE'}</b><span>${s?doctrines[s.style]:'STANDARD SHIP CLASS'}</span></div></header><div class="dock-scene" id="dock-scene"><div class="dock-scene-fallback"></div><div class="dock-scene-label"><span>01</span><b>${s?'STANDARD / DUEL SHIP':'UNASSIGNED'}</b></div><div class="dock-scene-corner top-left"></div><div class="dock-scene-corner bottom-right"></div>${!s?'<div class="dock-empty-label"><span>BERTH 01</span><b>No ship registered</b></div>':'<div class="dock-orbit-hint">DRAG TO INSPECT</div>'}<div class="dock-scene-scale">15 M <i></i></div></div><section class="dock-crew-deck"><div class="dock-deck-heading"><span>CREW STATIONS</span><b>${s?s.locked?'CREW LOCKED / CURRENT FIGHT':'SELECT A STATION TO SCOUT': 'ASSIGNED WITH YOUR FIRST SHIP'}</b><small>${s?'50 = league average':'FOUR SEATS / ONE CREW'}</small></div><div class="dock-stations">${s?s.crew.map(c=>`<div class="dock-station-slot ${c.station===pendingStation?'has-candidate':''}">${crewTile(c,true)}${c.station===pendingStation?candidatePanel():!pendingStation&&station===c.station?`<button class="dock-inline-scout" data-scout="${c.station}" ${s.locked||data.player.balance<e.tryout?'disabled':''}>Scout candidate <b>${credits(e.tryout)} cr</b></button>`:''}</div>`).join(''):blankStations}</div></section></section><aside class="dock-inspector" aria-label="Ship management">${inspector}${data.player.balance<100&&!data.wager?`<p class="owner-stipend">${now()>=data.player.nextStipendAt?'50-credit refill after your bets settle.':`Next 50-credit refill in ${Math.ceil((data.player.nextStipendAt-now())/60000)} min.`}</p>`:''}<div class="dock-inspector-foot"><span>HARD BURN / LEAGUE SERVICES</span><small>Progress saved to this browser</small></div></aside>${livePanel()}</main>`;
  }
  function betting() {
    const f=data.fight,w=data.wager;
    if(!draft||draft.fight!==f.id){draft={fight:f.id,side:w?.side??null,amount:String(Math.min(100,Math.floor(data.player.maxBet/100)))};saveDraft();}
    return renderBetting({fight:f,player:data.player,draft,wager:w,busy});
  }
  function viewer() {
    const f = data.fight, p = phase(f);
    return `<main class="hb-broadcast"><div id="hb-stage" class="phase-${p} ${p === 'combat' ? 'combat' : ''}">${p === 'betting' ? betting() : p === 'results' ? renderResults({fight:f,wager:data.wager}) : p === 'combat' ? `<iframe id="hb-feed" title="Live space duel broadcast" src="/broadcast.html" data-fight="${esc(f.id)}" allow="autoplay; fullscreen" allowfullscreen></iframe><div class="hb-live-caption"><span><i class="live-dot"></i> LIVE / MATCH ${String(f.sequence).padStart(4,'0')}</span><span>${data.wager ? `${credits(data.wager.stake)} cr on ${esc(f.ships[data.wager.side].name)}` : 'Betting closed · enjoy the duel'}</span><button data-do="fullscreen" title="Expand only the fight simulation">Fullscreen</button><button data-do="sound">${audioPlaying?'Sound on':audio.muted?'Sound off':'Enable sound'}</button></div><p id="broadcast-loading" ${mountedFight===f.id?'hidden':''}>Joining the live fight…</p>` : '<div class="hb-preparing"><span class="hb-eyebrow">LIVE BROADCAST</span><h1>Preparing next fight.</h1><p>The next 60-second betting period opens as soon as the matchup is ready.</p></div>'}</div>${chatPanel()}</main>`;
  }
  function chatPanel() { return `<aside id="hb-chat" ${chatShown?'':'hidden'} aria-label="Live viewer chat"><div class="hb-chat-head"><h2>Broadcast chat</h2><button data-do="chat" aria-label="Hide chat">×</button></div><details class="hb-chat-profile" ${profileOpen?'open':''}><summary>${esc(data.player.name)} · edit name</summary><form data-form="profile"><label for="viewer-name">Viewer name</label><input id="viewer-name" name="name" value="${esc(drafts.viewer || data.player.name)}" minlength="2" maxlength="24" required><button ${profileSaving?'disabled':''}>${profileSaving?'Saving…':'Save name'}</button><p id="hb-profile-status" role="status">${profileSaved?'Name saved.':''}</p></form></details><div id="hb-messages" role="log" aria-live="off"></div><form data-form="chat" class="hb-chat-form"><label class="sr-only" for="chat-message">Message</label><input id="chat-message" name="body" placeholder="Message…" value="${esc(drafts.message)}" maxlength="240" autocomplete="off" required><button aria-label="Send message">↑</button></form><p class="hb-chat-note">Be decent. Mute or report messages using ···.</p></aside>`; }
  function archivePage() { return renderArchive({rows:archive,state:archiveState,ownShipId:data.ship?.id??data.ship?._id}); }
  function render(force = false, resetArchiveScroll = false) {
    if (!data) return;
    music.setVisible(screen==='broadcast');
    if (draft && phase(data.fight) !== 'betting' && !data.wager && draft.side != null) { draft=null;saveDraft(); }
    const isBetting = phase(data.fight) === 'betting';
    if (isBetting) shell.querySelectorAll('[data-market-total]').forEach(el => {
      const html = shipBetTotal(data.fight.betting?.bySide[Number(el.dataset.marketTotal)], credits);
      if (el.innerHTML !== html) el.innerHTML = html;
    });
    // Incoming bets must not replace the stake form or reset its scroll position.
    const renderData = {...data, now:undefined, fight:data.fight ? {...data.fight, betting:isBetting?undefined:data.fight.betting} : null};
    const key = JSON.stringify([screen,phase(data.fight),renderData,station,renaming,chatShown,archive]);
    if (!force && key===lastKey) { countdown(); return; }
    if(!force&&screen==='settings'&&shell.querySelector('.hb-settings')){lastKey=key;shell.querySelector('.hb-wallet b').innerHTML=`${credits(data.player.balance)} <small>cr</small>`;countdown();return;} lastKey=key;
    document.body.dataset.phase=phase(data.fight);
    const continuing = screen === 'broadcast' && phase(data.fight) === 'combat' && document.body.dataset.screen === 'broadcast' && document.querySelector('#hb-stage.combat') && document.querySelector('#hb-feed')?.dataset.fight === data.fight.id;
    if (continuing) {
      document.body.classList.toggle('hb-chat-open', chatShown);
      document.querySelector('#hb-chat').hidden = !chatShown;
      const toggle = document.querySelector('.hb-chat-toggle'); toggle.textContent = `Chat ${chatShown ? 'on' : 'off'}`; toggle.setAttribute('aria-pressed',String(chatShown));
      document.querySelector('.hb-wallet b').innerHTML = `${credits(data.player.balance)} <small>cr</small>`;
      const n = document.querySelector('#hb-notice'); n.hidden=!notice; if(notice)n.firstChild.textContent=notice;
      renderChat(true); countdown(); return;
    }
    if (feedElement) { feedElement.contentWindow?.__hbDisposeAudio?.(); audioPlaying=false; feedElement=null; mountedFight=null; preparedMount=null; }
    const archiveScroll=new Map(!resetArchiveScroll&&screen==='archive'?[...shell.querySelectorAll('[data-archive-scroll]')].map(el=>[el.dataset.archiveScroll,el.scrollTop]):[]);
    const active = document.activeElement, focusId = active?.id, selection = active?.selectionStart;
    document.body.dataset.screen = screen; document.body.classList.toggle('hb-chat-open',screen==='broadcast'&&chatShown);
    shell.innerHTML = `<header class="hb-header"><a href="/" class="hb-brand" data-do="hangar">HARD<span>BURN</span><small>THE DUEL LEAGUE</small></a><nav aria-label="Main">${[['hangar','Hangar'],['broadcast','Live broadcast'],['archive','Results'],['settings','Settings']].map(([item,label])=>`<button data-do="${item}" aria-current="${screen===item?'page':'false'}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3">${{hangar:'<path d="M3 20V7l9-4 9 4v13M7 20V10h10v10M3 20h18"/>',broadcast:'<path d="M9 4l11 8-11 8V4M3 7v10"/>',archive:'<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6"/>'}[item]}</svg><span>${label}</span></button>`).join('')}</nav><div class="hb-location"><span>${screen==='hangar'?'LEAGUE FACILITY / PRIVATE DOCK':screen==='broadcast'?'LEAGUE / GLOBAL BROADCAST':screen==='settings'?'DEVICE / PREFERENCES':'LEAGUE / RESULT ARCHIVE'}</span><b>${screen==='hangar'?'HANGAR 01':screen==='broadcast'?'LIVE FEED':screen==='settings'?'SETTINGS':'FIGHT RECORDS'}</b></div><div class="hb-wallet"><span>YOUR CREDITS</span><b>${credits(data.player.balance)} <small>cr</small></b></div>${screen==='broadcast'?`<button data-do="chat" class="hb-chat-toggle" aria-pressed="${chatShown}">Chat ${chatShown?'on':'off'}</button>`:''}</header><div id="hb-notice" role="status" ${notice?'':'hidden'}>${esc(notice)}<button data-do="dismiss" aria-label="Dismiss message">×</button></div>${screen==='hangar'?hangar():screen==='broadcast'?viewer():screen==='settings'?renderSettings({mix,viewer:viewerSettings,chatShown}):archivePage()}${query.has('lab') ? '<div class="hb-lab"><b>DESIGN LAB / DEVELOPMENT ONLY</b><button data-do="preview-credits">Add preview credits</button></div>' : ''}<div id="hb-connection" hidden role="status">Reconnecting · betting is unavailable until the connection returns</div>`;
    shell.querySelectorAll('[data-archive-scroll]').forEach(el=>{if(archiveScroll.has(el.dataset.archiveScroll))el.scrollTop=archiveScroll.get(el.dataset.archiveScroll);});
    if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus({preventScroll:true}); try { el.setSelectionRange(selection,selection); } catch {} } }
    renderChat(true); countdown(); syncBroadcast(); syncHangar(); audioStatus();
  }
  async function syncHangar() {
    const element=document.querySelector('#dock-scene');if(!element)return;
    if(!dockScene&&!sceneLoading){sceneLoading=true;try{const {HangarScene}=await import('./hangar-scene.js');dockScene=new HangarScene();}catch{element.classList.add('scene-unavailable');}finally{sceneLoading=false;}}
    const latest=document.querySelector('#dock-scene');if(dockScene&&latest)dockScene.mount(latest,!!data.ship);
    shell.querySelectorAll('[data-station]').forEach(b=>b.classList.toggle('selected',b.dataset.station===station));
  }
  function saveDraft() { sessionStorage.setItem('hb-wager-draft',JSON.stringify(draft)); }
  function countdown() {
    syncProfile();
    const f = data?.fight; const p = phase(f);
    const end = p==='betting'?f.startsAt:p==='results'?f.nextAt:0;
    const seconds = Math.max(0,Math.ceil((end-now())/1000));
    shell.querySelectorAll('[data-countdown]').forEach(el=>el.textContent=end?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'');
    const button = shell.querySelector('[data-do="place-bet"]'); if (button) button.disabled = p!=='betting'||draft?.side==null||busy||!service?.connected()||!Number.isInteger(Number(draft?.amount))||Number(draft?.amount)<1||Number(draft?.amount)*100>data.player.maxBet;
    const disconnected = service && !service.connected(); const connection = document.querySelector('#hb-connection'); if (connection) connection.hidden=!disconnected;
    if (p==='preparing' && data?.status==='recovering') { const el=shell.querySelector('.hb-preparing p'); if(el)el.textContent='The live broadcast is reconnecting. Your balance and pending decisions are saved.'; }
  }
  function syncProfile() {
    const profile=shell.querySelector('.hb-chat-profile');if(!profile)return;
    const summary=profile.querySelector('summary'),label=`${data.player.name} · edit name`;
    if(summary.textContent!==label)summary.textContent=label;
    const button=profile.querySelector('button');button.disabled=profileSaving||busy;
    button.textContent=profileSaving?'Saving…':'Save name';
    profile.querySelector('#hb-profile-status').textContent=profileSaved?'Name saved.':'';
  }
  function renderChat(force = false) {
    if (!chatShown || screen!=='broadcast') return;
    const el = document.querySelector('#hb-messages'); if(!el)return;
    const key=JSON.stringify(chat); if(!force&&key===lastChatKey)return; lastChatKey=key;
    const bottom=el.scrollHeight-el.scrollTop-el.clientHeight<60; let fight;
    el.innerHTML=chat.map(m=>{ const divider = fight!==m.fight && m.fight?`<div class="hb-chat-divider">${m.fight===data.fight?.id?'CURRENT MATCHUP':'EARLIER MATCHES'}</div>`:'';fight=m.fight;return `${divider}<article class="hb-message"><header><b>${esc(m.name)}</b>${m.ship?`<small>${esc(m.ship)}</small>`:''}${m.player!==data.player.id?`<details><summary aria-label="Message actions">···</summary><button data-mute="${m.player}">Mute viewer</button><button data-report="${m.id}">Report</button></details>`:''}</header><p>${esc(m.body)}</p></article>`;}).join('')||'<p class="hb-chat-empty">No messages yet.</p>';
    if(bottom||force)el.scrollTop=el.scrollHeight;
  }
  function subscribeChat() {
    unsubscribeChat?.(); unsubscribeChat=null;
    if(chatShown&&screen==='broadcast') unsubscribeChat=service.subscribe('chat:list',{},m=>{chat=m;renderChat();},error);
  }
  function syncSettings() {
    shell.querySelectorAll('[data-setting]').forEach(button=>{
      const key=button.dataset.setting,on=key==='chat'?chatShown:key in mix?mix[key]:viewerSettings[key];
      button.setAttribute('aria-checked',String(on));button.querySelector('span').textContent=on?'On':'Off';
    });
    shell.querySelectorAll('[data-volume]').forEach(input=>{
      const key=input.dataset.volume,value=Math.round(mix[key+'Volume']*100);
      input.value=value;input.style.setProperty('--level',value+'%');
      shell.querySelector(`[data-volume-output="${key}"]`).innerHTML=`${value}<small>%</small>`;
    });
    audioStatus();
  }
  function applyPreferences() {
    music.setEnabled(mix.music);music.setVolume(mix.musicVolume);
    audio.resume();music.start();
    const frame=shell.querySelector('#hb-feed');
    frame?.contentWindow?.__hbApplySettings?.();
    frame?.contentWindow?.postMessage({kind:'settings-live'},location.origin);
    if(frame&&!audio.muted){frame.contentWindow?.__hbRetryAudio?.();frame.contentWindow?.postMessage({kind:'sound-live',muted:false},location.origin);}
  }
  function error(e) { notice=typeof e.data==='string'?e.data:(e.message||String(e)).replace(/^.*Uncaught ConvexError: /,'').split('\n')[0];render(true); }
  async function mutation(name,args={}) { if(busy)return;busy=true;countdown();try {await service.call(name,args);notice='';return true;}catch(e){error(e);return false;}finally{busy=false;render(true);} }
  function navigate(to) { if(to==='settings'){mix=readAudioMix();viewerSettings=readViewerSettings();}screen=to;notice='';lastKey='';render();subscribeChat();if(to==='broadcast')feedElement?.contentWindow?.postMessage({kind:'resume-live'},location.origin);else feedElement?.contentWindow?.postMessage({kind:'sound-live',muted:true},location.origin); }
  // Readiness comes from the viewer module, not the iframe's initial about:blank document.
  window.addEventListener('message',e=>{
    const frame=document.querySelector('#hb-feed');
    if(e.origin!==location.origin||!frame||e.source!==frame.contentWindow)return;
    if(e.data?.kind==='broadcast-audio'){audioPlaying=!!e.data.playing;audio.muted=!!e.data.muted;audioStatus();}
    if(e.data?.kind==='broadcast-ready'){readyFrames.add(frame);syncBroadcast();}
    if(e.data?.kind==='broadcast-mounted'&&e.data.fight===data?.fight?.id&&frame.dataset.fight===e.data.fight){
      mountedFight=e.data.fight;preparedMount=null;document.querySelector('#broadcast-loading')?.setAttribute('hidden','');
    }
    if(e.data?.kind==='broadcast-error'&&e.data.fight===data?.fight?.id){preparedMount=null;error(new Error('Could not start the live broadcast. Retrying…'));}
  });
  function sendPreparedMount() {
    const pending=preparedMount;
    if(!pending||!pending.frame.isConnected||screen!=='broadcast'||phase(data?.fight)!=='combat'||data.fight.id!==pending.fight)return;
    if(pending.sentAt&&Date.now()-pending.sentAt<1000)return;
    pending.sentAt=Date.now();
    pending.frame.contentWindow.postMessage({kind:'mount-live',fight:pending.fight,raw:pending.raw,startsAt:pending.startsAt,offset,pickSide:data.wager?.side??null},location.origin);
  }
  async function syncBroadcast() {
    const f=data?.fight;
    if(!f||phase(f)!=='combat'||screen!=='broadcast')return;
    const frame=document.querySelector('#hb-feed');if(!frame||frame.dataset.fight!==f.id)return;
    feedElement=frame;
    if(mountedFight===f.id)return;
    if(!readyFrames.has(frame)){frame.contentWindow?.postMessage({kind:'broadcast-ping'},location.origin);return;}
    if(preparedMount?.frame===frame&&preparedMount.fight===f.id){sendPreparedMount();return;}
    if(mounting?.frame===frame&&mounting.fight===f.id)return;
    const attempt={frame,fight:f.id};mounting=attempt;
    try {
      const url=traceUrl||await service.query('game:trace',{fight:f.id});if(!url)return;
      const raw=await fetch(url).then(r=>{if(!r.ok)throw new Error('Could not join the live fight.');return r.json();});
      if(!frame.isConnected||document.querySelector('#hb-feed')!==frame||data.fight?.id!==f.id||screen!=='broadcast'||phase(data.fight)!=='combat')return;
      preparedMount={frame,fight:f.id,raw,startsAt:f.startsAt,sentAt:0};sendPreparedMount();
    }catch(e){if(frame.isConnected)error(e);}finally{if(mounting===attempt)mounting=null;}
  }
  shell.addEventListener('toggle',e=>{if(e.target.isConnected&&e.target.matches('.hb-chat-profile'))profileOpen=e.target.open;},true);
  shell.addEventListener('input',e=>{
    if(e.target.dataset.volume){const key=e.target.dataset.volume;mix=saveAudioMix({[key+'Volume']:Number(e.target.value)/100});if(Number(e.target.value)>0)audio.muted=false;applyPreferences();syncSettings();return;}
    if(e.target.id==='archive-search'){archiveState.query=e.target.value;render(true,true);return;}
    if(e.target.id==='stake'){draft.amount=e.target.value;saveDraft();const p=draft.side==null?null:data.fight.odds[draft.side],stake=Math.round(Number(draft.amount)*100);document.querySelector('#profit').textContent=p==null?'Choose a ship':'+ '+credits(Math.round(stake*.95*(1-p)/p/100)*100)+' cr';document.querySelector('#after-stake').textContent=credits(data.player.balance-stake)+' cr remaining';}
    if(e.target.id==='chat-message')drafts.message=e.target.value;if(e.target.id==='ship-name')drafts.rename=e.target.value;if(e.target.id==='viewer-name'){drafts.viewer=e.target.value;profileSaved=false;syncProfile();}
  });
  shell.addEventListener('change',e=>{if(e.target.id==='archive-filter'||e.target.id==='archive-sort'){archiveState[e.target.id==='archive-filter'?'filter':'sort']=e.target.value;archiveState.detailOpen=false;render(true,true);}});
  shell.addEventListener('keydown',e=>{const panel=e.target.closest('[data-side]');if(panel&&['Enter',' '].includes(e.key)){e.preventDefault();panel.click();}});
  shell.addEventListener('click',async e=>{
    const b=e.target.closest('button,[data-do],[data-side]');if(!b)return;e.stopPropagation();
    if(b.dataset.setting){const key=b.dataset.setting;if(key==='music'||key==='sfx'){mix=saveAudioMix({[key]:!mix[key]});if(mix[key])audio.muted=false;}else if(key==='chat'){chatShown=!chatShown;localStorage.setItem('hb-chat-visible',String(chatShown));subscribeChat();}else viewerSettings=saveViewerSettings({[key]:!viewerSettings[key]});applyPreferences();syncSettings();return;}
    if(b.hasAttribute('data-archive-export')){const content=archiveCsv(filterFights(archive,archiveState,data.ship?.id??data.ship?._id)),url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='hardburn-results.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
    if(b.dataset.archiveView){archiveState.view=b.dataset.archiveView;archiveState.detailOpen=false;render(true);return;}
    if(b.dataset.archiveFight||b.dataset.archiveOpenFight){archiveState.view='fights';archiveState.fightId=b.dataset.archiveFight??b.dataset.archiveOpenFight;archiveState.detailOpen=true;archiveState.detailTab='combat';render(true);shell.querySelector('.ar-inspector')?.focus({preventScroll:true});return;}
    if(b.dataset.archiveShip||b.dataset.archiveFocusShip){archiveState.view='ships';archiveState.shipId=b.dataset.archiveShip??b.dataset.archiveFocusShip;archiveState.detailOpen=true;render(true);shell.querySelector('.ar-inspector')?.focus({preventScroll:true});return;}
    if(b.hasAttribute('data-archive-back')){archiveState.detailOpen=false;render(true);shell.querySelector('.ar-ledger [aria-pressed=true]')?.focus({preventScroll:true});return;}
    if(b.dataset.archiveDetail){archiveState.detailTab=b.dataset.archiveDetail;render(true);return;}
    if(b.dataset.side!==undefined){if(data.wager||phase(data.fight)!=='betting')return;draft.side=Number(b.dataset.side);saveDraft();render(true);shell.querySelector(`[data-side="${draft.side}"]`)?.focus({preventScroll:true});return;}
    if(b.dataset.station){station=station===b.dataset.station?null:b.dataset.station;render(true);return;}
    if(b.dataset.scout){station=b.dataset.scout;await mutation('game:tryout',{station});return;}
    if(b.dataset.mute){await mutation('chat:mute',{muted:b.dataset.mute});return;}
    if(b.dataset.report){if(await mutation('chat:report',{message:b.dataset.report})){notice='Message reported.';render(true);}return;}
    const a=b.dataset.do;
    if(['hangar','broadcast','archive','settings'].includes(a)){e.preventDefault();navigate(a);}
    else if(a==='chat'){chatShown=!chatShown;localStorage.setItem('hb-chat-visible',String(chatShown));render(true);subscribeChat();}
    else if(a==='reset-settings'){mix=saveAudioMix(AUDIO_DEFAULTS);viewerSettings=saveViewerSettings(VIEW_DEFAULTS);chatShown=matchMedia('(min-width:761px)').matches;localStorage.removeItem('hb-chat-visible');audio.muted=false;applyPreferences();render(true);}
    else if(a==='preview-credits')await mutation('lab:previewCredits');
    else if(a==='sponsor')await mutation('game:sponsor');
    else if(a==='tryout')await mutation('game:tryout',{station});
    else if(a==='accept'||a==='reject')await mutation('game:decide',{accept:a==='accept'});
    else if(a==='station-close'){station=null;render(true);}
    else if(a==='rename-open'){renaming=!renaming;drafts.rename||=data.ship.name;render(true);}
    else if(a==='dismiss'){notice='';render(true);}
    else if(a==='recovery')await mutation('game:recovery');
    else if(a==='fullscreen'){const frame=document.querySelector('#hb-feed');if(frame)try{await toggleFightFullscreen(frame);}catch(e){error(e);}}
    else if(a==='sound'){audio.muted=screen==='settings'?!audio.muted:(audioPlaying||music.playing)&&!audio.muted; if(!audio.muted){audio.resume();music.start();} music.updateGate();feedElement?.contentWindow?.postMessage({kind:'sound-live',muted:audio.muted},location.origin);audioStatus();}
  });
  shell.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.target,fields=new FormData(form);
    if(form.dataset.form==='wager'){await mutation('game:wager',{fight:draft.fight,side:draft.side,stake:Math.round(Number(fields.get('stake'))*100)});}
    if(form.dataset.form==='rename'){await mutation('game:rename',{name:String(fields.get('name'))});if(!notice)renaming=false;render(true);}
    if(form.dataset.form==='profile') {
      profileSaving=true;profileSaved=false;profileOpen=true;syncProfile();
      try { if(await mutation('game:profile',{name:String(fields.get('name'))})){drafts.viewer='';profileSaved=true;} }
      finally { profileSaving=false;render(true); }
    }
    if(form.dataset.form==='chat') {
      const body=String(fields.get('body'));
      if(await mutation('chat:send',{body}) && drafts.message===body) {
        drafts.message='';
        // mutation() may replace the form while awaiting the server. Clear the
        // current composer, preserving any new draft typed during the send.
        const input=shell.querySelector('#chat-message');
        if(input){input.value='';input.defaultValue='';}
      }
    }
  });
  shell.innerHTML='<main class="hb-connecting"><span class="hb-eyebrow">HARD BURN / LEAGUE DOCK</span><h1>Connecting…</h1><p>Connecting to the live league…</p></main>';
  try {
    service=await connect();
    service.subscribe('game:home',{},d=>{
      const old=data?.fight?.id, newCandidate=!data?.player.candidate&&d.player.candidate; data=d;
      if(old!==d.fight?.id){ traceSubscription?.();traceUrl=null; if(draft&&draft.fight!==d.fight?.id){draft=null;saveDraft();}if(d.fight)traceSubscription=service.publicSubscribe('game:trace',{fight:d.fight.id},url=>{traceUrl=url;syncBroadcast();},error); }
      render();
      if(newCandidate&&screen==='hangar') requestAnimationFrame(()=>document.querySelector('.dock-inline-candidate')?.scrollIntoView({block:'nearest',behavior:'smooth'}));
    },error);
    service.publicSubscribe('game:archive',{},rows=>{archive=rows;if(screen==='archive')render();},error);
    const calibrate=async()=>{const sent=Date.now();try{const server=await service.action('game:clock');offset=server-(sent+Date.now())/2;}catch{}};
    await calibrate();setInterval(calibrate,20000);
    setInterval(()=>{render();if(screen==='broadcast')syncBroadcast();},250);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){calibrate();feedElement?.contentWindow?.postMessage({kind:'resume-live'},location.origin);}});
  } catch(e) {
    shell.innerHTML=`<main class="hb-connecting"><span class="hb-eyebrow">HARD BURN / LEAGUE DOCK</span><h1>The hangar is offline.</h1><p>${esc(e.message)}</p><button onclick="location.reload()">Reconnect</button></main>`;
  }
}
