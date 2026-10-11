// Built-in companion panel; no server plugins or remote services required.
const initHeroTavern = () => {
    if (document.getElementById('hero-tavern-models')) return;
    const button = document.createElement('button');
    button.id = 'hero-tavern-models';
    button.textContent = 'Hero Tavern · Models';
    button.className = 'menu_button';
    button.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:1000;padding:10px 16px;';
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'width:min(900px,94vw);height:min(730px,90vh);padding:0;border:1px solid #656575;border-radius:14px;background:#171722;color:#eee;';
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.className = 'menu_button';
    close.style.cssText = 'position:absolute;right:18px;top:10px;z-index:2;';
    close.onclick = () => dialog.close();
    const frame = document.createElement('iframe');
    frame.title = 'Hero Tavern model library';
    frame.style.cssText = 'width:100%;height:100%;border:0;';
    frame.src = 'http://127.0.0.1:8001/';
    dialog.append(close, frame);
    document.body.append(button, dialog);
    button.onclick = () => dialog.showModal();
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHeroTavern);
else initHeroTavern();
