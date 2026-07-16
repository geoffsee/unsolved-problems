export interface ActionOptions {
	entrypoint?: string;
	dotenv?: string;
	pre?: string;
	post?: string;
}

export interface ServerConfig {
	actions?: Record<string, ActionOptions>;
}

export interface WorkflowStep {
	id: string;
	name: string;
	uses?: string;
	run?: string;
	with?: Record<string, unknown>;
	env?: Record<string, unknown>;
}

export interface WorkflowJob {
	name: string;
	steps: WorkflowStep[];
}

export interface Workflow {
	id: string;
	path: string;
	name: string;
	crons: string[];
	jobs: Record<string, WorkflowJob>;
}

export interface RunRequest {
	env?: Record<string, string>;
	actions?: Record<string, ActionOptions>;
}
