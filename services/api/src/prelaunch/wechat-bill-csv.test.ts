import {describe,it,expect} from 'vitest';
import {parseWechatAllBill} from './wechat-bill-csv.js';
import {syntheticBill} from '../../../../tests/prelaunch/fixtures/synthetic-bill.mjs';
const date='2026-09-30',expected={billDate:date,merchantId:'synthetic-mch',appId:'synthetic-app'};
const records=[{kind:'PAYMENT',amountCents:100,orderNo:'order-a',tradeNo:'trade-a'},{kind:'REFUND',amountCents:40,refundCashCents:30,orderNo:'order-a',tradeNo:'trade-a',merchantRefundNo:'refund-a',refundNo:'channel-refund-a'}];
describe('ALL CSV strict row and footer accounting',()=>{
 it('keeps gross payment and requested refund separate from net refund settlement',()=>{
  const result=parseWechatAllBill(syntheticBill(date,records),expected);expect(result.totalRows).toBe(2);expect(result.observations.map(x=>x.amountCents)).toEqual([100,40]);expect(result.observations[0].observedAt).toBe('2026-09-30T02:00:00.000Z');expect(JSON.stringify(result)).not.toContain('synthetic-user-not-exported');expect(result.coverageState).toBe('INCOMPLETE');
 });
 it('enumerates other applications rather than quietly dropping their rows',()=>{const result=parseWechatAllBill(syntheticBill(date,[...records,{kind:'PAYMENT',amountCents:20,appId:'other-app'}]),expected);expect(result.totalRows).toBe(3);expect(result.outsideApplicationRows).toBe(1);expect(result.observations).toHaveLength(3);});
 it('accepts quoted descriptions with commas, escaped quotes and newlines without exporting them',()=>{const raw=syntheticBill(date,[{...records[0],product:'合成菜单,"引号"\n第二行'}]);const result=parseWechatAllBill(raw,expected);expect(result.observations).toHaveLength(1);expect(JSON.stringify(result)).not.toContain('第二行');});
 it('rejects truncation, unknown columns, invalid UTF8 and altered totals',()=>{
  const raw=syntheticBill(date,records);for(const value of [raw.subarray(0,raw.length-30),Buffer.from(raw.toString().replace('交易时间','未知列')),Buffer.concat([raw,Buffer.from([255])]),Buffer.from(raw.toString().replace('`2,`1.00,`0.30','`2,`9.00,`0.30'))])expect(()=>parseWechatAllBill(value,expected)).toThrow();
 });
 it('rejects duplicate payment and refund identities even with a matching footer',()=>{for(const repeated of [[records[0],records[0]],[records[1],records[1]]])expect(()=>parseWechatAllBill(syntheticBill(date,repeated),expected)).toThrow();});
 it('rejects another merchant, submerchant, currency, day or unsupported status',()=>{
  const text=syntheticBill(date,records).toString();for(const altered of [text.replaceAll('synthetic-mch','other-mch'),text.replace('`synthetic-mch,`0,','`synthetic-mch,`sub,') ,text.replaceAll('`CNY','`USD'),text.replaceAll('2026-09-30 10:00:00','2026-09-29 10:00:00'),text.replace('`SUCCESS','`CLOSED')])expect(()=>parseWechatAllBill(Buffer.from(altered),expected)).toThrow();
 });
 it('accepts a zero-row footer as a parsed statement while leaving coverage incomplete',()=>{const result=parseWechatAllBill(syntheticBill(date,[]),expected);expect(result.totalRows).toBe(0);expect(result.coverageState).toBe('INCOMPLETE');});
 it('rejects non-integer cents, negative, zero successful amounts and impossible local times',()=>{for(const value of [syntheticBill(date,[{kind:'PAYMENT',amountCents:0}]),Buffer.from(syntheticBill(date,records).toString().replace('`1.00','`1.001')),Buffer.from(syntheticBill(date,records).toString().replace('`1.00','`-1.00')),Buffer.from(syntheticBill(date,records).toString().replace('10:00:00','25:00:00'))])expect(()=>parseWechatAllBill(value,expected)).toThrow();});
});
