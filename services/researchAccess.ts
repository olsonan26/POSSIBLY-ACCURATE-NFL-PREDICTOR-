let accessKey = '';
/** Kept in memory only; never bundled, persisted, or sent to the model provider. */
export function researchHeaders(): Record<string, string> {
  if (!accessKey) accessKey = window.prompt('Enter your research access key to unlock paid DeepSeek research.')?.trim() || '';
  if (!accessKey) throw new Error('A research access key is required. No paid request was made.');
  return { 'Content-Type': 'application/json', 'x-research-key': accessKey };
}

export function resetResearchAccess() { accessKey = ''; }
