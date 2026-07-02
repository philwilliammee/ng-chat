import { Component, input } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { AppRoute } from "../../../app.routes";
import { SimpleSideMenuComponent } from "../simple-side-menu/simple-side-menu.component";

@Component({
  selector: "lib-admin-layout",
  imports: [RouterOutlet, SimpleSideMenuComponent],
  template: `
    <lib-simple-side-menu
      [routes]="routes()"
      [title]="toolbarTitle()"
      [svgIconUrl]="svgIconUrl()"
      [imgHeight]="imgHeight()"
      [showToggle]="true"
    >
      <ng-content ngProjectAs="[toolbar]" />
      <!-- <div class="flex flex-direction-column gap-2 p-2"> -->
        <router-outlet />
      <!-- </div> -->
    </lib-simple-side-menu>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `
  ]
})
export class AdminLayoutComponent {
  readonly routes = input.required<AppRoute[]>();
  readonly toolbarTitle = input("My App");
  readonly svgIconUrl = input("");
  readonly imgHeight = input("45px");
}
