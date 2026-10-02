import {constants,openSync,closeSync,fstatSync,lstatSync,readSync,writeFileSync,fsyncSync,renameSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
// This cache stores raw financial bytes, never credentials or download URLs.
// It conveys no trust: callers must obtain fresh signed metadata and rehash.
const repo=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
function fail():never{throw Error('Private bill cache unavailable or rejected');}
export function validateBillCacheDirectory(directory:string){
 if(!isAbsolute(directory)||resolve(directory)!==directory)fail();
 const within=relative(repo,directory);
 // Use path relationships, not a string prefix (repo-other is a different tree).
 if(within===''||(!within.startsWith('../')&&!within.startsWith('..\\')&&!isAbsolute(within)))fail();
 const stat=lstatSync(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(directory)!==directory||stat.uid!==process.getuid?.()||(stat.mode&0o777)!==0o700)fail();
}
function cachePath(directory:string,key:string){validateBillCacheDirectory(directory);if(!/^[a-f0-9]{64}$/.test(key))fail();return join(directory,key+'.bill');}
export function readBillCache(directory:string,key:string,maxBytes:number):Buffer|undefined{
 const path=cachePath(directory,key);let fd:number;
 try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')return undefined;fail();}
 try{
  const stat=fstatSync(fd);if(!stat.isFile()||stat.uid!==process.getuid?.()||(stat.mode&0o777)!==0o600||stat.size<1||stat.size>maxBytes)fail();
  const chunks:Buffer[]=[];let size=0;
  while(true){const chunk=Buffer.alloc(Math.min(65536,maxBytes-size+1));const count=readSync(fd,chunk,0,chunk.length,null);if(!count)break;size+=count;if(size>maxBytes)fail();chunks.push(chunk.subarray(0,count));}
  if(size!==stat.size)fail();return Buffer.concat(chunks,size);
 }finally{closeSync(fd);}
}
export function writeBillCache(directory:string,key:string,bytes:Buffer){
 const destination=cachePath(directory,key),temporary=mkdtempSync(join(directory,'.download-'));
 let fd:number|undefined;
 try{
  const file=join(temporary,'complete.bill');fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=undefined;
  renameSync(file,destination);
  const root=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(root);}finally{closeSync(root);}
 }finally{if(fd!==undefined)closeSync(fd);rmSync(temporary,{recursive:true,force:true});}
}
