import { signal } from '@angular/core';
import { AbstractChat } from 'ai';
import type { ChatInit, ChatState, ChatStatus, UIMessage } from 'ai';

/**
 * Angular signals-based ChatState where replaceMessage always produces a new
 * object reference. The AI SDK mutates `activeResponse.state.message` in place
 * and passes the same reference to replaceMessage on every streaming chunk. The
 * original AngularChatState from @ai-sdk/angular stores that reference directly,
 * so MessageComponent's signal input never sees a change and OnPush never
 * schedules a re-render mid-stream. The shallow-clone here fixes that.
 */
export class NgChatState<M extends UIMessage = UIMessage>
  implements ChatState<M>
{
  readonly #messages = signal<M[]>([]);
  readonly #status = signal<ChatStatus>('ready');
  readonly #error = signal<Error | undefined>(undefined);

  get messages(): M[] { return this.#messages(); }
  set messages(m: M[]) { this.#messages.set([...m]); }

  get status(): ChatStatus { return this.#status(); }
  set status(s: ChatStatus) { this.#status.set(s); }

  get error(): Error | undefined { return this.#error(); }
  set error(e: Error | undefined) { this.#error.set(e); }

  constructor(initial: M[] = []) {
    this.#messages.set([...initial]);
  }

  setMessages = (msgs: M[]): void => { this.#messages.set([...msgs]); };

  pushMessage = (m: M): void => {
    this.#messages.update(msgs => [...msgs, m]);
  };

  popMessage = (): void => {
    this.#messages.update(msgs => msgs.slice(0, -1));
  };

  replaceMessage = (index: number, message: M): void => {
    this.#messages.update(msgs => {
      const copy = [...msgs];
      // Shallow-clone the message AND each part so that every signal input
      // downstream (MessageComponent, ToolCallComponent) always receives a new
      // reference and OnPush re-renders on every streaming chunk / state change.
      copy[index] = {
        ...message,
        parts: (message.parts ?? []).map(p => ({ ...p })),
      };
      return copy;
    });
  };

  snapshot = <T>(thing: T): T => {
    try {
      return structuredClone(thing) as T;
    } catch {
      return thing;
    }
  };
}

/** Concrete AbstractChat subclass that wires in NgChatState. */
export class NgChat<M extends UIMessage = UIMessage> extends AbstractChat<M> {
  constructor(init: Omit<ChatInit<M>, 'messages'> & { messages?: M[] }) {
    super({ ...init, state: new NgChatState<M>(init.messages) });
  }
}
