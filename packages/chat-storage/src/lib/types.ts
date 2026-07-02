import type { UIMessage } from 'ai';

export interface Conversation {
  id: string;
  title: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
  pinned?: boolean;
  archived?: boolean;
}
