import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-home',
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    <div class="flex flex-direction-column gap-2">
      <h1>Project</h1>
      <p>Server status: <strong>{{ status() }}</strong></p>
      <div>
        <a mat-raised-button color="primary" routerLink="/admin">
          <mat-icon>dashboard</mat-icon>
          Admin Dashboard
        </a>
      </div>
    </div>
  `,
})
export class HomeComponent implements OnInit {
  private http = inject(HttpClient);
  status = signal('checking...');

  ngOnInit() {
    this.http.get<{ status: string }>('/api/status').subscribe({
      next: (res) => this.status.set(res.status),
      error: () => this.status.set('unreachable'),
    });
  }
}
