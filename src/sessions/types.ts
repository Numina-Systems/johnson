export type SessionWithCounts = {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly lastMessageAt: string | null;
};

export type SessionClassification = 'delete' | 'archive' | 'active';

export type ArchiveResult = {
  readonly rkey: string;
  readonly title: string | null;
  readonly messageCount: number;
};

export type PruneResult = {
  readonly deleted: number;
  readonly archived: number;
  readonly details: ReadonlyArray<{
    readonly id: string;
    readonly title: string | null;
    readonly action: 'deleted' | 'archived';
    readonly rkey?: string;
  }>;
};
