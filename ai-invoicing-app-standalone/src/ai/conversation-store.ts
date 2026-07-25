import { randomUUID } from 'node:crypto';

import type { AppDatabase } from '../db/database.js';
import type { AgentVisibleState, ChatMessage, ConversationRecord, PendingConfirmation } from './types.js';

const PREF_KEY = 'aleya_ai_conversations_v1';

interface ConversationBag {
  conversations: ConversationRecord[];
}

async function readBag(db: AppDatabase): Promise<ConversationBag> {
  const value = (await db.getPreference(PREF_KEY)) as ConversationBag | null;
  if (!value || !Array.isArray(value.conversations)) {
    return { conversations: [] };
  }
  return value;
}

async function writeBag(db: AppDatabase, bag: ConversationBag): Promise<void> {
  // Keep last 40 conversations to bound preference payload size.
  const trimmed = {
    conversations: bag.conversations
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 40)
      .map((item) => ({
        ...item,
        messages: item.messages.slice(-80),
      })),
  };
  await db.upsertPreference(PREF_KEY, trimmed);
}

export async function listConversations(
  db: AppDatabase,
  userId: string,
): Promise<ConversationRecord[]> {
  const bag = await readBag(db);
  return bag.conversations
    .filter((item) => item.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversation(
  db: AppDatabase,
  userId: string,
  conversationId: string,
): Promise<ConversationRecord | null> {
  const bag = await readBag(db);
  return (
    bag.conversations.find((item) => item.id === conversationId && item.userId === userId) || null
  );
}

export async function createConversation(
  db: AppDatabase,
  userId: string,
  title = 'Aleya AI session',
  visibleState: AgentVisibleState = {},
): Promise<ConversationRecord> {
  const now = new Date().toISOString();
  const record: ConversationRecord = {
    id: randomUUID(),
    userId,
    title,
    messages: [],
    pendingConfirmation: null,
    createdAt: now,
    updatedAt: now,
    visibleState,
  };
  const bag = await readBag(db);
  bag.conversations.push(record);
  await writeBag(db, bag);
  return record;
}

export async function appendMessages(
  db: AppDatabase,
  userId: string,
  conversationId: string,
  messages: ChatMessage[],
  patch: Partial<Pick<ConversationRecord, 'pendingConfirmation' | 'visibleState' | 'title'>> = {},
): Promise<ConversationRecord> {
  const bag = await readBag(db);
  const index = bag.conversations.findIndex(
    (item) => item.id === conversationId && item.userId === userId,
  );
  if (index < 0) throw new Error('Conversation not found');
  const current = bag.conversations[index]!;
  const updated: ConversationRecord = {
    ...current,
    ...patch,
    messages: [
      ...current.messages,
      ...messages.map((item) => ({ ...item, createdAt: item.createdAt || new Date().toISOString() })),
    ],
    updatedAt: new Date().toISOString(),
  };
  bag.conversations[index] = updated;
  await writeBag(db, bag);
  return updated;
}

export async function setPendingConfirmation(
  db: AppDatabase,
  userId: string,
  conversationId: string,
  pending: PendingConfirmation | null,
): Promise<void> {
  const bag = await readBag(db);
  const index = bag.conversations.findIndex(
    (item) => item.id === conversationId && item.userId === userId,
  );
  if (index < 0) throw new Error('Conversation not found');
  bag.conversations[index] = {
    ...bag.conversations[index]!,
    pendingConfirmation: pending,
    updatedAt: new Date().toISOString(),
  };
  await writeBag(db, bag);
}
