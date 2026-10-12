'use strict';
const fs=require('node:fs'),path=require('node:path');
function runtimeEnvironment(root,role){
 if(!['text','image','thinking'].includes(role))throw Error('Unexpected KoboldCpp worker role.');
 const temp=path.join(root,'Cache','KoboldCpp',role);
 fs.mkdirSync(temp,{recursive:true});
 if(fs.lstatSync(temp).isSymbolicLink())throw Error('Refusing symlinked runtime temp.');
 // TMPDIR helps Linux test fixtures; TEMP/TMP are honored by Windows/PyInstaller.
 return {...process.env,TEMP:temp,TMP:temp,TMPDIR:temp};
}
module.exports={runtimeEnvironment};