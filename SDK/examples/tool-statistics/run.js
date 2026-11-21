const values=args.values;
if(values.length>10000)throw Error('At most 10000 values');
if(!values.every(Number.isFinite))throw Error('All values must be finite');
const sum=values.reduce((a,b)=>a+b,0);
return {count:values.length,sum,mean:values.length?sum/values.length:null};
