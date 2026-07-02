import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'lib-bread-crumb',
  // encapsulation: ViewEncapsulation.None,
  template: `
    <div class="bread-crumb">
      <div class="pos-rel">
        <nav class="pos-abs btm-1 ">
          <ng-content />
        </nav>
      </div>
    </div>
  `,
  styles: [
    `
      .bread-crumb {
        margin-bottom: 1rem;
        font-size: 0.8rem;
      }
      .btm-1 {
        bottom: 1rem;
      }
    `,
  ],
})
export class BreadCrumbComponent {}
