import { AsyncLocalStorage } from 'node:async_hooks';

export interface WorkspaceContext {
  authUserId: string;
  schemaName: string;
  workspaceId: string;
}

const storage = new AsyncLocalStorage<WorkspaceContext>();

export function enterWorkspaceContext(context: WorkspaceContext): void {
  storage.enterWith(context);
}

export function runWithWorkspaceContext(context: WorkspaceContext, callback: () => void): void {
  storage.run(context, callback);
}

export function getWorkspaceContext(): WorkspaceContext | undefined {
  return storage.getStore();
}

export function assertWorkspaceSchemaName(schemaName: string): string {
  if (schemaName === 'public' || /^workspace_[a-f0-9]{32}$/.test(schemaName)) {
    return schemaName;
  }
  throw new Error('AUTH_WORKSPACE_INVALID');
}
