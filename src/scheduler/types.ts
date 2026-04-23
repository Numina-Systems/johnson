// pattern: Functional Core

export type ScheduledTask = {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;      // what to tell the agent when the task fires
  readonly schedule: string;
  readonly deliverTo?: string;  // Discord channel ID to send output to
  readonly trigger?: string;    // optional TypeScript code — if set, prompt only fires when trigger produces output
  readonly skill?: string;      // skill name whose granted secrets are injected as env vars for the trigger
  readonly createdAt: string;   // ISO timestamp
  readonly enabled: boolean;
};

export type TaskRun = {
  readonly taskId: string;
  readonly startedAt: string;
  readonly output: string;
  readonly success: boolean;
  readonly durationMs: number;
};

export type TaskState = ScheduledTask & {
  readonly lastRun?: TaskRun;
  readonly runCount: number;
};

export type TaskStore = {
  schedule(task: ScheduledTask): void;
  cancel(id: string): boolean;
  list(): Array<TaskState>;
  get(id: string): TaskState | undefined;
  start(): void;
  stop(): void;
};
