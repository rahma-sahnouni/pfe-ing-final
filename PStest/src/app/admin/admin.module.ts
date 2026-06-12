import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AdminRoutingModule } from './admin-routing.module';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { EspaceAdminComponent } from './espace-admin/espace-admin.component';
import { UserMangementComponent } from './user-mangement/user-mangement.component';
import { SharedModule } from '../shared/shared.module';


@NgModule({
  declarations: [
    EspaceAdminComponent,
    UserMangementComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    AdminRoutingModule,
    SharedModule
  ]
})
export class AdminModule { }
