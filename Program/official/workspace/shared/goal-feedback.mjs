/** @typedef {{goalId:string,checkpointId:string,objective:string,question:string,outputKey:string,keep:string,change:string,submitted?:boolean,satisfied?:boolean,notesDisabled?:boolean}} GoalFeedbackNote */
export function sanitizeGoalFeedback(value) {
  if (!value || typeof value !== "object") return null;
  if (!/^goal-[a-f0-9-]{36}$/.test(value.goalId || "") || !/^round-[a-f0-9-]{36}$/.test(value.checkpointId || "")) return null;
  const text = (input, max = 4000) => typeof input === "string" ? input.slice(0, max) : "";
  return { goalId: value.goalId, checkpointId: value.checkpointId, objective: text(value.objective),
    question: text(value.question, 1200), outputKey: text(value.outputKey, 16000),
    keep: text(value.keep), change: text(value.change), submitted: value.submitted === true,
    satisfied: value.satisfied === true, notesDisabled: value.notesDisabled === true };
}
