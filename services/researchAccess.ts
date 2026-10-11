let accessKey = '';
/** Kept in memory only; never bundled, persisted, or sent to the model provider. */
export function researchHeaders(): Record<string, string> {
  if (!accessKey) throw new Error('Enter your research access key before starting paid research.');
  return { 'Content-Type': 'application/json', 'x-research-key': accessKey };
}
export function setResearchAccess(value: string) { accessKey = value.trim(); }
export function getResearchAccess() { return accessKey; }
export function resetResearchAccess() { accessKey = ''; }
