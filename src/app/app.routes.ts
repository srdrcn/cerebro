import { Routes } from '@angular/router';
import { requireConnection } from './core/connection.guard';

/**
 * Paths are kept identical to the original AngularJS application so existing
 * bookmarks (including legacy `#!/` URLs, see legacy-hashbang.ts) still work.
 * Every feature is lazy loaded to keep the initial bundle small.
 */
export const routes: Routes = [
  {
    path: 'connect',
    loadComponent: () =>
      import('./features/connect/connect.component').then((m) => m.ConnectComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: 'connect' },
  {
    path: '',
    canActivateChild: [requireConnection],
    children: [
      {
        path: 'overview',
        loadComponent: () =>
          import('./features/overview/overview.component').then((m) => m.OverviewComponent),
      },
      {
        path: 'nodes',
        loadComponent: () =>
          import('./features/nodes/nodes.component').then((m) => m.NodesComponent),
      },
      {
        path: 'rest',
        loadComponent: () =>
          import('./features/rest/rest.component').then((m) => m.RestComponent),
      },
      {
        path: 'aliases',
        loadComponent: () =>
          import('./features/aliases/aliases.component').then((m) => m.AliasesComponent),
      },
      {
        path: 'create',
        loadComponent: () =>
          import('./features/create-index/create-index.component').then(
            (m) => m.CreateIndexComponent,
          ),
      },
      {
        path: 'analysis',
        loadComponent: () =>
          import('./features/analysis/analysis.component').then((m) => m.AnalysisComponent),
      },
      {
        path: 'templates',
        loadComponent: () =>
          import('./features/templates/templates.component').then((m) => m.TemplatesComponent),
      },
      {
        path: 'cluster_settings',
        loadComponent: () =>
          import('./features/cluster-settings/cluster-settings.component').then(
            (m) => m.ClusterSettingsComponent,
          ),
      },
      {
        path: 'index_settings',
        loadComponent: () =>
          import('./features/index-settings/index-settings.component').then(
            (m) => m.IndexSettingsComponent,
          ),
      },
      {
        path: 'snapshot',
        loadComponent: () =>
          import('./features/snapshots/snapshots.component').then((m) => m.SnapshotsComponent),
      },
      {
        path: 'repository',
        loadComponent: () =>
          import('./features/repositories/repositories.component').then(
            (m) => m.RepositoriesComponent,
          ),
      },
      {
        path: 'cat',
        loadComponent: () => import('./features/cat/cat.component').then((m) => m.CatComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'connect' },
];
