import { readFileSync } from 'node:fs';
const schema = JSON.parse(readFileSync(new URL('../zodiac/prediction_schema.json', import.meta.url), 'utf8'));

// Validator for the exact keywords in the supplied 0.1.0 schema. Unsupported
// keywords fail closed so a future contract cannot silently bypass validation.
const keywords = new Set(['$schema', '$id', '$ref', '$defs', 'title', 'description', 'type', 'properties', 'required', 'additionalProperties',
  'items', 'minItems', 'uniqueItems', 'minLength', 'minimum', 'maximum', 'exclusiveMinimum', 'format', 'pattern', 'enum', 'const', 'allOf', 'oneOf', 'if', 'then', 'else']);
function matchesType(value: unknown, type: string): boolean {
  if (type === 'null') return value === null;
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}
function check(value: any, node: any, path: string, errors: string[]): void {
  for (const key of Object.keys(node)) if (!keywords.has(key)) errors.push(`${path}: unsupported schema keyword ${key}`);
  if (node.$ref) {
    const definition = node.$ref.startsWith('#/$defs/') ? schema.$defs[node.$ref.slice(8)] : null;
    if (!definition) errors.push(`${path}: unresolved schema reference`);
    else check(value, definition, path, errors);
  }
  if (node.type && !(Array.isArray(node.type) ? node.type : [node.type]).some((t: string) => matchesType(value, t))) errors.push(`${path}: invalid type`);
  if ('const' in node && JSON.stringify(value) !== JSON.stringify(node.const)) errors.push(`${path}: invalid constant`);
  if (node.enum && !node.enum.some((entry: any) => JSON.stringify(entry) === JSON.stringify(value))) errors.push(`${path}: invalid enum`);
  if (typeof value === 'string') {
    if (node.minLength && value.length < node.minLength) errors.push(`${path}: empty string`);
    if (node.pattern && !new RegExp(node.pattern).test(value)) errors.push(`${path}: invalid pattern`);
    if (node.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) errors.push(`${path}: invalid date`);
    if (node.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value.slice(0,10))) errors.push(`${path}: invalid UTC timestamp`);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (node.minimum != null && value < node.minimum) || (node.maximum != null && value > node.maximum) || (node.exclusiveMinimum != null && value <= node.exclusiveMinimum)) errors.push(`${path}: number out of range`);
  }
  if (Array.isArray(value)) {
    if (node.minItems && value.length < node.minItems) errors.push(`${path}: too few items`);
    if (node.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push(`${path}: duplicate items`);
    if (node.items) value.forEach((item, i) => check(item, node.items, `${path}[${i}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of node.required || []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (node.properties?.[key]) check(item, node.properties[key], `${path}.${key}`, errors);
      else if (node.additionalProperties === false) errors.push(`${path}.${key}: undeclared property`);
    }
  }
  for (const branch of node.allOf || []) check(value, branch, path, errors);
  if (node.oneOf) {
    const count = node.oneOf.filter((branch: any) => { const e: string[] = []; check(value, branch, path, e); return e.length === 0; }).length;
    if (count !== 1) errors.push(`${path}: must match exactly one branch`);
  }
  if (node.if) {
    const e: string[] = []; check(value, node.if, path, e);
    const branch = e.length === 0 ? node.then : node.else;
    if (branch) check(value, branch, path, errors);
  }
}

export interface PublicationEvidence {
  rules: Array<{ rule_id: string; version: string; method_id?: string; validation_status?: string; provenance_category?: string; attribution_confidence?: string }>;
  subjectIds: string[];
  // Must be supplied by trusted backend artifacts, never by the request body.
  model?: { model_id: string; model_version: string; manifest_version: string; inference_id: string;
    probability: number; feature_ids: string[]; fitting_cutoff_utc: string };
  baselineModel?: PublicationEvidence['model'];
}
export function validateZodiacRecord(record: any, evidence: PublicationEvidence): string[] {
  const errors: string[] = [];
  check(record, schema, 'record', errors);
  if (errors.length) return errors;
  const sources = record.sources.map((s: any) => s.source_id);
  if (new Set(sources).size !== sources.length) errors.push('Source identifiers must be unique.');
  const sourceRefs = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'source_ids' && Array.isArray(item)) {
        for (const id of item) if (!sources.includes(id)) errors.push(`Unresolved source ${id}.`);
      } else if (key === 'report_source_id' && !sources.includes(item)) errors.push(`Unresolved evaluation source ${item}.`);
      if (item && typeof item === 'object') sourceRefs(item);
    }
  };
  sourceRefs(record);
  const p = record.prediction;
  const cutoff = Date.parse(record.timing.information_cutoff_utc);
  const asOf = Date.parse(record.timing.prediction_as_of_utc);
  const kickoff = Date.parse(record.event.scheduled_start_utc);
  const participants = record.event.participants.map((p: any) => p.participant_id);
  if (new Set(participants).size !== participants.length) errors.push('Participant identifiers must be unique.');
  if (record.target.type === 'win' && !participants.includes(record.target.selection)) errors.push('Win selection must resolve to a participant.');
  for (const observation of record.symbolic_observations) {
    const rule = evidence.rules.find(rule => rule.rule_id === observation.rule_id && rule.version === observation.rule_version);
    if (!rule) errors.push(`Unregistered rule ${observation.rule_id}.`);
    else {
      for (const key of ['validation_status','provenance_category','attribution_confidence']) if (rule[key] && rule[key] !== observation[key]) errors.push(`Observation contradicts registry ${key}.`);
      if (observation.calculation && rule.method_id && rule.method_id !== observation.calculation.method_id) errors.push('Calculation method contradicts registry.');
    }
    if (observation.calculation && observation.calculation.input_snapshot_id !== record.data_quality.snapshot_id) errors.push('Calculation snapshot does not match record snapshot.');
    if (!observation.subject_ids.every((id: string) => evidence.subjectIds.includes(id))) errors.push('Unresolved observation subject.');
    if (observation.used_in_published_probability && (!evidence.model?.feature_ids.includes(observation.feature_id) || Date.parse(observation.calculation?.available_at_utc) > cutoff)) errors.push('Symbolic input outside manifest or cutoff.');
  }
  if (p.baseline_probability !== null && !record.model_metadata.baseline) errors.push('Baseline probability requires model metadata.');
  if (p.approved_hybrid_probability !== null && record.model_metadata.hybrid?.approval_status !== 'approved_for_prediction') errors.push('Hybrid output is unapproved.');
  if (p.published_probability !== null) {
    const metadata = p.published_model === 'sports_baseline' ? record.model_metadata.baseline : record.model_metadata.hybrid;
    const output = p.published_model === 'sports_baseline' ? p.baseline_probability : p.approved_hybrid_probability;
    if (p.published_probability !== output) errors.push('Published probability does not equal selected output.');
    if (!evidence.model || evidence.model.probability !== output || ['model_id','model_version','manifest_version','inference_id'].some(key => evidence.model?.[key] !== metadata?.[key])) errors.push('Publication lacks matching backend inference and manifest.');
    if (record.data_quality.cutoff_check_status !== 'passed' || record.data_quality.identity_check_status !== 'passed') errors.push('Publication requires passed cutoff and identity checks.');
    if (!(cutoff <= asOf && asOf < kickoff) || Date.parse(metadata.training_data_cutoff_utc) > cutoff || !evidence.model?.fitting_cutoff_utc || Date.parse(evidence.model.fitting_cutoff_utc) > cutoff) errors.push('Publication chronology failed.');
    if (p.published_model === 'approved_hybrid') {
      const baseline = record.model_metadata.baseline;
      if (Date.parse(baseline.training_data_cutoff_utc) > cutoff || !evidence.baselineModel || evidence.baselineModel.probability !== p.baseline_probability || Date.parse(evidence.baselineModel.fitting_cutoff_utc) > cutoff
        || ['model_id','model_version','manifest_version','inference_id'].some(key => evidence.baselineModel?.[key] !== baseline[key])) errors.push('Hybrid publication lacks an eligible matching baseline inference.');
    }
    if (record.symbolic_observations.some((o: any) => o.used_in_published_probability && o.calculation?.calendar_convention !== 'not_applicable') && record.data_quality.calendar_check_status !== 'passed') errors.push('Calendar checks required for used features.');
    if (record.sports_factors.some((f: any) => f.used_in_published_probability && (!evidence.model?.feature_ids.includes(f.feature_id) || !f.available_at_utc || Date.parse(f.available_at_utc) > cutoff))) errors.push('Sports input outside manifest or cutoff.');
  }
  if (record.mode === 'historical_audit' && !record.historical_audit.original_record_available && [record.historical_audit.original_record_id, record.historical_audit.original_prediction_timestamp_utc, record.historical_audit.original_information_cutoff_utc, p.published_probability].some(v => v !== null)) errors.push('Missing original forecast cannot have invented identifiers, timing or probability.');
  if (record.betting_analysis && (p.published_probability === null || record.betting_analysis.probability_used !== p.published_probability || record.betting_analysis.target_id !== record.target.target_id || Date.parse(record.betting_analysis.price_timestamp_utc) > cutoff)) errors.push('Betting target, timing or probability mismatch.');
  return errors;
}
