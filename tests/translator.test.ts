import test from 'node:test';
import assert from 'node:assert/strict';
import { Translator, parseTranslations, validateInput, MODEL, API_URL } from '../src/translator';

const entries = [{id:'0',text:'Introduction'},{id:'1',text:'Methods'},{id:'1.0',text:'Finite Element Model'}];
const result = JSON.stringify({translations:[{id:'1.0',zh:'有限元模型'},{id:'0',zh:'引言'},{id:'1',zh:'方法'}]});
const prefs = {get: (_:string, fallback:any) => fallback === '' ? 'unit-test-token' : fallback, set:()=>{}};

test('maps reordered responses to complete original paths, retaining source text',()=>{
  assert.deepEqual(parseTranslations(result,entries).map(x=>[x.id,x.text,x.zh]),[
    ['0','Introduction','引言'],['1','Methods','方法'],['1.0','Finite Element Model','有限元模型']
  ]);
});
test('rejects missing, duplicate, alien, empty and truncated results',()=>{
  for(const value of ['', '{', '{}', JSON.stringify({translations:[]}),
    JSON.stringify({translations:[{id:'0',zh:'引言'},{id:'0',zh:'方法'},{id:'1.0',zh:'模型'}]}),
    JSON.stringify({translations:[{id:'x',zh:'引言'},{id:'1',zh:'方法'},{id:'1.0',zh:'模型'}]}),
    JSON.stringify({translations:[{id:'0',zh:'引言'},{id:'1',zh:''},{id:'1.0',zh:'模型'}]})]) {
    assert.throws(()=>parseTranslations(value,entries));
  }
});
test('rejects malformed or excessively large input before any network request',()=>{
  assert.throws(()=>validateInput([]));
  assert.throws(()=>validateInput([{id:'0',text:'A'},{id:'0',text:'B'}]));
  assert.throws(()=>validateInput([{id:'0',text:'a'.repeat(60001)}]));
});
test('requests only title and outline at fixed HTTPS endpoint, no implicit retry',async()=>{
  const calls:any[]=[];
  const t=new Translator({HTTP:{request:async(...args:any[])=>{calls.push(args);return{status:200,response:{choices:[{finish_reason:'stop',message:{content:result}}]}};}}},prefs);
  const output=await t.translate('Academic paper',entries);
  assert.equal(output.length,3); assert.equal(calls.length,1);
  const [method,url,options]=calls[0];
  assert.equal(method,'POST'); assert.equal(url,API_URL);
  assert.equal(options.logBodyLength,0); assert.equal(options.successCodes,false);
  const body=JSON.parse(options.body); assert.equal(body.model,MODEL);
  assert.equal(body.thinking.type,'disabled');
  const data=JSON.parse(body.messages[1].content);
  assert.deepEqual(Object.keys(data).sort(),['outline','paperTitle']);
  assert.equal(data.outline[2].parentId,'1');
  assert.equal(options.body.includes('unit-test-token'),false);
});
test('missing key and shutdown never send requests',async()=>{
  let n=0; const Z={HTTP:{request:async()=>{n++;}}};
  const t=new Translator(Z,{get:(_:string,f:any)=>f,set:()=>{}});
  await assert.rejects(t.translate('',entries),/API Key/);
  t.close(); await assert.rejects(t.translate('',entries),/停止/); assert.equal(n,0);
});
test('sanitizes transport and status errors without repeating headers or body',async()=>{
  for(const status of [401,402,429,500,400,0]) {
    const t=new Translator({HTTP:{request:async()=>{throw {status,message:'unit-test-token secret body'};}}},prefs);
    await assert.rejects(t.translate('',entries),(e:any)=>!e.message.includes('unit-test-token')&&!e.message.includes('secret'));
  }
});
test('truncation is rejected even if JSON happens to parse',async()=>{
  const t=new Translator({HTTP:{request:async()=>({status:200,response:{choices:[{finish_reason:'length',message:{content:result}}]}})}},prefs);
  await assert.rejects(t.translate('',entries),/完整/);
});
test('shutdown cancels in-flight request and rejects its result',async()=>{
  let cancelled=false; let reject:any;
  const t=new Translator({HTTP:{request:async(_:any,__:any,o:any)=>{
    return new Promise((resolve,rej)=>{reject=rej;o.cancellerReceiver(()=>{cancelled=true;rej(new Error('cancel'));});});
  }}},prefs);
  const p=t.translate('',entries); t.close();
  await assert.rejects(p,/取消/); assert.equal(cancelled,true); assert.ok(reject);
});
