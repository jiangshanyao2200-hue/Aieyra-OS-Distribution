// Persist the same bounded media references in renderer and storage. Preview
// URLs are derived from asset IDs, never restored as arbitrary remote URLs.
export function sanitizeVideoNode(value) {
  if (!value || typeof value !== 'object') return undefined;
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  let asset, timeline;
  const a = value.asset, t = value.timeline;
  if (a && id(a.id) && finite(a.duration) && a.duration > 0 && a.duration <= 21600 && finite(a.width) && finite(a.height)) {
    asset = {id:a.id, name:String(a.name || '视频').slice(0,240), src:'iiimage-asset://local/media/'+a.id,
      duration:a.duration, width:a.width, height:a.height, codec:String(a.codec || '').slice(0,40)};
  }
  if (t && id(t.id) && Number.isInteger(t.revision) && t.revision > 0 && Array.isArray(t.clips) && t.clips.length <= 30 &&
      t.clips.every(c=>c && id(c.assetId) && finite(c.start) && finite(c.end) && c.start >= 0 && c.end > c.start && c.end <= 21600) &&
      [[1280,720],[1920,1080],[720,1280],[1080,1920]].some(([w,h])=>t.width===w && t.height===h) && [24,30].includes(t.fps)) {
    timeline = {id:t.id,revision:t.revision,name:String(t.name || '视频剪辑').slice(0,120),
      clips:t.clips.map(c=>({assetId:c.assetId,start:c.start,end:c.end})),width:t.width,height:t.height,fps:t.fps};
  }
  return asset || timeline ? {asset,timeline} : undefined;
}
