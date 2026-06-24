import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ChatComponent } from '@ng-chat/ui';

@Component({
  selector: 'app-chat-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatComponent],
  template: `
    <div class="chat-page">
      <ng-chat
        api="/api/chat"
        emptyTitle="ng-chat"
        emptyHint="An open-source Angular + Hono agent chat. Ask a question or give the assistant a task." />
    </div>
  `,
  styles: [`
    :host { display: block; }
    .chat-page {
      height: calc(100vh - 96px);
      max-width: 920px;
      margin: 0 auto;
      width: 100%;
    }
  `],
})
export class ChatPageComponent {}
