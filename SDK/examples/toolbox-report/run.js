if(args.values.length>10000)throw Error('At most 10000 values');
if(!args.values.every(Number.isFinite))throw Error('All values must be finite');
if(!/^[a-zA-Z0-9_-]{1,64}\.json$/.test(args.file))throw Error('file must be a simple JSON filename');
const rows=[{metric:'count',value:args.values.length},{metric:'sum',value:args.values.reduce((a,b)=>a+b,0)}];
const body=JSON.stringify(rows,null,2)+'\n';
const result=await tools.apply_patch({workdir:args.workdir,patch:'*** Begin Patch\n*** Add File: '+args.file+'\n'+body.trimEnd().split('\n').map(s=>'+'+s).join('\n')+'\n*** End Patch',description:'写入统计报告'});
if(!result.ok)throw Error(JSON.stringify(result));
text({file:args.file,workdir:args.workdir});
return rows;
