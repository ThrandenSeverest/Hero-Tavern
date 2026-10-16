// Hero Tavern application shell over SillyTavern's chat, character and world tools.
const bridgeOrigin = 'http://127.0.0.1:8001';
let lastEngine = '', connecting = false, context = null, engine = null;
const initHeroTavern = async () => {
    if (document.getElementById('hero-shell')) return;
    await import('./reply-filters.js');
    try { context = (await import('../../extensions.js')).getContext; } catch {}
    document.title = 'Hero Tavern';
    const toolsButton=document.createElement('button'),toolsFrame=document.createElement('iframe');
    toolsButton.textContent='AI tools · text / image / voice';toolsButton.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2200;padding:10px;background:#574326;color:white;border:1px solid #b9a277;border-radius:8px';
    toolsFrame.title='Shared AI tools';toolsFrame.src=bridgeOrigin+'/tools';toolsFrame.hidden=true;toolsFrame.style.cssText='position:fixed;right:12px;bottom:64px;width:min(960px,calc(100vw - 24px));height:80vh;border:1px solid #8293ad;border-radius:12px;z-index:2201;background:#192231';
    let toolsTarget=null;
    toolsButton.onpointerdown=()=>{const field=document.activeElement;if(field instanceof HTMLTextAreaElement)toolsTarget=field;};
    toolsButton.onclick=()=>{toolsFrame.hidden=!toolsFrame.hidden;if(!toolsFrame.hidden){const selected=window.getSelection()?.toString()|| (toolsTarget?toolsTarget.value.slice(toolsTarget.selectionStart,toolsTarget.selectionEnd):'');toolsFrame.contentWindow.postMessage({type:'hero-tools-context',text:selected},bridgeOrigin);}};
    window.addEventListener('message',e=>{if(e.origin!==bridgeOrigin||e.source!==toolsFrame.contentWindow||e.data?.type!=='hero-tools-insert')return;const field=toolsTarget||document.getElementById('send_textarea');if(field){field.setRangeText(String(e.data.text||''),field.selectionStart,field.selectionEnd,'end');field.dispatchEvent(new Event('input',{bubbles:true}));toolsFrame.hidden=true;}});
    document.body.append(toolsButton,toolsFrame);
    document.documentElement.classList.add('hero-tavern-app');
    const style = document.createElement('style');
    style.textContent = `
    .hero-tavern-app{--hero-rail:200px;--hero-top:66px;--hero-right:0px;--hero-drawer-width:480px;--hero-gold:#e0b96f;--hero-bg:#121620;--hero-surface:#1c2230;--hero-border:#323b4c;--sheldWidth:100%;--blurStrength:0;--SmartThemeBodyColor:#121620;--SmartThemeBlurTintColor:#1c2230;--SmartThemeChatTintColor:#151b26;--SmartThemeQuoteColor:#e0b96f;--SmartThemeBorderColor:#323b4c}
    .hero-tavern-app body{background:#121620!important;font-family:Inter,'Segoe UI',sans-serif}
    #hero-shell{position:fixed;inset:0 auto 0 0;width:var(--hero-rail);background:#181e2a;border-right:1px solid #323b4c;z-index:2000;display:flex;flex-direction:column;padding:24px 14px;overflow-y:auto;box-sizing:border-box;color:#e7eaf0;font:14px 'Segoe UI',sans-serif}
    .hero-brand{font-size:23px;font-weight:700;letter-spacing:-.7px;color:#f0d29b;margin:0 8px 6px}.hero-tagline{font-size:11px;color:#949caf;margin:0 8px 30px;text-transform:uppercase;letter-spacing:1.4px}.hero-nav{border:0;border-radius:9px;padding:13px 15px;text-align:left;background:transparent;color:#bac3d4;font:600 14px 'Segoe UI',sans-serif;cursor:pointer;margin:3px 0}.hero-nav:hover,.hero-nav.active{background:#30394b;color:#f3d49e}.hero-rail-foot{margin-top:auto;padding:15px 8px;color:#929db0;font-size:12px;line-height:1.8}
    #hero-header{position:fixed!important;top:0!important;left:var(--hero-rail)!important;right:0!important;height:var(--hero-top)!important;box-sizing:border-box;background:#171d29;border-bottom:1px solid #323b4c;z-index:2147483000!important;display:flex;align-items:center;justify-content:space-between;padding:0 28px;color:#e9edf5;font:14px 'Segoe UI',sans-serif;gap:12px}.hero-chip{border:1px solid #44516a;border-radius:22px;padding:9px 16px;background:#232d3d;cursor:pointer;color:#d4def0;max-width:65%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hero-chip.ready{color:#9adeb6;border-color:#42775e}.hero-chip.error{color:#ffb4ad;border-color:#9a534e}
    .hero-tavern-app #hero-header button{position:relative;z-index:1;pointer-events:auto!important;min-width:0;flex-shrink:0}.hero-tavern-app #hero-page-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hero-tavern-app #top-settings-holder{top:var(--hero-top)!important;left:var(--hero-rail)!important;right:0!important;width:calc(100% - var(--hero-rail))!important;transform:none!important;background:#1b2230!important;justify-content:center;z-index:1998}
    .hero-tavern-app #sheld{left:var(--hero-rail)!important;right:var(--hero-right)!important;top:calc(var(--hero-top) + 48px)!important;width:calc(100% - var(--hero-rail) - var(--hero-right))!important;max-width:none!important;height:calc(100dvh - var(--hero-top) - 48px)!important;margin:0!important;transform:none!important;border:0!important;background:transparent!important}
    .hero-tavern-app #chat{padding:22px 5%;background:transparent!important}.hero-tavern-app #chat_background{display:block!important}.hero-tavern-app #sheld{background:transparent!important}.hero-tavern-app #chat .mes{background:rgba(27,35,49,.89)!important}.hero-tavern-app .mes{border:1px solid #303b4e;border-radius:12px;margin-bottom:16px;background:#1b2331!important;padding:18px}.hero-tavern-app #send_form{background:#202939!important;border:1px solid #3a4960;border-radius:14px;margin:8px 3%;width:94%}
    .hero-tavern-app .drawer-content{top:calc(var(--hero-top) + 48px)!important;max-height:calc(100dvh - var(--hero-top) - 48px)!important;background:#1d2533!important;backdrop-filter:none!important;border:1px solid #3b4860!important;border-radius:12px!important}
    .hero-tavern-app #right-nav-panel{position:fixed!important;top:calc(var(--hero-top) + 48px)!important;right:0!important;left:auto!important;width:var(--hero-drawer-width)!important;max-width:calc(100vw - var(--hero-rail))!important;height:calc(100dvh - var(--hero-top) - 48px)!important;overflow-y:auto!important;border-radius:12px 0 0 0!important;padding:14px!important;box-sizing:border-box!important;transform:none!important}
    .hero-tavern-app #left-nav-panel,.hero-tavern-app #rm_api_block,.hero-tavern-app #WorldInfo,.hero-tavern-app #user-settings-block{left:calc(var(--hero-rail) + 12px)!important;right:auto!important;max-width:calc(100vw - var(--hero-rail) - 24px)!important;overflow-y:auto!important}
    .hero-tavern-app #chat .mes_text{overflow-wrap:anywhere;min-width:0}.hero-tavern-app #chat .mes_reasoning,.hero-tavern-app #chat .reasoning_block{display:none!important}
    #hero-workspace{position:fixed;left:var(--hero-rail);right:0;top:var(--hero-top);bottom:0;background:#151b26;z-index:1999;display:none}#hero-workspace.open{display:block}#hero-model-frame{width:100%;height:100%;border:0}
    #hero-welcome{position:fixed;left:calc(var(--hero-rail) + 5%);right:calc(var(--hero-right) + 5%);top:calc(var(--hero-top) + 68px);bottom:80px;z-index:1997;background:#151b26;color:#e4eaf4;padding:36px;box-sizing:border-box;overflow:auto}.hero-eyebrow{color:#d9b771;text-transform:uppercase;letter-spacing:2px;font-size:12px}.hero-welcome-title{font-size:clamp(28px,4vw,48px);line-height:1.15;letter-spacing:-1.5px;max-width:720px;margin:18px 0}.hero-lead{color:#aab8ca;font-size:17px;max-width:650px;line-height:1.6}.hero-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;max-width:1080px;margin-top:32px}.hero-card{background:#202a3a;border:1px solid #3a485f;border-radius:16px;padding:24px}.hero-card h3{margin:0 0 12px;font-size:18px}.hero-card p{color:#a7b6c9;line-height:1.6;font-size:14px;min-height:60px}.hero-action{border:1px solid #c29c55;background:#d7b16b;color:#171b25;border-radius:8px;padding:11px 17px;cursor:pointer;font:600 14px 'Segoe UI',sans-serif}

    /* User-managed UI variables deliberately override the fixed shell defaults. */
    .hero-tavern-app{--hero-content-font:16px;--hero-shell-font:14px;--hero-pane-opacity:1;--hero-chat-opacity:.94;--hero-pane-blur:0px;--hero-custom-rail:200px;--hero-accent:#e0b96f;--hero-background-display:block}
    .hero-tavern-app #hero-shell{width:var(--hero-custom-rail)!important;font-size:var(--hero-shell-font)!important}
    .hero-tavern-app .hero-nav{font-size:var(--hero-shell-font)!important}
    .hero-tavern-app #hero-header{font-size:var(--hero-shell-font)!important}
    .hero-tavern-app #chat .mes_text,.hero-tavern-app #chat .mes_reasoning,.hero-tavern-app #send_textarea,.hero-tavern-app #chat .mes .mes_text{font-size:var(--hero-content-font)!important;line-height:1.55!important}
    .hero-tavern-app #chat .name_text{font-size:calc(var(--hero-content-font) * .95)!important}
    .hero-tavern-app #chat .mes{background:rgba(27,35,49,var(--hero-pane-opacity))!important;backdrop-filter:blur(var(--hero-pane-blur))!important}
    .hero-tavern-app #chat{background:rgba(21,27,38,var(--hero-chat-opacity))!important}
    .hero-tavern-app #send_form,.hero-tavern-app #hero-session-toolbar,.hero-tavern-app #hero-live-trackers{background:rgba(32,41,57,var(--hero-pane-opacity))!important;backdrop-filter:blur(var(--hero-pane-blur))!important}
    .hero-tavern-app .drawer-content,.hero-tavern-app #right-nav-panel,.hero-tavern-app #left-nav-panel{background:rgba(29,37,51,var(--hero-pane-opacity))!important;backdrop-filter:blur(var(--hero-pane-blur))!important}
    .hero-tavern-app #chat_background{display:var(--hero-background-display)!important}
    .hero-tavern-app .hero-nav.active{color:var(--hero-accent)!important}
    #hero-recent,#hero-appearance{position:fixed;top:var(--hero-top);left:var(--hero-rail);right:0;bottom:0;z-index:1999;overflow:auto;background:#151b26;color:#e6edf7;padding:26px clamp(16px,4vw,65px);box-sizing:border-box;font-family:'Segoe UI',system-ui}
    #hero-recent[hidden],#hero-appearance[hidden]{display:none!important}
    #hero-recent h2,#hero-appearance h2{font-size:26px;margin:0 0 9px}
    #hero-recent .hero-page-lead,#hero-appearance .hero-page-lead{color:#aab8ca;max-width:800px;line-height:1.6}
    .hero-config-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;max-width:1050px;margin-top:24px}
    .hero-config-card,.hero-recent-card{border:1px solid #45546b;border-radius:12px;padding:18px;background:rgba(35,47,64,var(--hero-pane-opacity));color:#e6edf7}
    .hero-config-card label{display:block;font-weight:600;margin-bottom:12px}
    .hero-config-card input[type=range]{width:100%;accent-color:var(--hero-accent)}
    .hero-config-card select,.hero-config-card input[type=color],#hero-recent-search{background:#273449;color:#fff;border:1px solid #60708b;border-radius:7px;padding:9px;font:inherit}
    .hero-config-card output{float:right;color:#e4c488}
    .hero-config-card p{font-size:13px;color:#b5c5d9;line-height:1.45}
    .hero-config-actions,.hero-recent-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:18px 0}
    .hero-config-actions button,.hero-recent-actions button,.hero-recent-card button{padding:9px 13px;border:1px solid #7990af;border-radius:8px;background:#2a3c55;color:#f1f5fc;cursor:pointer;font:inherit}
    #hero-recent-search{width:min(580px,100%);box-sizing:border-box}
    #hero-recent-list{display:grid;gap:10px;max-width:1200px}
    .hero-recent-card{display:flex;align-items:center;gap:15px}
    .hero-recent-card .hero-recent-copy{flex:1;min-width:0}
    .hero-recent-card strong,.hero-recent-card small{display:block}
    .hero-recent-card p{margin:7px 0 0;color:#b8c6d9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .hero-recent-card small{color:#9fb0c8;margin-top:4px}
    @media(max-width:900px){#hero-recent,#hero-appearance{padding:15px;left:var(--hero-rail)}}
    @media(max-height:650px){#hero-shell{padding-top:10px;padding-bottom:10px}.hero-nav{padding-top:7px;padding-bottom:7px;margin:0}}\n    @media(max-width:900px){.hero-tavern-app{--hero-rail:76px}.hero-brand{font-size:13px;margin-left:0}.hero-tagline,.hero-rail-foot{display:none}.hero-nav{font-size:11px;padding:12px 3px;text-align:center}#hero-shell{padding:16px 5px}.hero-cards{grid-template-columns:1fr}#hero-header{padding:0 14px}#hero-welcome{padding:18px}}
    `;
    document.head.append(style);
    const rail = document.createElement('nav');rail.id='hero-shell';rail.setAttribute('aria-label','Hero Tavern navigation');
    rail.innerHTML='<div class="hero-brand">Hero Tavern</div><div class="hero-tagline">Your stories. Your AI.</div><div class="hero-rail-foot">Powered by SillyTavern<br>Local AI · KoboldCpp<br>Hero Tavern 0.8</div>';
    const header=document.createElement('header');header.id='hero-header';
    header.innerHTML='<strong id="hero-page-title">Your tavern</strong><button id="hero-engine-chip" class="hero-chip">Checking local AI…</button>';
    const workspace=document.createElement('main');workspace.id='hero-workspace';
    const closePanel=document.createElement('button');closePanel.id='hero-panel-close';closePanel.textContent='Back to chat ×';closePanel.style.cssText='position:static;flex-shrink:0;padding:8px;border:1px solid #64748b;background:#27354a;color:white;border-radius:8px;cursor:pointer';closePanel.onclick=()=>show('chat');header.append(closePanel);
    const frame=document.createElement('iframe');frame.id='hero-model-frame';frame.title='Hero Tavern models and hardware';frame.src=bridgeOrigin+'/';workspace.append(frame);
    const welcome=document.createElement('section');welcome.id='hero-welcome';
    welcome.innerHTML='<button id="hero-welcome-close" aria-label="Close welcome" style="float:right;padding:10px;border:1px solid #64748b;border-radius:8px;background:#27354a;color:white;cursor:pointer">Close ×</button><div class="hero-eyebrow">Welcome to your tavern</div><h1 class="hero-welcome-title">Every character has a story.<br>Start yours here.</h1><p class="hero-lead">Create a character, bring your world to life, and chat with an AI running on your own computer.</p><div class="hero-cards"><article class="hero-card"><h3>1 · Choose your AI</h3><p>Try Rocinante or Qwen, or load an installed model. Hero Tavern runs and connects the engine for you.</p><button class="hero-action" data-hero="models">Open models</button></article><article class="hero-card"><h3>2 · Meet a character</h3><p>Create someone new or import a SillyTavern character card to begin your conversation.</p><button class="hero-action" data-hero="characters">Characters</button></article><article class="hero-card"><h3>3 · Build your world</h3><p>Add places, lore and memories with SillyTavern’s World Info tools.</p><button class="hero-action" data-hero="world">World info</button></article></div>';
    const adventure=document.createElement('iframe');adventure.id='hero-adventure-frame';adventure.title='Ilreon Adventure mode';adventure.src=bridgeOrigin+'/adventure';adventure.hidden=true;adventure.style.cssText='width:100%;height:100%;border:0';workspace.append(adventure);
    const writer=document.createElement('iframe');writer.id='hero-writer-frame';writer.title='Writer · manuscript editor';writer.src=bridgeOrigin+'/writer';writer.hidden=true;writer.style.cssText='width:100%;height:100%;border:0';workspace.append(writer);

    const recent=document.createElement('section');recent.id='hero-recent';recent.hidden=true;
    recent.innerHTML='<h2>Recent Chats</h2><p class="hero-page-lead">Native SillyTavern chats, shown without leaving Hero Tavern. Search, open, or continue an existing conversation. Your saved chats are never duplicated by this screen.</p><div class="hero-recent-actions"><input id="hero-recent-search" type="search" placeholder="Search characters, titles, messages" aria-label="Search recent chats"><button id="hero-recent-refresh">Refresh chats</button><label><input id="hero-recent-archived" type="checkbox"> Show archived</label></div><p id="hero-recent-status" role="status"></p><div id="hero-recent-list"></div>';
    const appearance=document.createElement('section');appearance.id='hero-appearance';appearance.hidden=true;
    appearance.innerHTML='<h2>Appearance & Layout</h2><p class="hero-page-lead">These controls affect the Tavern UI immediately and are saved locally. They do not modify your chats, characters or SillyTavern themes.</p><div class="hero-config-grid">'+
      '<div class="hero-config-card"><label for="hero-font-size">Chat and story text <output id="hero-font-label"></output></label><input id="hero-font-size" type="range" min="12" max="28" step="1"><p>Changes chat messages, input field and supported editors.</p></div>'+
      '<div class="hero-config-card"><label for="hero-ui-size">Navigation text <output id="hero-ui-label"></output></label><input id="hero-ui-size" type="range" min="11" max="22" step="1"><p>Choose a comfortable size for the app’s buttons and navigation.</p></div>'+
      '<div class="hero-config-card"><label for="hero-panel-opacity">Panel opacity <output id="hero-opacity-label"></output></label><input id="hero-panel-opacity" type="range" min="35" max="100" step="5"><p>100% makes chat bubbles and menus fully opaque, hiding the image behind them.</p></div>'+
      '<div class="hero-config-card"><label for="hero-chat-opacity">Chat backdrop opacity <output id="hero-chat-opacity-label"></output></label><input id="hero-chat-opacity" type="range" min="0" max="100" step="5"><p>Controls the large chat area behind messages.</p></div>'+
      '<div class="hero-config-card"><label for="hero-blur">Background blur <output id="hero-blur-label"></output></label><input id="hero-blur" type="range" min="0" max="20" step="1"><p>Optional frosted-glass blur. Use 0 for crisp solid panels.</p></div>'+
      '<div class="hero-config-card"><label for="hero-rail-width">Sidebar width <output id="hero-rail-label"></output></label><input id="hero-rail-width" type="range" min="160" max="300" step="10"><p>Expand the navigation so labels are easier to read.</p></div>'+
      '<div class="hero-config-card"><label for="hero-accent">Accent color</label><input id="hero-accent" type="color"><p>Used on the selected navigation item and highlights.</p></div>'+
      '<div class="hero-config-card"><label><input id="hero-show-background" type="checkbox"> Show chat background image</label><p>Turn this off to use plain, high-contrast panels with no image showing behind them.</p></div>'+
      '</div><div class="hero-config-actions"><button id="hero-appearance-reset">Restore default appearance</button><button id="hero-appearance-close">Back to Tavern</button></div><p id="hero-appearance-status" role="status">Appearance settings are saved automatically.</p>';
    document.body.append(recent,appearance);
    const $hero=id=>document.getElementById(id);
    const UI_KEY='hero.tavern.appearance.v2';
    const uiDefaults=()=>({font:16,ui:14,panels:100,chat:95,blur:0,rail:200,accent:'#e0b96f',background:true});
    const clampUI=(n,min,max,fall)=>Number.isFinite(Number(n))?Math.min(max,Math.max(min,Number(n))):fall;
    const validateUI=x=>({font:clampUI(x?.font,12,28,16),ui:clampUI(x?.ui,11,22,14),
      panels:clampUI(x?.panels,35,100,100),chat:clampUI(x?.chat,0,100,95),
      blur:clampUI(x?.blur,0,20,0),rail:clampUI(x?.rail,160,300,200),
      accent:/^#[0-9a-f]{6}$/i.test(x?.accent||'')?x.accent:'#e0b96f',
      background:x?.background!==false});
    let uiPrefs;
    try{uiPrefs=validateUI(JSON.parse(localStorage.getItem(UI_KEY)||'null'))}catch{uiPrefs=uiDefaults();}
    const sendUI=()=>{
      for(const fr of [frame,adventure,writer])
        if(fr?.contentWindow)fr.contentWindow.postMessage({type:'hero-ui-settings',settings:uiPrefs},bridgeOrigin);
    };
    function applyUI(){
      const root=document.documentElement,values={
        '--hero-content-font':uiPrefs.font+'px','--hero-shell-font':uiPrefs.ui+'px',
        '--hero-pane-opacity':String(uiPrefs.panels/100),'--hero-chat-opacity':String(uiPrefs.chat/100),
        '--hero-pane-blur':uiPrefs.blur+'px','--hero-custom-rail':(innerWidth<=900?76:uiPrefs.rail)+'px',
        '--hero-rail':(innerWidth<=900?'76px':uiPrefs.rail+'px'),
        '--hero-accent':uiPrefs.accent,'--hero-background-display':uiPrefs.background?'block':'none'
      };
      for(const [name,value] of Object.entries(values))root.style.setProperty(name,value);
      for(const [key,id] of [['font','hero-font-size'],['ui','hero-ui-size'],['panels','hero-panel-opacity'],['chat','hero-chat-opacity'],['blur','hero-blur'],['rail','hero-rail-width'],['accent','hero-accent'],['background','hero-show-background']]){
        const node=$hero(id);if(node){if(key==='background')node.checked=uiPrefs[key];else node.value=uiPrefs[key];}
      }
      for(const [id,value] of [['hero-font-label',uiPrefs.font+'px'],['hero-ui-label',uiPrefs.ui+'px'],['hero-opacity-label',uiPrefs.panels+'%'],['hero-chat-opacity-label',uiPrefs.chat+'%'],['hero-blur-label',uiPrefs.blur+'px'],['hero-rail-label',uiPrefs.rail+'px']])$hero(id).textContent=value;
      try{localStorage.setItem(UI_KEY,JSON.stringify(uiPrefs))}catch{}
      sendUI();
    }
    for(const [key,id] of [['font','hero-font-size'],['ui','hero-ui-size'],['panels','hero-panel-opacity'],['chat','hero-chat-opacity'],['blur','hero-blur'],['rail','hero-rail-width'],['accent','hero-accent'],['background','hero-show-background']]){
      const field=$hero(id);field.addEventListener('input',()=>{uiPrefs=validateUI({...uiPrefs,[key]:key==='background'?field.checked:key==='accent'?field.value:Number(field.value)});applyUI();});
    }
    $hero('hero-appearance-reset').onclick=()=>{uiPrefs=uiDefaults();applyUI();};
    $hero('hero-appearance-close').onclick=()=>show('chat');
    for(const fr of [frame,adventure,writer])fr.addEventListener('load',sendUI);
    const recentState={items:[],loading:false};
    function drawRecent(){
      const list=$hero('hero-recent-list');list.replaceChildren();
      const query=$hero('hero-recent-search').value.toLowerCase().trim();
      const results=recentState.items.filter(x=>!query||(x.title+' '+x.last+' '+(x.location?.avatar||'')).toLowerCase().includes(query));
      if(!results.length){const empty=document.createElement('p');empty.textContent=query?'No matching chats. Try another search.':'No saved chats found. Start a chat with a character first.';list.append(empty);return;}
      for(const chat of results){
        const row=document.createElement('article');row.className='hero-recent-card';
        const content=document.createElement('div');content.className='hero-recent-copy';
        const title=document.createElement('strong');title.textContent=chat.title||chat.location?.avatar||'Unnamed chat';
        const meta=document.createElement('small');meta.textContent=(chat.location?.avatar?.replace(/\.png$/,'')||chat.location?.group||'Group')+' · '+(chat.count||0)+' messages'+(chat.archived?' · Archived':'');
        const preview=document.createElement('p');preview.textContent=String(chat.last||'No messages yet').replace(/<[^>]*>/g,'').slice(0,360);
        content.append(title,meta,preview);
        const button=document.createElement('button');button.textContent='Open chat';
        button.onclick=async()=>{button.disabled=true;button.textContent='Opening…';try{await window.HeroStory.run('open',{id:chat.id});}catch(error){button.disabled=false;button.textContent='Retry';$hero('hero-recent-status').textContent='Unable to open chat: '+error.message;}};
        row.append(content,button);list.append(row);
      }
    }
    async function refreshRecent(){
      if(recentState.loading)return;
      if(!window.HeroStory?.run){$hero('hero-recent-status').textContent='Waiting for native chat history to initialize…';setTimeout(()=>{if(!recent.hidden)refreshRecent()},700);return;}
      recentState.loading=true;$hero('hero-recent-status').textContent='Loading saved chats…';
      try{const items=await window.HeroStory?.run('list',{archived:$hero('hero-recent-archived').checked});
        if(!Array.isArray(items))throw Error('Chat history is not ready; retry in a moment.');
        recentState.items=items;$hero('hero-recent-status').textContent=items.length+' saved chats · most recent first';drawRecent();
      }catch(error){$hero('hero-recent-status').textContent='Cannot load recent chats: '+error.message;}
      finally{recentState.loading=false;}
    }
    $hero('hero-recent-search').addEventListener('input',drawRecent);
    $hero('hero-recent-refresh').onclick=refreshRecent;
    $hero('hero-recent-archived').onchange=refreshRecent;
    applyUI();
    let welcomeDismissed=false;const dismissWelcome=()=>{welcomeDismissed=true;welcome.hidden=true;};
    const show = name => {
        dismissWelcome();
        recent.hidden=name!=='recent-chats';appearance.hidden=name!=='appearance';
        if(name==='recent-chats')refreshRecent();
        if(name==='chat'){const panel=document.getElementById('right-nav-panel');if(panel&&!panel.classList.contains('closedDrawer')&&getComputedStyle(panel).display!=='none')document.querySelector('#rightNavDrawerIcon')?.click();}
        const isPanel=['recent-chats','appearance','model-center','model-tests','voices','assistant','models','vision','hardware','generation','memory','images','comfy-workflows','image-setup','storage','creator','adventure','writer','diagnostics','history','trackers','lore','inspector'].includes(name);
        workspace.classList.toggle('open',isPanel&&!['recent-chats','appearance'].includes(name));toolsButton.hidden=isPanel;if(isPanel)toolsFrame.hidden=true;
        document.getElementById('hero-page-title').textContent={'recent-chats':'Recent Chats',appearance:'Appearance & Layout','model-center':'All AI models','model-tests':'Model Testing',voices:'Character voices',vision:'Image analyzer',assistant:'Ассистент · Qwen',diagnostics:'Diagnostics',history:'Saved stories',trackers:'Story trackers',lore:'Lorebook editor',inspector:'Prompt Inspector',writer:'Writer · novels & stories',adventure:'Ilreon · Adventure mode','comfy-workflows':'ComfyUI Workflows',images:'Image Studio', 'image-setup':'Image models & setup',storage:'Storage & cleanup',memory:'Chat memory',creator:'Character studio',generation:'Generation',hardware:'Hardware'}[name]||(isPanel?'Models & local AI':'Your tavern');frame.hidden=['adventure','writer'].includes(name);adventure.hidden=name!=='adventure';writer.hidden=name!=='writer';
        rail.querySelectorAll('.hero-nav').forEach(b=>b.classList.toggle('active',b.dataset.hero===name));
        if(isPanel&&!['adventure','writer','recent-chats','appearance'].includes(name)) frame.contentWindow?.postMessage({type:'hero-section',section:name},bridgeOrigin);
        const selectors={characters:'#rightNavDrawerIcon',world:'#WIDrawerIcon',settings:'#user-settings-button .drawer-toggle'};
        if(selectors[name])document.querySelector(selectors[name])?.click();
    };
    for(const [name,label] of [['chat','Tavern'],['recent-chats','Recent Chats'],['appearance','Appearance'],['model-center','All AI models'],['model-tests','Model Testing'],['voices','Voices'],['assistant','Ассистент'],['history','Story History'],['trackers','Trackers'],['lore','Lorebooks'],['characters','Characters'],['world','World info'],['adventure','Adventure'],['writer','Writer'],['creator','Character studio'],['memory','Chat memory'],['images','Image Studio'],['comfy-workflows','ComfyUI Workflows'],['storage','Storage'],['models','Models'],['vision','Image analyzer'],['hardware','Hardware'],['generation','Generation'],['diagnostics','Diagnostics'],['settings','Preferences']]){
        const b=document.createElement('button');b.className='hero-nav'+(name==='chat'?' active':'');b.dataset.hero=name;b.textContent=label;b.onclick=()=>show(name);rail.insertBefore(b,rail.lastElementChild);
    }
    document.body.append(rail,header,workspace,welcome);
    const exitButton=document.createElement('button');
    exitButton.type='button';exitButton.id='hero-exit-app';exitButton.className='hero-nav';
    exitButton.textContent='⏻ Exit Hero Tavern';
    exitButton.style.cssText='margin-top:16px;border:1px solid #9f6060;color:#ffcfca;background:#35262d;';
    exitButton.title='Safely stop Hero Tavern and its locally managed text/image/voice engines';
    rail.insertBefore(exitButton,rail.lastElementChild);
    exitButton.onclick=async()=>{
        if(!confirm('Exit Hero Tavern? Managed text models, ComfyUI, TTS and both local servers will stop. Saved chats, models and files are preserved.'))return;
        exitButton.disabled=true;exitButton.textContent='Stopping Hero Tavern…';
        try{
            const response=await bridgeRequest('/app/exit',{confirm:true});
            const notice=document.createElement('section');
            notice.id='hero-exit-notice';
            notice.style.cssText='position:fixed;inset:0;z-index:2147483600;background:#141a26;color:#f5dfb4;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font:18px Segoe UI,sans-serif';
            const info=document.createElement('div');
            const title=document.createElement('h2');title.textContent='Hero Tavern is closing safely';
            const detail=document.createElement('p');detail.textContent=response.message||'Stopping managed AI and saving session state. You can close this browser tab after the launcher window closes.';
            info.append(title,detail);notice.append(info);document.body.append(notice);
        }catch(e){
            exitButton.disabled=false;exitButton.textContent='⏻ Exit Hero Tavern';
            window.toastr?.error(e.message||'Could not request application exit.');
            alert('Exit request failed: '+e.message+'\nUse the launcher window to stop Hero Tavern.');
        }
    };

    document.getElementById('hero-welcome-close').onclick=dismissWelcome;
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){dismissWelcome();workspace.classList.remove('open');document.querySelectorAll('.hero-story-dialog').forEach(x=>x.remove());}});
    welcome.querySelectorAll('[data-hero]').forEach(b=>b.onclick=()=>show(b.dataset.hero));
    document.getElementById('hero-engine-chip').onclick=()=>show(engine?.backendError?'diagnostics':'models');
    async function connectLocalAI(data){
        if(connecting||!data.backendReady)return;
        const key=data.runningModel+'@'+data.apiURL;
        let current;try{current=context?.()}catch{}
        if(lastEngine===key && current?.onlineStatus && current.onlineStatus!=='no_connection')return;
        if(!window.jQuery||!document.querySelector('#textgen_type'))return;
        connecting=true;
        try{
            const $=window.jQuery;
            $('#main_api').val('textgenerationwebui').trigger('change');
            $('#textgen_type').val('koboldcpp').trigger('change');
            $('#koboldcpp_api_url_text').val(data.apiURL).trigger('input');
            $('#auto-connect-checkbox').prop('checked',true).trigger('change');
            $('#api_button_textgenerationwebui').trigger('click');
            lastEngine=key;
        }finally{setTimeout(()=>{connecting=false},5000)}
    }
    window.addEventListener('message',event=>{
        if(event.origin!==bridgeOrigin||event.source!==frame.contentWindow||event.data?.type!=='hero-state')return;
        engine=event.data.state;
        const chip=document.getElementById('hero-engine-chip');
        chip.textContent=engine.generationState==='analyzing'?'Updating trackers…':engine.generationState==='remembering'?'Updating memory…':engine.generationState==='planning'?'Preparing reply…':engine.generationState==='responding'?'Writing reply…':engine.backendReady?'Local AI ready · '+engine.runningModel.replace(/\.gguf$/,''):engine.backendError?'AI needs attention':engine.backendRunning?'Loading local AI…':engine.selected?'AI stopped · Load model':'No model · Choose AI';
        chip.title=engine.runtime?'Tracker engine: '+engine.runtime.trackerEngine+' · Runtime '+engine.runtime.runtimeHash.slice(0,12)+' · Started '+engine.runtime.startedAt:'Older service detected. Exit Hero Tavern and run the latest setup to activate the update.';
        chip.className='hero-chip'+(engine.backendReady?' ready':engine.backendError?' error':'');
        if(engine.backendReady)connectLocalAI(engine);
        else lastEngine='';
    });
    window.addEventListener('message',event=>{
      if(event.origin===bridgeOrigin&&event.source===adventure.contentWindow&&event.data?.type==='hero-open-panel'&&event.data.section==='image-setup')show('image-setup');
    });
    const chatIdentity=()=>{const c=context?.();return c&&(c.characterId!==undefined||c.groupId)&&c.chatId?String(c.groupId||c.characters?.[c.characterId]?.avatar||'character')+':'+c.chatId:'';};
    const pending=new Map();
    const c=context?.();
    // Voice playback follows the saved chat message, not raw reasoning or planning output.
    let heroSpeaking=false,heroAudio=null,heroLastSpoken='',heroVoiceStatus=null;
    async function heroVoiceSettings(){const state=await bridgeRequest('/tts/status',{});heroVoiceStatus=state;return state;}
    async function heroSpeakMessage(element,force=false){
      if(heroSpeaking)return;
      const button=element.querySelector('.hero-speak-message');
      let output=element.querySelector('.hero-voice-output');if(!output){output=document.createElement('div');output.className='hero-voice-output';button?.after(output);}
      heroSpeaking=true;
      try{
       const state=await heroVoiceSettings();if(!force&&!state.settings.enabled)return;
       const ctx=context?.(),index=Number(element.getAttribute('mesid')),message=ctx?.chat?.[index];
       const cleaned=String(message?.mes||element.querySelector('.mes_text')?.innerText||'').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi,'').trim();if(!cleaned)return;
       const id=(message?.extra?.heroMessageId||String(index))+'|'+cleaned;if(!force&&id===heroLastSpoken)return;
       const avatar=message?.original_avatar||message?.force_avatar;
       const character=avatar?ctx.characters?.find(c=>c.avatar===avatar):ctx.characters?.[ctx.characterId];
       const assignment=(character?.data?.extensions?.hero_tavern||character?.extensions?.hero_tavern)?.voice||{};
       output.textContent='Preparing voice…';if(button)button.disabled=true;
       const result=await bridgeRequest('/tts/message',{text:cleaned,assignment,messageId:message?.extra?.heroMessageId||String(index)});
       if(!document.contains(element))return;
       const audio=document.createElement('audio');audio.controls=true;audio.src=bridgeOrigin+result.url;heroAudio=audio;output.replaceChildren(audio);
       const download=document.createElement('a');download.href=audio.src;download.textContent=' Download voice';download.target='_blank';output.append(download);
       try{await audio.play()}catch{const note=document.createElement('p');note.textContent='Audio is ready. Click Play (browser blocked autoplay).';output.append(note)}
       heroLastSpoken=id;
      }catch(e){output.replaceChildren();const note=document.createElement('span');note.textContent='Voice unavailable: '+e.message+' ';const settings=document.createElement('button');settings.type='button';settings.className='hero-message-voice-settings';settings.textContent='Set this character’s voice';output.append(note,settings);console.warn('Hero Tavern TTS:',e.message)}finally{heroSpeaking=false;if(button)button.disabled=false;}
    }
    const heroChat=document.getElementById('chat');
    if(heroChat){
     heroChat.addEventListener('click',e=>{const settings=e.target.closest('.hero-message-voice-settings');if(settings){e.preventDefault();document.dispatchEvent(new CustomEvent('hero-open-character-voice',{detail:{message:settings.closest('.mes')}}));return}const button=e.target.closest('.hero-speak-message');if(button){e.preventDefault();heroAudio?.pause();heroSpeakMessage(button.closest('.mes'),true);}});
     const attachVoiceButtons=()=>{
      for(const message of heroChat.querySelectorAll('.mes:not(.is_user):not([is_user="true"])')){
       if(message.querySelector('.hero-speak-message'))continue;
       const text=message.querySelector('.mes_text');if(!text)continue;
       const btn=document.createElement('button');btn.className='hero-speak-message';btn.type='button';btn.textContent='▶ Voice';btn.title='Read narration and dialogue with separate voices';btn.style.cssText='margin:5px 0;padding:4px 9px;font-size:12px;border:1px solid #756348;border-radius:6px;background:#252b39;color:#e9d5a3;cursor:pointer';const settings=document.createElement('button');settings.className='hero-message-voice-settings';settings.type='button';settings.textContent='⚙ Character voice';settings.title='Choose this character’s dialogue and narrator voices';settings.style.cssText=btn.style.cssText+';margin-left:6px';text.after(btn,settings);
      }
     };
     let voiceTimer=null;
     new MutationObserver(()=>{clearTimeout(voiceTimer);voiceTimer=setTimeout(attachVoiceButtons,350)}).observe(heroChat,{subtree:true,childList:true});
     attachVoiceButtons();
     if(c?.eventSource&&c?.eventTypes?.GENERATION_ENDED)c.eventSource.on(c.eventTypes.GENERATION_ENDED,async()=>{
      const state=await heroVoiceSettings().catch(()=>null);if(!state?.settings?.enabled||!state.settings.autoPlay)return;
      const last=[...heroChat.querySelectorAll('.mes:not(.is_user):not([is_user="true"])')].at(-1);if(last)heroSpeakMessage(last);
     });
    }

    function bridgeRequest(route,data){return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('Local service timed out.'))},600000);pending.set(id,{resolve,reject,timer});frame.contentWindow.postMessage({type:'hero-request',id,route,data},bridgeOrigin)});}
    let generationType='normal';
    if(c){
        c.eventSource.on(c.eventTypes.GENERATION_STARTED,(type)=>{generationType=type;});
        c.eventSource.on(c.eventTypes.GENERATE_AFTER_DATA,(data,dryRun)=>{
            const current=context?.(),id=chatIdentity();
            if(generationType==='quiet'){const imageTask=/image|visual description|stable diffusion|comma.separated|photograph/i.test(data.prompt||'');data.hero_mode=imageTask?'image-prompt':'utility';if(imageTask)data.hero_image_context='Character appearance: '+String(current?.characters?.[current.characterId]?.description||'').slice(0,1200)+'\nCurrent visible scene: '+(current?.chat||[]).slice(-3).map(m=>m.name+': '+m.mes).join('\n').slice(-2800);}
            if(dryRun||!engine?.backendReady||!id||!current||['quiet','impersonate'].includes(generationType)||typeof data.prompt!=='string'||data.api_type!=='koboldcpp')return;
            let messages=current.chat.filter(m=>!m.is_system||m.mes).map(m=>({role:m.is_user?'user':m.is_system?'system':'assistant',name:m.name||'',text:m.mes||''}));
            if(generationType==='swipe'&&messages.at(-1)?.role==='assistant')messages=messages.slice(0,-1);
            data.hero_context={id,messages,generationType};
        });
    }
    window.addEventListener('message',event=>{if(event.origin!==bridgeOrigin||event.source!==adventure.contentWindow||event.data?.type!=='hero-adventure-party-cards')return;const cards=(context?.()?.characters||[]).map(card=>({name:card.name,avatar:card.avatar,data:{name:card.data?.name||card.name,description:card.data?.description||card.description,personality:card.data?.personality||card.personality,scenario:card.data?.scenario||card.scenario}}));adventure.contentWindow.postMessage({type:'hero-adventure-party-cards-result',cards},bridgeOrigin);});
    window.addEventListener('message',async event=>{
        if(event.origin!==bridgeOrigin||event.source!==frame.contentWindow)return;
        if(event.data?.type==='hero-response'){const item=pending.get(event.data.id);if(item){clearTimeout(item.timer);pending.delete(event.data.id);event.data.error?item.reject(Error(event.data.error)):item.resolve(event.data.value);}return;}
        if(event.data?.type==='hero-memory-context'){const current=context?.();frame.contentWindow.postMessage({type:'hero-memory-chat',id:current?.chatMetadata?.hero_tavern?.sessionId||chatIdentity(),label:current?.chatId?current.name2+' · '+current.chatId:'Select a character and chat first.'},bridgeOrigin);}
        if(event.data?.type==='hero-image-chat'){
            const current=context?.();if(!chatIdentity()||!/^\/images\/output\/[0-9]+-[a-f0-9]+\.png$/.test(event.data.url)){window.toastr?.info('Select a character chat before adding an image.');return;}
            try{
                const chosenChat=chatIdentity(),imageResponse=await fetch(bridgeOrigin+event.data.url);if(!imageResponse.ok)throw Error('Generated image is unavailable.');
                const blob=await imageResponse.blob(),dataURL=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read generated image.'));reader.readAsDataURL(blob)});
                const response=await fetch('/api/images/upload',{method:'POST',headers:current.getRequestHeaders(),body:JSON.stringify({image:String(dataURL).split(',')[1],format:'png',filename:'hero-'+Date.now(),ch_name:'Hero-Tavern'})});
                const uploaded=await response.json();if(!response.ok||!uploaded.path)throw Error('Could not save image in the chat library.');if(chatIdentity()!==chosenChat)throw Error('Chat changed. Select the original chat and add the image again.');
                const message={name:current.name2,is_user:false,is_system:false,send_date:new Date().toISOString(),mes:'![Generated image]('+uploaded.path+')',extra:{}};
                current.chat.push(message);current.addOneMessage(message);await current.saveChat();show('chat');
            }catch(e){window.toastr?.error(e.message)}
        }
        if(event.data?.type==='hero-character-import'){
            try{
                const current=context?.(),card=event.data.card,base=card?.spec?card.data:card;
                if(!base||typeof base.name!=='string'||typeof base.description!=='string')throw Error('Invalid character card');
                const form=new FormData();form.append('avatar',new File([JSON.stringify(card)],'hero-character.json',{type:'application/json'}));form.append('file_type','json');
                const headers=current.getRequestHeaders();delete headers['Content-Type'];
                const response=await fetch('/api/characters/import',{method:'POST',headers,body:form});const imported=await response.json();if(!response.ok||imported.error||!imported.file_name)throw Error('Character import failed');
                await current.getCharacters();show('characters');window.toastr?.success('Character created. Select it to start chatting.');
            }catch(e){window.toastr?.error(e.message)}
        }
    });
    await (await import('./story.js')).initStory({getContext:context,frame,show});
    await (await import('./images.js')).initChatImages({getContext:context,bridgeRequest,show});
    const updateDock = () => {
        const panel=document.getElementById('right-nav-panel');
        const isOpen=panel&&getComputedStyle(panel).display!=='none'&&panel.getBoundingClientRect().width>0&&!panel.classList.contains('closedDrawer');
        const width=isOpen&&innerWidth>=1100?Math.min(480,innerWidth-480):0;
        document.documentElement.style.setProperty('--hero-right',width+'px');
    };
    const rightPanel=document.getElementById('right-nav-panel');
    if(rightPanel)new MutationObserver(updateDock).observe(rightPanel,{attributes:true,attributeFilter:['class','style']});
    window.addEventListener('resize',()=>{applyUI();updateDock();});updateDock();
    const cleanMessages = nodes => {
        for(const node of nodes){
            if(!node.closest('.mes[is_user="false"]'))continue;
            if(!/(?:<|&lt;|\[)(?:think|analysis|reasoning)/i.test(node.innerHTML))continue;
            const cleaned=globalThis.HeroReplyFilters.filterReply(node.innerHTML,{removeModelTokens:true});
            if(cleaned!==node.innerHTML)node.innerHTML=cleaned;
        }
    };
    const chat=document.getElementById('chat');
    if(chat){new MutationObserver(()=>cleanMessages(chat.querySelectorAll('.mes_text'))).observe(chat,{subtree:true,childList:true,characterData:true});cleanMessages(chat.querySelectorAll('.mes_text'));}
    setInterval(()=>{try{const c=context?.();if(c)welcome.hidden=welcomeDismissed||workspace.classList.contains('open')||!!c.groupId||!!c.characters?.[c.characterId];}catch{}},1000);
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initHeroTavern);else initHeroTavern();
