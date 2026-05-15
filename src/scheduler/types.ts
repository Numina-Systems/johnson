// pattern: Functional Core

export type ScheduledTask = {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;      // what to tell the agent when the task fires
  readonly schedule: string;
  readonly deliverTo?: string;  // Discord channel ID to send output to
  readonly trigger?: string;    // optional TypeScript code — if set, prompt only fires when trigger produces output
  readonly skill?: string;      // skill name whose granted secrets are injected as env vars for the trigger
  readonly selfDelivery?: boolean; // if true, prompt handles its own delivery (e.g. via notify_discord) — scheduler skips sendDiscord
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

export type TaskUpdate = Partial<Pick<ScheduledTask, 'name' | 'prompt' | 'schedule' | 'deliverTo' | 'trigger' | 'skill' | 'selfDelivery'>>;

export type TaskStore = {
  schedule(task: ScheduledTask): void;
  cancel(id: string): boolean;
  update(id: string, changes: TaskUpdate): boolean;
  list(): Array<TaskState>;
  get(id: string): TaskState | undefined;
  setEnabled(id: string, enabled: boolean): boolean;
  start(): void;
  stop(): Promise<void>;
};
