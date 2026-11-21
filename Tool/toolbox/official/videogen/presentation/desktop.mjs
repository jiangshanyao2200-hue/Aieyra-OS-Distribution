// Feed the common receipt renderer; all fields are already public projections.
export function videoFacts(data,push){
 push('视频任务',data.request_id);push('状态',data.state);push('模型',data.model);
 if(data.media)push('媒体',`${data.media.width} × ${data.media.height} · ${data.media.duration_seconds} 秒 · ${data.media.codec}`);
 push('文件',data.path);push('后续',data.recovery);
}
