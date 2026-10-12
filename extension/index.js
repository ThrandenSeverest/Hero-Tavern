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
    #hero-shell{position:fixed;inset:0 auto 0 0;width:var(--hero-rail);background:#181e2a;border-right:1px solid #323b4c;z-index:2000;display:flex;flex-direction:column;padding:24px 14px;overflow-y:auto;box-sizing:border-box;color:#e7eaf0;font:14px 'Segoe UI',sans-serif}
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
    rail.innerHTML='<div class="hero-brand">Hero Tavern</div><div class="hero-tagline">Your stories. Your AI.</div><div class="hero-rail-foot">Powered by SillyTavern<br>Local AI · KoboldCpp<br>Hero Tavern 0.8</div>';
    const header=document.createElement('header');header.id='hero-header';
    header.innerHTML='<strong id="hero-page-title">Your tavern</strong><button id="hero-engine-chip" class="hero-chip">Checking local AI…</button>';
    const workspace=document.createElement('main');workspace.id='hero-workspace';
    const closePanel=document.createElement('button');closePanel.id='hero-panel-close';closePanel.textContent='Back to chat ×';closePanel.style.cssText='position:absolute;right:18px;top:8px;z-index:2;padding:8px;border:1px solid #64748b;background:#27354a;color:white;border-radius:8px;cursor:pointer';closePanel.onclick=()=>show('chat');workspace.append(closePanel);
    const frame=document.createElement('iframe');frame.id='hero-model-frame';frame.title='Hero Tavern models and hardware';frame.src=bridgeOrigin+'/';workspace.append(frame);
    const welcome=document.createElement('section');welcome.id='hero-welcome';
    welcome.innerHTML='<button id="hero-welcome-close" aria-label="Close welcome" style="float:right;padding:10px;border:1px solid #64748b;border-radius:8px;background:#27354a;color:white;cursor:pointer">Close ×</button><div class="hero-eyebrow">Welcome to your tavern</div><h1 class="hero-welcome-title">Every character has a story.<br>Start yours here.</h1><p class="hero-lead">Create a character, bring your world to life, and chat with an AI running on your own computer.</p><div class="hero-cards"><article class="hero-card"><h3>1 · Choose your AI</h3><p>Try Rocinante or Qwen, or load an installed model. Hero Tavern runs and connects the engine for you.</p><button class="hero-action" data-hero="models">Open models</button></article><article class="hero-card"><h3>2 · Meet a character</h3><p>Create someone new or import a SillyTavern character card to begin your conversation.</p><button class="hero-action" data-hero="characters">Characters</button></article><article class="hero-card"><h3>3 · Build your world</h3><p>Add places, lore and memories with SillyTavern’s World Info tools.</p><button class="hero-action" data-hero="world">World info</button></article></div>';
    const adventure=document.createElement('iframe');adventure.id='hero-adventure-frame';adventure.title='Ilreon Adventure mode';adventure.src=bridgeOrigin+'/adventure';adventure.hidden=true;adventure.style.cssText='width:100%;height:100%;border:0';workspace.append(adventure);
    let welcomeDismissed=false;const dismissWelcome=()=>{welcomeDismissed=true;welcome.hidden=true;};
    const show = name => {
        dismissWelcome();
        if(name==='chat'){const panel=document.getElementById('right-nav-panel');if(panel&&!panel.classList.contains('closedDrawer')&&getComputedStyle(panel).display!=='none')document.querySelector('#rightNavDrawerIcon')?.click();}
        const isPanel=['assistant','models','hardware','generation','memory','images','storage','creator','adventure','diagnostics','history','trackers','lore','inspector'].includes(name);
        workspace.classList.toggle('open',isPanel);
        document.getElementById('hero-page-title').textContent={assistant:'Ассистент · Qwen',diagnostics:'Diagnostics',history:'Saved stories',trackers:'Story trackers',lore:'Lorebook editor',inspector:'Prompt Inspector',adventure:'Ilreon · Adventure mode',images:'Image Studio',storage:'Storage & cleanup',memory:'Chat memory',creator:'Character studio',generation:'Generation',hardware:'Hardware'}[name]||(isPanel?'Models & local AI':'Your tavern');frame.hidden=name==='adventure';adventure.hidden=name!=='adventure';
        rail.querySelectorAll('.hero-nav').forEach(b=>b.classList.toggle('active',b.dataset.hero===name));
        if(isPanel&&name!=='adventure') frame.contentWindow?.postMessage({type:'hero-section',section:name},bridgeOrigin);
        const selectors={characters:'#rightNavDrawerIcon',world:'#WIDrawerIcon',settings:'#user-settings-button .drawer-toggle'};
        if(selectors[name])document.querySelector(selectors[name])?.click();
    };
    for(const [name,label] of [['chat','Tavern'],['assistant','Ассистент'],['history','Chats'],['trackers','Trackers'],['lore','Lorebooks'],['characters','Characters'],['world','World info'],['adventure','Adventure'],['creator','Character studio'],['memory','Chat memory'],['images','Image Studio'],['storage','Storage'],['models','Models'],['hardware','Hardware'],['generation','Generation'],['diagnostics','Diagnostics'],['settings','Preferences']]){
        const b=document.createElement('button');b.className='hero-nav'+(name==='chat'?' active':'');b.dataset.hero=name;b.textContent=label;b.onclick=()=>show(name);rail.insertBefore(b,rail.lastElementChild);
    }
    document.body.append(rail,header,workspace,welcome);
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
        chip.className='hero-chip'+(engine.backendReady?' ready':engine.backendError?' error':'');
        if(engine.backendReady)connectLocalAI(engine);
        else lastEngine='';
    });
    const chatIdentity=()=>{const c=context?.();return c&&(c.characterId!==undefined||c.groupId)&&c.chatId?String(c.groupId||c.characters?.[c.characterId]?.avatar||'character')+':'+c.chatId:'';};
    const pending=new Map();
    function bridgeRequest(route,data){return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('Local service timed out.'))},600000);pending.set(id,{resolve,reject,timer});frame.contentWindow.postMessage({type:'hero-request',id,route,data},bridgeOrigin)});}
    let generationType='normal';
    const c=context?.();
    if(c){
        c.eventSource.on(c.eventTypes.GENERATION_STARTED,(type)=>{generationType=type;});
        c.eventSource.on(c.eventTypes.GENERATE_AFTER_DATA,(data,dryRun)=>{
            const current=context?.(),id=chatIdentity();
            if(generationType==='quiet')data.hero_mode='utility';
            if(dryRun||!engine?.backendReady||!id||!current||['quiet','impersonate'].includes(generationType)||typeof data.prompt!=='string'||data.api_type!=='koboldcpp')return;
            let messages=current.chat.filter(m=>!m.is_system||m.mes).map(m=>({role:m.is_user?'user':m.is_system?'system':'assistant',name:m.name||'',text:m.mes||''}));
            if(generationType==='swipe'&&messages.at(-1)?.role==='assistant')messages=messages.slice(0,-1);
            data.hero_context={id,messages,generationType};
        });
    }
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
    setInterval(()=>{try{const c=context?.();if(c)welcome.hidden=welcomeDismissed||workspace.classList.contains('open')||!!c.groupId||!!c.characters?.[c.characterId];}catch{}},1000);
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initHeroTavern);else initHeroTavern();
