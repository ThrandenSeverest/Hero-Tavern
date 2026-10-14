'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const adventure=fs.readFileSync(path.join(root,'manager','Adventure.html'),'utf8');
const creator=fs.readFileSync(path.join(root,'manager','CreatorPanel.js'),'utf8');

function canonicalLore(){
 const marker='const HERO_ILREON_LORE=',i=adventure.indexOf(marker);
 assert.ok(i>=0,'Adventure must embed the Ilreon lorebook');
 const start=adventure.indexOf('{',i+marker.length);
 let depth=0,quoted=false,escaped=false,end=-1;
 for(let j=start;j<adventure.length;j++){
  const c=adventure[j];
  if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"'){quoted=true;continue;}
  if(c==='{')depth++;
  if(c==='}'&&--depth===0){end=j+1;break;}
 }
 assert.ok(end>start,'Lorebook must have complete JSON');
 return JSON.parse(adventure.slice(start,end));
}

test('all 159 canonical Ilreon NPCs can be selected without replacing baseline or Tavern choices',()=>{
 const lore=canonicalLore();
 assert.equal(lore.entries.filter(e=>e.category==='npc').length,159);
 const start=adventure.indexOf('function HERO_partyChoices()');
 const end=adventure.indexOf('function HERO_requestPartyCards()',start);
 assert.ok(start>=0&&end>start);
 const context={
  HERO_ILREON_LORE:lore,
  HERO_partyCards:new Map([['tavern-card',{id:'tavern-card',name:'Tavern card'}]]),
  seedNpcs:()=>({tavern_keeper:{id:'tavern_keeper',name:'Savos'},guard_sergeant:{id:'guard_sergeant',name:'Sergeant'},degal:{id:'degal',name:'Degal'},masked_assassin:{id:'masked_assassin'}})
 };
 const list=vm.runInNewContext(adventure.slice(start,end)+'; HERO_partyChoices()',context);
 assert.equal(list.filter(x=>x.canonical).length,159);
 assert.equal(list.length,163);
 assert.ok(list.every(x=>x.id!=='masked_assassin'));
 assert.ok(list.some(x=>x.id==='tavern-card'));
 assert.ok(list.some(x=>x.id==='npc_noble_durant_0'&&x.name==='Дункан Дурант'));
 assert.ok(new Set(list.map(x=>x.id)).size===list.length);
});
test('filtered companion selector keeps chosen identities through searching and start',()=>{
 assert.match(adventure,/id="heroStartPartySearch"/);
 assert.match(adventure,/const chosen=HERO_partySelected/);
 assert.match(adventure,/HERO_partySelected\.add\(n\.id\)/);
 assert.match(adventure,/ids=HERO_partySelected/);
 assert.match(adventure,/memberIds:\[\.\.\.HERO_partySelected\]/);
});
test('NPC portrait prohibitions are in negative prompt, not positive narration',()=>{
 assert.doesNotMatch(adventure,/Do NOT add an eye patch, blindfold/);
 assert.doesNotMatch(adventure,/Do NOT add a crown, tiara/);
 assert.match(adventure,/negatives\.push\('eye patch, blindfold, eye bandage, missing eye'\)/);
 assert.match(adventure,/negatives\.push\('crown, tiara, diadem, royal headpiece'\)/);
 assert.match(adventure,/Белая рубашка/);
 assert.match(adventure,/зелёный жакет/i);
});
test('NPC outfits are controlled by world events, not writable NPC-profile fields',()=>{
 assert.match(adventure,/function HERO_setNpcOutfit/);
 assert.match(adventure,/Экипировка и одежда изменяются только действиями в мире/);
 assert.doesNotMatch(adventure,/input\.value=n\.currentOutfit\|\|''/);
 assert.match(adventure,/портрет не из локальной галереи/);
});
test('deleting an existing character tracker persists immediately',()=>{
 assert.match(creator,/await window\.HeroStoryPanel\.send\('profile',\{profile:next\}\)/);
 assert.match(creator,/removedTrackers\.clear\(\);expandedTemplates\.clear\(\);renderCreatorTrackers\(\)/);
 assert.match(creator,/preset\.checked=false/);
});
