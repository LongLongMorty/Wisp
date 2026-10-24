import {browser} from 'wxt/browser';
import type {Command} from './protocol.mts';
export async function rpc<T=unknown>(type:Command,payload:Record<string,unknown>={}):Promise<T>{const requestId=crypto.randomUUID();const r=await browser.runtime.sendMessage({version:'0.1',requestId,type,payload});if(!r||r.version!=='0.1'||r.requestId!==requestId||r.type!==type||r.ok!==true)throw new Error(r?.error?.code??'DISCONNECTED');return r.data as T;}
