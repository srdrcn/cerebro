import { Routes } from '@angular/router';
import { AliasesComponent } from './features/aliases/aliases.component';
import { AnalysisComponent } from './features/analysis/analysis.component';
import { CatComponent } from './features/cat/cat.component';
import { ClusterSettingsComponent } from './features/cluster-settings/cluster-settings.component';
import { ConnectComponent } from './features/connect/connect.component';
import { CreateIndexComponent } from './features/create-index/create-index.component';
import { IndexSettingsComponent } from './features/index-settings/index-settings.component';
import { NodesComponent } from './features/nodes/nodes.component';
import { OverviewComponent } from './features/overview/overview.component';
import { RepositoriesComponent } from './features/repositories/repositories.component';
import { RestComponent } from './features/rest/rest.component';
import { SnapshotsComponent } from './features/snapshots/snapshots.component';
import { TemplatesComponent } from './features/templates/templates.component';

export const routes: Routes = [
  { path: 'connect', component: ConnectComponent, title: 'cerebro - connect' },
  { path: 'overview', component: OverviewComponent },
  { path: 'nodes', component: NodesComponent },
  { path: 'rest', component: RestComponent },
  { path: 'aliases', component: AliasesComponent },
  { path: 'create', component: CreateIndexComponent },
  { path: 'analysis', component: AnalysisComponent },
  { path: 'templates', component: TemplatesComponent },
  { path: 'cluster_settings', component: ClusterSettingsComponent },
  { path: 'index_settings', component: IndexSettingsComponent },
  { path: 'snapshot', component: SnapshotsComponent },
  { path: 'repository', component: RepositoriesComponent },
  { path: 'cat', component: CatComponent },
  { path: '', pathMatch: 'full', redirectTo: 'connect' },
  { path: '**', redirectTo: 'connect' },
];
