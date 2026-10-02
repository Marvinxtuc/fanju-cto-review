import {constants,existsSync,lstatSync,mkdirSync,openSync,closeSync,writeFileSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import {downloadWechatTradeBill} from './wechat-trade-bill.js';

// Operator-only GET acquisition. Not wired to HTTP, a worker or release activation.
// Real financial CSVs are private external artifacts and must never enter Git.
async function main(){
 const env=process.env,date=process.argv[2],directory=env.WECHAT_BILL_ARCHIVE_DIR;
 if(env.FEATURE_V11_BILL_DOWNLOAD!=='true'||!date||process.argv.length!==3||!directory||!isAbsolute(directory))throw Error('Explicit bill acquisition configuration required');
 let ancestor=directory;while(!existsSync(ancestor)){const next=dirname(ancestor);if(next===ancestor)throw Error('Archive directory unavailable');ancestor=next;}
 ancestor=realpathSync(ancestor);
 for(let at=ancestor;;at=dirname(at)){if(existsSync(join(at,'.git')))throw Error('Archive must be outside Git');if(dirname(at)===at)break;}
 mkdirSync(directory,{recursive:true,mode:0o700});const archive=realpathSync(directory);
 if(!lstatSync(archive).isDirectory()||(lstatSync(archive).mode&0o077)!==0)throw Error('Private archive directory required');
 const bill=await downloadWechatTradeBill(env,date);
 const base=join(archive,date+'-'+bill.sourceSha256);
 function save(path:string,bytes:Buffer){
  try{const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,bytes);}finally{closeSync(fd);}}
  catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST'))throw error;
   const stat=lstatSync(path);if(!stat.isFile()||(stat.mode&0o077)!==0||!readFileSync(path).equals(bytes))throw Error('Archive conflict');}
 }
 save(base+'.csv',bill.rawBill);
 // Timestamp differs on a later fetch. Raw exact bytes + content hash are the
 // replay identity; every verified fetch gets its own metadata evidence file.
 const {rawBill,...metadata}=bill;
 const evidence=Buffer.from(JSON.stringify({...metadata,rawByteLength:rawBill.length},null,2)+'\n');
 save(base+'.'+createHash('sha256').update(evidence).digest('hex')+'.verification.json',evidence);
 console.log(JSON.stringify({billDate:date,sourceSha256:bill.sourceSha256,rawByteLength:rawBill.length,scope:bill.scope,coverageState:bill.coverageState}));
}
main().catch(()=>{console.error('Verified trade-bill acquisition failed; no completeness conclusion recorded');process.exitCode=1;});
