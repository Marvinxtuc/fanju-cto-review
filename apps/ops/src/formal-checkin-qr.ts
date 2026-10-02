import qrcode from 'qrcode-generator';
/** Local image encoding only; never interpret the signed payload as HTML or a URL. */
export function createFormalCheckinQr(token:string):string {
 if(token.length>5000||!/^FJCI1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/.test(token))throw Error('签到码格式无效');
 const qr=qrcode(0,'M');qr.addData(token,'Byte');qr.make();
 return qr.createDataURL(5,20);
}
