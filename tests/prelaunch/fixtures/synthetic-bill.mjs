export const BILL_HEADER=['交易时间','公众账号ID','商户号','特约商户号','设备号','微信订单号','商户订单号','用户标识','交易类型','交易状态','付款银行','货币种类','应结订单金额','代金券金额','微信退款单号','商户退款单号','退款金额','充值券退款金额','退款类型','退款状态','商品名称','商户数据包','手续费','费率','订单金额','申请退款金额','费率备注'];
export const BILL_SUMMARY=['总交易单数','应结订单总金额','退款总金额','充值券退款总金额','手续费总金额','订单总金额','申请退款总金额'];
const money=value=>(value/100).toFixed(2);
export function syntheticBill(date,records,merchantId='synthetic-mch'){
 const rows=records.map((record,index)=>{
  const row=Array(27).fill('');row[0]=date+' 10:00:00';row[1]=record.appId??'synthetic-app';row[2]=merchantId;row[3]='0';row[5]=record.tradeNo??'synthetic-trade-'+index;row[6]=record.orderNo??'synthetic-order-'+index;row[7]='synthetic-user-not-exported';row[8]='JSAPI';row[9]=record.kind==='REFUND'?'REFUND':'SUCCESS';row[10]='OTHERS';row[11]='CNY';
  row[12]=money(record.kind==='REFUND'?0:record.amountCents);row[13]='0.00';row[14]=record.refundNo??'0';row[15]=record.merchantRefundNo??'0';row[16]=money(record.kind==='REFUND'?(record.refundCashCents??record.amountCents):0);row[17]='0.00';row[18]=record.kind==='REFUND'?'ORIGINAL':'';row[19]=record.kind==='REFUND'?'SUCCESS':'';row[20]=record.product??'合成菜单';row[22]='0.00000';row[23]='0.00%';row[24]=money(record.kind==='REFUND'?0:record.amountCents);row[25]=money(record.kind==='REFUND'?record.amountCents:0);return row;
 });
 const footer=[String(rows.length),...([12,16,17,22,24,25].map(column=>rows.reduce((sum,row)=>sum+Math.round(Number(row[column])*100),0)/100)).map(x=>x.toFixed(2))];
 const cell=value=>'`'+value;const quote=value=>/[",\n]/.test(value)?'"'+value.replaceAll('"','""')+'"':value;
 return Buffer.from('\uFEFF'+BILL_HEADER.join(',')+'\r\n'+rows.map(row=>row.map(value=>quote(cell(value))).join(',')).join('\r\n')+(rows.length?'\r\n':'')+BILL_SUMMARY.join(',')+'\r\n'+footer.map(cell).join(',')+'\r\n');
}
