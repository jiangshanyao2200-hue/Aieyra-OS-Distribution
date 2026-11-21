// Image-domain facts feed the host's shared tool cards; no execution or credentials.
export function imageFacts(data,push){
 push('模型',data.model);
 push('图片',Number.isInteger(data.requested)?(data.completed||0)+' / '+data.requested+' 张完成':data.images?.length?data.images.length+' 张':'');
 push('未提交',data.unsubmitted?data.unsubmitted+' 张':'');
 push('状态',data.unknown?'结果待确认，请勿重复提交':data.accounting_error?'图片已保留，用量保存待核对':data.failed?.length?'部分图片未完成':'');
 push('后续',data.recovery);
}
export function imageSections(data,add){
 add('批次',data.batch_id);
 if(Number.isInteger(data.requested))add('进度',(data.completed||0)+' / '+data.requested+' 张完成；'+(data.unsubmitted||0)+' 张未提交'+(data.unknown?'；存在待核对结果':''));
 add('后续',data.recovery);
}
