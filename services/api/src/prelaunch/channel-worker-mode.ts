import {createHash} from 'node:crypto';
import type {ChannelBinding} from '../funding/mock-channel.js';
export function channelWorkerMode(mode:string,binding:ChannelBinding){
 if(!['v11-wechat-query','v11-formal-payment-close','v11-formal-hold-expiry','v11-formal-business'].includes(mode)||binding.channel!=='wechat'||!/^[a-f0-9]{64}$/.test(binding.merchantScope)||!binding.providerConfigId.trim())throw Error('Explicit bound worker identity required');
 return `${mode}:${createHash('sha256').update(JSON.stringify([binding.channel,binding.merchantScope,binding.providerConfigId])).digest('hex')}`;
}
