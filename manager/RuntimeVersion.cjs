// Identify code loaded by this process, independently of filenames on disk later.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const FILES=['ModelBridge.cjs','StoryAPI.cjs','WTracker.cjs','WTrackerUpstream.cjs','ReplyPipeline.cjs','SillyTavern/public/scripts/extensions/hero-tavern/story.js','SillyTavern/public/scripts/extensions/hero-tavern/index.js'];
function runtimeVersion(root){
 const hash=crypto.createHash('sha256'),missing=[];
 for(const name of FILES){hash.update(name+'\0');const file=path.join(root,name);if(fs.existsSync(file))hash.update(fs.readFileSync(file));else{missing.push(name);hash.update('[missing]')}hash.update('\0');}
 return {trackerEngine:'wtracker-1',runtimeHash:hash.digest('hex'),missing};
}
if(require.main===module){const root=path.resolve(process.argv[2]||'.'),version=runtimeVersion(root);if(version.missing.length)throw Error('Incomplete installation: '+version.missing.join(', '));fs.writeFileSync(path.join(root,'runtime-version.json'),JSON.stringify(version,null,2));console.log('Installed WTracker runtime '+version.runtimeHash.slice(0,12));}
module.exports={runtimeVersion,FILES};
