import Taro from '@tarojs/taro';
import {formalRequest,ensureAuthenticatedUser,initializeAvailableV11Identity,isCurrentUserSession} from './api';
export type FormalRightKind='ACCESS'|'EXPORT'|'CORRECTION'|'CLOSURE'|'WITHDRAWAL';
export const formalRightLabels={ACCESS:'查阅资料',EXPORT:'申请导出',CORRECTION:'申请更正',CLOSURE:'申请注销',WITHDRAWAL:'申请撤回'} as const;
export interface FormalRightRequest {id:string;kind:FormalRightKind;acceptedAt:string;state:string;referenceRequestId:string|null;scope:'REQUEST_INTAKE_ONLY';actionsApplied:false}
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(value);
export function validateFormalRight(value:any):FormalRightRequest{if(!value||!validId(value.id)||!Object.hasOwn(formalRightLabels,value.kind)||typeof value.acceptedAt!=='string'||!Number.isFinite(Date.parse(value.acceptedAt))||!validId(value.state)||!(value.referenceRequestId===null||validId(value.referenceRequestId))||value.scope!=='REQUEST_INTAKE_ONLY'||value.actionsApplied!==false)throw Error('资料权利请求记录不完整，请重新加载');return value;}
export async function listFormalRights(cursor?:string){const result=await formalRequest<{requests:FormalRightRequest[];nextCursor:string|null}>('/api/v11/formal/rights'+(cursor?'?cursor='+encodeURIComponent(cursor):''));if(!Array.isArray(result.requests)||!(result.nextCursor===null||validId(result.nextCursor)))throw Error('资料权利请求记录不完整，请重新加载');return{requests:result.requests.map(validateFormalRight),nextCursor:result.nextCursor};}
export async function submitFormalRight(kind:FormalRightKind,referenceRequestId?:string){
 const token=await ensureAuthenticatedUser(),identity=await initializeAvailableV11Identity(token);if(!identity)throw Error('资料权利服务暂不可用');
 const key='fanju_formal_right_v1:'+identity.userId+':'+kind+':'+(referenceRequestId??'none');let businessKey=Taro.getStorageSync<string>(key);if(!businessKey){businessKey='right_'+Date.now()+'_'+Math.random().toString(36).slice(2);Taro.setStorageSync(key,businessKey);}
 if(!isCurrentUserSession(token))throw Error('登录状态已改变，请重新加载');const result=await formalRequest<{request:FormalRightRequest}>('/api/v11/formal/rights',{method:'POST',data:{kind,businessKey,...(referenceRequestId?{referenceRequestId}:{})}});return validateFormalRight(result.request);
}
