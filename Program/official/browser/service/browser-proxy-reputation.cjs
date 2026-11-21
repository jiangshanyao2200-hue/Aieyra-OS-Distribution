'use strict';

const {BlockList,isIP}=require('node:net');

function dropListURL(ip){
 const version=isIP(ip);
 if(!version)throw Error('Invalid proxy exit IP');
 return 'https://www.spamhaus.org/drop/drop_v'+version+'.json';
}

function readDropList(body,version){
 const family=version===4?'ipv4':'ipv6',list=new BlockList();
 let count=0,metadata=null;
 for(const line of body.split(/\r?\n/)){
  if(!line.trim())continue;
  const record=JSON.parse(line);
  if(metadata)throw Error('Unexpected records after list metadata');
  if(record?.type==='metadata'){metadata=record;continue;}
  if(typeof record?.cidr!=='string')throw Error('Invalid list item');
  const [address,rawPrefix,...suffix]=record.cidr.split('/');
  if(isIP(address)!==version||!/^\d{1,3}$/.test(rawPrefix||'')||suffix.length)throw Error('Invalid list network');
  list.addSubnet(address,Number(rawPrefix),family);
  count++;
 }
 const now=Math.floor(Date.now()/1000);
 if(!metadata||metadata.records!==count||!count||!Number.isSafeInteger(metadata.timestamp)||
    metadata.timestamp>now+3600||metadata.timestamp<now-7*86400)throw Error('Incomplete or outdated route list');
 return {publishedAt:new Date(metadata.timestamp*1000).toISOString(),has:ip=>isIP(ip)===version&&list.check(ip,family)};
}

module.exports={dropListURL,readDropList};
