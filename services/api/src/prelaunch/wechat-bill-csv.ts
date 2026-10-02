export interface BillObservation {
 kind:'PAYMENT'|'REFUND';merchantOrderNo:string;channelTradeNo:string;
 merchantRefundNo?:string;channelRefundNo?:string;amountCents:number;observedAt:string;inApplicationScope:boolean;
}
const headers=['交易时间','公众账号ID','商户号','特约商户号','设备号','微信订单号','商户订单号','用户标识','交易类型','交易状态','付款银行','货币种类','应结订单金额','代金券金额','微信退款单号','商户退款单号','退款金额','充值券退款金额','退款类型','退款状态','商品名称','商户数据包','手续费','费率','订单金额','申请退款金额','费率备注'];
const summaryHeaders=['总交易单数','应结订单总金额','退款总金额','充值券退款总金额','手续费总金额','订单总金额','申请退款总金额'];
function fail():never{throw Error('Unsupported or inconsistent trade-bill CSV');}
function csv(raw:Buffer){
 if(raw.length>32*1024*1024||raw.length===0)fail();
 const text=raw.toString('utf8');if(!Buffer.from(text).equals(raw))fail();
 const source=text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 const cell=()=>{row.push(field.startsWith('`')?field.slice(1):field);field='';closed=false;};
 const line=()=>{cell();rows.push(row);row=[];if(rows.length>100003)fail();};
 for(let n=0;n<source.length;n++){
  const char=source[n]!;
  if(quoted){if(char==='"'){if(source[n+1]==='"'){field+='"';n++;}else{quoted=false;closed=true;}}else field+=char;continue;}
  if(char==='\r')fail();
  if(char==='"'){if(field||closed)fail();quoted=true;continue;}
  if(char===','){cell();continue;}if(char==='\n'){line();continue;}
  if(closed)fail();field+=char;
 }
 if(quoted)fail();if(field||row.length||closed)line();return rows;
}
function scaled(value:string,precision:number){
 if(!new RegExp('^\\d+(?:\\.\\d{1,'+precision+'})?$').test(value))fail();
 const [whole,fraction='']=value.split('.');const amount=BigInt(whole!)*10n**BigInt(precision)+BigInt(fraction.padEnd(precision,'0'));
 if(amount>BigInt(Number.MAX_SAFE_INTEGER))fail();return amount;
}
function reference(value:string){if(!/^[A-Za-z0-9_.:-]{1,160}$/.test(value)||value==='0')fail();return value;}
function observedAt(value:string,date:string){
 if(!new RegExp('^'+date+' \\d{2}:\\d{2}:\\d{2}$').test(value))fail();
 const at=new Date(value.replace(' ','T')+'+08:00');if(!Number.isFinite(at.getTime())||new Date(at.getTime()+8*3600000).toISOString().slice(0,19)!==value.replace(' ','T'))fail();return at.toISOString();
}
// Pure format/summation validation only: no trust, coverage, receipt or refund authority.
// Enumerates every row, including other apps on the same direct merchant.
export function parseWechatAllBill(raw:Buffer,expected:{billDate:string;merchantId:string;appId:string}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(expected.billDate)||!expected.merchantId||!expected.appId)fail();
 const rows=csv(raw);if(rows.length<3)fail();
 const header=rows[0]!;if(header[3]==='子商户号')header[3]='特约商户号';
 if(JSON.stringify(header)!==JSON.stringify(headers)||JSON.stringify(rows.at(-2))!==JSON.stringify(summaryHeaders))fail();
 const footer=rows.at(-1)!;if(footer.length!==7||!/^\d+(?:\.0+)?$/.test(footer[0]!))fail();
 const count=Number(footer[0]);if(!Number.isSafeInteger(count)||count!==rows.length-3)fail();
 const totals=[0n,0n,0n,0n,0n,0n];const columns=[12,16,17,22,24,25];
 const observations:BillObservation[]=[];const keys=new Set<string>();let outside=0;
 for(const row of rows.slice(1,-2)){
  if(row.length!==27||row[2]!==expected.merchantId||!['','0'].includes(row[3]!)||row[11]!=='CNY')fail();
  for(const [index,column] of columns.entries())totals[index]=totals[index]!+scaled(row[column]!,column===22?5:2);
  scaled(row[13]!,2); // Validate coupon money without changing gross amount semantics.
  const merchantOrderNo=reference(row[6]!),channelTradeNo=reference(row[5]!);
  const base={merchantOrderNo,channelTradeNo,observedAt:observedAt(row[0]!,expected.billDate),inApplicationScope:row[1]===expected.appId};
  if(!row[1])fail();if(!base.inApplicationScope)outside++;
  let observation:BillObservation;
  if(row[9]==='SUCCESS'){
   if(scaled(row[25]!,2)!==0n||scaled(row[16]!,2)!==0n||!['','0'].includes(row[14]!)||!['','0'].includes(row[15]!))fail();
   observation={...base,kind:'PAYMENT',amountCents:Number(scaled(row[24]!,2))};
  }else if(row[9]==='REFUND'&&row[19]==='SUCCESS'){
   observation={...base,kind:'REFUND',merchantRefundNo:reference(row[15]!),channelRefundNo:reference(row[14]!),amountCents:Number(scaled(row[25]!,2))};
  }else fail();
  if(observation.amountCents<=0||observation.amountCents>2147483647)fail();
  const rowKey=observation.kind+':'+(observation.kind==='PAYMENT'?merchantOrderNo:observation.merchantRefundNo);
  const channelKey=observation.kind+':channel:'+(observation.kind==='PAYMENT'?channelTradeNo:observation.channelRefundNo);
  if(keys.has(rowKey)||keys.has(channelKey))fail();keys.add(rowKey);keys.add(channelKey);observations.push(observation);
 }
 for(let n=0;n<6;n++)if(totals[n]!==scaled(footer[n+1]!,n===3?5:2))fail();
 return {format:'WECHAT_ALL_27_COLUMNS' as const,billDate:expected.billDate,totalRows:count,outsideApplicationRows:outside,observations,
  coverageState:'INCOMPLETE' as const,scope:'CSV_FORMAT_AND_SUMMARY_ONLY' as const};
}
