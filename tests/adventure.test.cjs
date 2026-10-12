const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('Bundled Ilreon parses with the local adapter, all spell cards and original mechanics',()=>{
 const root=path.join(__dirname,'../manager'),html=fs.readFileSync(path.join(root,'Adventure.html'),'utf8');
 for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);new vm.Script(fs.readFileSync(path.join(root,'AdventureAdapter.js'),'utf8'));
 assert.match(html,/adventure-adapter\.js/);for(const fn of ['resolvePlayerAction','ILR154_combatNarrationBeat','importLssCharacter','undoTurn','loadFromSlot','generateNpcPortrait'])assert.ok(html.includes(fn));
 const spells=JSON.parse(fs.readFileSync(path.join(root,'spells.json')));assert.equal(spells.length,514);assert.equal(new Set(spells.map(x=>x.id)).size,514);
});
