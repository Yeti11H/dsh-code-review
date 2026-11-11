export interface ReviewContext {
  requirement: string;
  businessRules: string[];
  outOfScope: string[];
}

export interface CodeLocation {
  file: string;
  lineRange: [number, number];
  side?: 'before' | 'after';
}

export interface Evidence extends CodeLocation { quote: string }
export interface FileChange {
  file: string;
  status: string;
  diff: string;
  linesChanged: number;
}

export interface ChangeSnapshot {
  hash: string;
  timestamp: number;
  target: string;
  base: string;
  head: string;
  files: FileChange[];
  sources: Record<string, string>;
  before: Record<string, string>;
  omissions: string[];
}

export interface Finding {
  id: string;
  location: CodeLocation;
  description: string;
  reasoning: string;
  verification_points: string[];
  business_dependent: boolean;
}

export interface VerifiedIssue {
  id: string;
  fingerprint: string;
  title: string;
  status: 'open' | 'resolved' | 'wont_fix';
  verdict: 'confirmed' | 'false_positive' | 'needs_check';
  location: CodeLocation;
  trigger_condition: string;
  error_process: string;
  actual_impact: string;
  code_evidence: Evidence[];
  verification_status: 'code_analysis_only' | 'executed_test' | 'needs_manual_check';
  verification_method: string;
  suggested_fix: string;
  category: 'correctness' | 'performance' | 'security' | 'maintainability';
  priority: 'high' | 'medium' | 'low';
  optional: boolean;
  origin: 'introduced' | 'pre_existing' | 'unknown';
  rationale: string;
  dependencies: string[];
  business_dependent: boolean;
  firstSeenRound: number;
  lastSeenRound: number;
}

export interface TestCommand { file: string; args: string[] }
export interface TestResult extends TestCommand {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timestamp: number;
  codeHash: string;
}

export interface ModelRequest {
  phase: 'scan' | 'verify';
  system: string;
  prompt: string;
}

export interface ModelCall extends ModelRequest {
  id: string;
  timestamp: number;
  response?: string;
  error?: string;
}

export interface ModelClient {
  complete(request: ModelRequest, signal?: AbortSignal): Promise<string>;
}

export interface ReviewRound {
  roundNumber: number;
  timestamp: number;
  codeHash: string;
  snapshot: ChangeSnapshot;
  issues: VerifiedIssue[];
  newIssuesCount: number;
  resolvedIssuesCount: number;
  coverage: { files: string[]; omissions: string[]; notes: string[] };
  tests: TestResult[];
  changes: { resolved: string[]; newIssues: string[]; unchanged: string[] };
}

export interface ReviewSession {
  schemaVersion: 1;
  id: string;
  repository: string;
  snapshot: ChangeSnapshot;
  context: ReviewContext;
  rounds: ReviewRound[];
  calls: ModelCall[];
  status: 'in_progress' | 'completed' | 'needs_human' | 'failed' | 'cancelled';
  stale: boolean;
  error?: string;
  createdAt: number;
}

export interface ReviewOptions {
  maxChangedLines?: number;
  maxFileBytes?: number;
  maxSnapshotBytes?: number;
  maxSourceFiles?: number;
  maxPromptChars?: number;
  maxCandidates?: number;
  modelTimeoutMs?: number;
  testTimeoutMs?: number;
  testCommands?: TestCommand[];
}

export interface ReviewResult {
  sessionId: string;
  status: ReviewSession['status'];
  reportPath: string;
  confirmedIssues: number;
  needsCheck: number;
  optionalSuggestions: number;
  message: string;
  report: string;
}
