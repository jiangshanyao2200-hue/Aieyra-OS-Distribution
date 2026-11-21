// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: PAGE_WINDOW; pageNumbers
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/pagination.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Ten consecutive numbered pages let the reader jump directly (1–10 first,
// then a sliding window); an undiscovered catalogue tail is never invented.
export const PAGE_WINDOW=10;
export function pageNumbers(current,count){
 if(count<1)return [];
 const length=Math.min(PAGE_WINDOW,count),start=Math.min(Math.max(1,current-Math.floor((PAGE_WINDOW-1)/2)),count-length+1);
 return Array.from({length},(_,index)=>start+index);
}
