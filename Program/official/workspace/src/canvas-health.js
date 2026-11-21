// Sample only a visible, restored canvas. Hidden time is not renderer lag.
export function createCanvasHealth({send,now=()=>performance.now(),schedule=setInterval,cancel=clearInterval,heap=()=>undefined}) {
    let timer=null,ready=false,visible=false,closed=false,previous=0,started=0,samples=0,maxGapMs=0;
    const reset=()=>{previous=started=now();samples=0;maxGapMs=0;};
    function reconcile(){
        if(timer!==null){cancel(timer);timer=null;}
        reset();
        if(closed||!ready||!visible)return;
        timer=schedule(()=>{
            const current=now();maxGapMs=Math.max(maxGapMs,current-previous);previous=current;samples++;
            if(current-started>=30000||maxGapMs>=2500){
                try{send('heartbeat',{durationMs:current-started,samples,maxGapMs,heapMB:heap()});}catch{/* Observation cannot stop the canvas. */}
                reset();
            }
        },1000);
    }
    return {
        ready(){if(ready||closed)return;ready=true;reconcile();},
        visible(value){value=value===true;if(visible===value)return;visible=value;reconcile();},
        close(){closed=true;reconcile();}
    };
}
