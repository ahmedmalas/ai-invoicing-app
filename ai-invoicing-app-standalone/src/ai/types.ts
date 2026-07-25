import type { z } from 'zod';

import type { AppDatabase } from '../db/database.js';

/** Risk / confirmation policy for a registered Aleya action. */
export type ConfirmationPolicy = 'none' | 'required';

/** Whether undo/rollback is supported for this action. */
export type UndoSupport = 'none' | 'snapshot' | 'compensating';

export type ToolCategory =
  | 'invoices'
  | 'customers'
  | 'templates'
  | 'profile'
  | 'payments'
  | 'search'
  | 'pdf'
  | 'email'
  | 'bulk'
  | 'diagnostics'
  | 'meta'
  | 'undo';

export type ToolSensitivity = 'low' | 'medium' | 'high';
export type ToolLatencyClass = 'fast' | 'standard' | 'slow';

export interface UiSyncInstruction {
  refresh?: Array<'invoices' | 'customers' | 'templates' | 'profile' | 'payments' | 'search'>;
  openRoute?: string | null;
  focusInvoiceId?: string | null;
  focusCustomerId?: string | null;
}

export interface ToolSuccess<T = unknown> {
  ok: true;
  data: T;
  summary: string;
  ui?: UiSyncInstruction;
  decisions?: string[];
}

export interface ToolFailure {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
  needsConfirmation?: boolean;
  confirmationToken?: string;
  confirmationSummary?: string;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

export interface AgentVisibleState {
  activeInvoiceId?: string | null;
  activeCustomerId?: string | null;
  activeTemplateId?: string | null;
  currentPath?: string | null;
  selectedInvoiceIds?: string[];
}

export interface PendingConfirmation {
  token: string;
  toolName: string;
  input: unknown;
  summary: string;
  createdAt: string;
  expiresAt: string;
}

export interface UndoEntry {
  id: string;
  toolName: string;
  createdAt: string;
  label: string;
  restore: () => Promise<void>;
}

export interface AleyaToolContext {
  db: AppDatabase;
  userId: string;
  organizationId: string;
  conversationId: string;
  visibleState: AgentVisibleState;
  /** Confirmed tokens for this turn / approved workflow. */
  approvedTokens: Set<string>;
  /** Request confirmation and return token. */
  requestConfirmation: (toolName: string, input: unknown, summary: string) => PendingConfirmation;
  /** Push undo snapshot. */
  pushUndo: (entry: Omit<UndoEntry, 'id' | 'createdAt'> & { id?: string }) => Promise<string>;
  /** Pop and run most recent undo. */
  undoLast: () => Promise<ToolResult>;
  logAudit: (event: string, payload: Record<string, unknown>) => Promise<void>;
  now: () => Date;
}

export interface AleyaToolDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: TInput;
  confirmation: ConfirmationPolicy;
  undo: UndoSupport;
  /** Milestone label for capability matrix (e.g. "M1"). */
  milestone: string;
  /** Capability domain for routing (e.g. banking, invoices). */
  domain?: string;
  /** Intents this tool is appropriate for. */
  intents?: string[];
  /** Privacy sensitivity of typical outputs. */
  sensitivity?: ToolSensitivity;
  /** Expected latency class. */
  latencyClass?: ToolLatencyClass;
  /** Whether the tool mutates application data. */
  mutates?: boolean;
  /** Status questions this tool can answer conclusively. */
  conclusiveFor?: string[];
  /** Required permission hint for matrix/docs. */
  requiredPermission?: string;
  execute: (input: z.infer<TInput>, ctx: AleyaToolContext) => Promise<ToolResult>;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
  createdAt?: string;
}

export interface ConversationRecord {
  id: string;
  userId: string;
  title: string;
  messages: ChatMessage[];
  pendingConfirmation?: PendingConfirmation | null;
  createdAt: string;
  updatedAt: string;
  visibleState?: AgentVisibleState;
}
