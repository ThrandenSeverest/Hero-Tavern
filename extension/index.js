// Hero Tavern application shell over SillyTavern's chat, character and world tools.
const bridgeOrigin = 'http://127.0.0.1:8001';
let lastEngine = '', connecting = false, context = null, engine = null;
const initHeroTavern = async () => {
    if (document.getElementById('hero-shell')) return;
    await import('./reply-filters.js');
    try { context = (await import('../../extensions.js')).getContext; } catch {}
    document.title = 'Hero Tavern';
    document.documentElement.classList.add('hero-tavern-app');
    const style = document.createElement('style');
    style.textContent = `
    .hero-tavern-app{--hero-rail:200px;--hero-top:66px;--hero-right:0px;--hero-drawer-width:480px;--hero-gold:#e0b96f;--hero-bg:#121620;--hero-surface:#1c2230;--hero-border:#323b4c;--sheldWidth:100%;--blurStrength:0;--SmartThemeBodyColor:#121620;--SmartThemeBlurTintColor:#1c2230;--SmartThemeChatTintColor:#151b26;--SmartThemeQuoteColor:#e0b96f;--SmartThemeBorderColor:#323b4c}
    .hero-tavern-app body{background:#121620!important;font-family:Inter,'Segoe UI',sans-serif}
    #hero-shell{position:fixed;inset:0 auto 0 0;width:var(--hero-rail);background:#181e2a;border-right:1px solid #323b4c;z-index:2000;display:flex;flex-direction:column;padding:24px 14px;box-sizing:border-box;color:#e7eaf0;font:14px 'Segoe UI',sans-serif}
    .hero-brand{font-size:23px;font-weight:700;letter-spacing:-.7px;color:#f0d29b;margin:0 8px 6px}.hero-tagline{font-size:11px;color:#949caf;margin:0 8px 30px;text-transform:uppercase;letter-spacing:1.4px}.hero-nav{border:0;border-radius:9px;padding:13px 15px;text-align:left;background:transparent;color:#bac3d4;font:600 14px 'Segoe UI',sans-serif;cursor:pointer;margin:3px 0}.hero-nav:hover,.hero-nav.active{background:#30394b;color:#f3d49e}.hero-rail-foot{margin-top:auto;padding:15px 8px;color:#929db0;font-size:12px;line-height:1.8}
    #hero-header{position:fixed;top:0;left:var(--hero-rail);right:0;height:var(--hero-top);box-sizing:border-box;background:#171d29;border-bottom:1px solid #323b4c;z-index:1999;display:flex;align-items:center;justify-content:space-between;padding:0 28px;color:#e9edf5;font:14px 'Segoe UI',sans-serif;gap:12px}.hero-chip{border:1px solid #44516a;border-radius:22px;padding:9px 16px;background:#232d3d;cursor:pointer;color:#d4def0;max-width:65%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hero-chip.ready{color:#9adeb6;border-color:#42775e}.hero-chip.error{color:#ffb4ad;border-color:#9a534e}
    .hero-tavern-app #top-settings-holder{top:var(--hero-top)!important;left:var(--hero-rail)!important;right:0!important;width:calc(100% - var(--hero-rail))!important;transform:none!important;background:#1b2230!important;justify-content:center;z-index:1998}
    .hero-tavern-app #sheld{left:var(--hero-rail)!important;right:var(--hero-right)!important;top:calc(var(--hero-top) + 48px)!important;width:calc(100% - var(--hero-rail) - var(--hero-right))!important;max-width:none!important;height:calc(100dvh - var(--hero-top) - 48px)!important;margin:0!important;transform:none!important;border:0!important;background:#151b26!important}
    .hero-tavern-app #chat{padding:22px 5%;background:#151b26!important}.hero-tavern-app .mes{border:1px solid #303b4e;border-radius:12px;margin-bottom:16px;background:#1b2331!important;padding:18px}.hero-tavern-app #send_form{background:#202939!important;border:1px solid #3a4960;border-radius:14px;margin:8px 3%;width:94%}
    .hero-tavern-app .drawer-content{top:calc(var(--hero-top) + 48px)!important;max-height:calc(100dvh - var(--hero-top) - 48px)!important;background:#1d2533!important;backdrop-filter:none!important;border:1px solid #3b4860!important;border-radius:12px!important}
    .hero-tavern-app #right-nav-panel{position:fixed!important;top:calc(var(--hero-top) + 48px)!important;right:0!important;left:auto!important;width:var(--hero-drawer-width)!important;max-width:calc(100vw - var(--hero-rail))!important;height:calc(100dvh - var(--hero-top) - 48px)!important;overflow-y:auto!important;border-radius:12px 0 0 0!important;padding:14px!important;box-sizing:border-box!important;transform:none!important}
    .hero-tavern-app #left-nav-panel,.hero-tavern-app #rm_api_block,.hero-tavern-app #WorldInfo,.hero-tavern-app #user-settings-block{left:calc(var(--hero-rail) + 12px)!important;right:auto!important;max-width:calc(100vw - var(--hero-rail) - 24px)!important;overflow-y:auto!important}
    .hero-tavern-app #chat .mes_text{overflow-wrap:anywhere;min-width:0}.hero-tavern-app #chat .mes_reasoning,.hero-tavern-app #chat .reasoning_block{display:none!important}
    #hero-workspace{position:fixed;left:var(--hero-rail);right:0;top:var(--hero-top);bottom:0;background:#151b26;z-index:1999;display:none}#hero-workspace.open{display:block}#hero-model-frame{width:100%;height:100%;border:0}
    #hero-welcome{position:fixed;left:calc(var(--hero-rail) + 5%);right:calc(var(--hero-right) + 5%);top:calc(var(--hero-top) + 68px);bottom:80px;z-index:1997;background:#151b26;color:#e4eaf4;padding:36px;box-sizing:border-box;overflow:auto}.hero-eyebrow{color:#d9b771;text-transform:uppercase;letter-spacing:2px;font-size:12px}.hero-welcome-title{font-size:clamp(28px,4vw,48px);line-height:1.15;letter-spacing:-1.5px;max-width:720px;margin:18px 0}.hero-lead{color:#aab8ca;font-size:17px;max-width:650px;line-height:1.6}.hero-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;max-width:1080px;margin-top:32px}.hero-card{background:#202a3a;border:1px solid #3a485f;border-radius:16px;padding:24px}.hero-card h3{margin:0 0 12px;font-size:18px}.hero-card p{color:#a7b6c9;line-height:1.6;font-size:14px;min-height:60px}.hero-action{border:1px solid #c29c55;background:#d7b16b;color:#171b25;border-radius:8px;padding:11px 17px;cursor:pointer;font:600 14px 'Segoe UI',sans-serif}
    @media(max-width:900px){.hero-tavern-app{--hero-rail:76px}.hero-brand{font-size:13px;margin-left:0}.hero-tagline,.hero-rail-foot{display:none}.hero-nav{font-size:11px;padding:12px 3px;text-align:center}#hero-shell{padding:16px 5px}.hero-cards{grid-template-columns:1fr}#hero-header{padding:0 14px}#hero-welcome{padding:18px}}
    `;
    document.head.append(style);
    const rail = document.createElement('nav');rail.id='hero-shell';rail.setAttribute('aria-label','Hero Tavern navigation');
    rail.innerHTML='<div class="hero-brand">Hero Tavern</div><div class="hero-tagline">Your stories. Your AI.</div><div class="hero-rail-foot">Powered by SillyTavern<br>Local AI · KoboldCpp<br>Hero Tavern 0.4</div>';
    const header=document.createElement('header');header.id='hero-header';
    header.innerHTML='<strong id="hero-page-title">Your tavern</strong><button id="hero-engine-chip" class="hero-chip">Checking local AI…</button>';
    const workspace=document.createElement('main');workspace.id='hero-workspace';
    const frame=document.createElement('iframe');frame.id='hero-model-frame';frame.title='Hero Tavern models and hardware';frame.src=bridgeOrigin+'/';workspace.append(frame);
    const welcome=document.createElement('section');welcome.id='hero-welcome';
    welcome.innerHTML='<div class="hero-eyebrow">Welcome to your tavern</div><h1 class="hero-welcome-title">Every character has a story.<br>Start yours here.</h1><p class="hero-lead">Create a character, bring your world to life, and chat with an AI running on your own computer.</p><div class="hero-cards"><article class="hero-card"><h3>1 · Choose your AI</h3><p>Download Qwen or load an installed model. Hero Tavern runs and connects the engine for you.</p><button class="hero-action" data-hero="models">Open models</button></article><article class="hero-card"><h3>2 · Meet a character</h3><p>Create someone new or import a SillyTavern character card to begin your conversation.</p><button class="hero-action" data-hero="characters">Characters</button></article><article class="hero-card"><h3>3 · Build your world</h3><p>Add places, lore and memories with SillyTavern’s World Info tools.</p><button class="hero-action" data-hero="world">World info</button></article></div>';
    const show = name => {
        if(name==='chat'){const panel=document.getElementById('right-nav-panel');if(panel&&!panel.classList.contains('closedDrawer')&&getComputedStyle(panel).display!=='none')document.querySelector('#rightNavDrawerIcon')?.click();}
        const isPanel=['models','hardware','generation','diagnostics'].includes(name);
        workspace.classList.toggle('open',isPanel);
        document.getElementById('hero-page-title').textContent=isPanel?'Models & local AI':'Your tavern';
        rail.querySelectorAll('.hero-nav').forEach(b=>b.classList.toggle('active',b.dataset.hero===name));
        if(isPanel) frame.contentWindow?.postMessage({type:'hero-section',section:name},bridgeOrigin);
        const selectors={characters:'#rightNavDrawerIcon',world:'#WIDrawerIcon',settings:'#user-settings-button .drawer-toggle'};
        if(selectors[name])document.querySelector(selectors[name])?.click();
    };
    for(const [name,label] of [['chat','Chat'],['characters','Characters'],['world','World info'],['models','Models'],['hardware','Hardware'],['generation','Generation'],['settings','Preferences']]){
        const b=document.createElement('button');b.className='hero-nav'+(name==='chat'?' active':'');b.dataset.hero=name;b.textContent=label;b.onclick=()=>show(name);rail.insertBefore(b,rail.lastElementChild);
    }
    document.body.append(rail,header,workspace,welcome);
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
        chip.textContent=engine.generationState==='planning'?'Preparing reply…':engine.generationState==='responding'?'Writing reply…':engine.backendReady?'Local AI ready · '+engine.runningModel.replace(/\.gguf$/,''):engine.backendError?'AI needs attention':engine.backendRunning?'Loading local AI…':engine.selected?'AI stopped · Load model':'No model · Get Qwen';
        chip.className='hero-chip'+(engine.backendReady?' ready':engine.backendError?' error':'');
        if(engine.backendReady)connectLocalAI(engine);
        else lastEngine='';
    });
    const updateDock = () => {
        const panel=document.getElementById('right-nav-panel');
        const isOpen=panel&&getComputedStyle(panel).display!=='none'&&panel.getBoundingClientRect().width>0&&!panel.classList.contains('closedDrawer');
        const width=isOpen&&innerWidth>=1100?Math.min(480,innerWidth-480):0;
        document.documentElement.style.setProperty('--hero-right',width+'px');
    };
    const rightPanel=document.getElementById('right-nav-panel');
    if(rightPanel)new MutationObserver(updateDock).observe(rightPanel,{attributes:true,attributeFilter:['class','style']});
    window.addEventListener('resize',updateDock);updateDock();
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
    setInterval(()=>{try{const c=context?.();if(c)welcome.hidden=!!c.groupId||!!c.characters?.[c.characterId];}catch{}},1000);
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initHeroTavern);else initHeroTavern();
