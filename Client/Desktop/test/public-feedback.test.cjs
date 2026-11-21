// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/public-feedback.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createCommunityClient}=require('../host/community.cjs');
const {createForumSync}=require('../host/forum-sync.cjs');
test('public bug and likes use signed exact payloads, never import private feedback',async()=>{
 const token='a'.repeat(43),origin='https://osupdate.aieyra.cn',sent=[];let publicKey;
 const client=createCommunityClient({fetchImpl:async(url,options)=>{const route=new URL(url).pathname;
  if(route.endsWith('/start')){publicKey=JSON.parse(options.body).publicKey;return Response.json({flow:'fixture',authorizationUrl:'https://api.aieyra.cn/aieyra/os/authorize?flow=fixture'});}
  if(route.endsWith('/exchange'))return Response.json({accessToken:token,expiresAt:Date.now()+3600000,user:{id:'u'}});
  if(route.endsWith('/logout'))return Response.json({ok:true});sent.push({route,options});return Response.json({ok:true,item:{id:'public-topic'},liked:true});
 }});
 try{
  await assert.rejects(()=>client.call({action:'topic_like',id:'p',liked:true}),/登录/);
  await client.connect({id:'u'},{fetch:async()=>Response.json({callbackUrl:origin+'/auth/desktop-callback?state=fixture&code=fake'})});
  await assert.rejects(()=>client.call({action:'topic_publish',type:'bug'}),/公开/);
  await client.call({action:'topic_publish',type:'bug',request_id:'request-one',confirmed:true,title:'公开问题',summary:'公开最小复现',content:'打开应用，观察结果。',raw_logs:'MUST_NOT_LEAVE',private_files:['MUST_NOT_LEAVE']});
  await client.call({action:'topic_like',id:'public-topic',liked:true,request_id:'like-one'});
  await assert.rejects(()=>client.call({action:'import_feedback',confirmed:true}),/不自动公开/);
  await assert.rejects(()=>client.call({action:'topic_like',id:'public-topic'}),/liked/);
  assert.equal(sent.length,2);assert.equal(sent[0].route,'/api/v1/matrix/topics');assert.equal(sent[1].route,'/api/v1/matrix/topics/public-topic/likes');
  assert.equal(JSON.parse(sent[0].options.body).publication,'public');assert.ok(!sent[0].options.body.includes('MUST_NOT_LEAVE'));
  const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
  for(const {route,options} of sent){const h=options.headers;assert.equal(crypto.verify(null,Buffer.from(['aieyra-os-proof-v2',digest(token),'POST',route,h['x-os-time'],h['x-os-nonce'],digest(options.body)].join('\n')),publicKey,Buffer.from(h['x-os-signature'],'base64url')),true);}
  const sync=createForumSync({client});try{assert.throws(()=>sync.authorize({action:'topic_like'}),/只读/);sync.authorize({action:'topic_like',confirmed:true});}finally{sync.close();}
 }finally{client.close();}
});
