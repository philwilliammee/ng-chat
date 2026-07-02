import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'lib-main',
  imports: [],
  template: `
    <div id="main-content" class="band pb-2">
      <main
        id="main"
        class="container-fluid aria-target"
        [class.padding-top]="useTopPadding()"
        tabindex="-1"
      >
        <ng-content />
      </main>
    </div>
  `,
  styleUrls: ['./main.component.scss'],
})
export class MainComponent {
  readonly useTopPadding = input(true);
}
