import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { TechAgentRoutingModule } from './tech-agent-routing.module';
import { EspaceTechComponent } from './espace-tech/espace-tech.component';
import {  RouterModule } from '@angular/router';
import { TechJobComponent } from './tech-job/tech-job.component';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '../shared/shared.module';
import { TechTestsDetailsComponent } from './tech-tests-details/tech-tests-details.component';


@NgModule({
  declarations: [
    EspaceTechComponent,
    TechJobComponent,
    TechTestsDetailsComponent

  ],
  imports: [
    CommonModule,
    TechAgentRoutingModule,
    RouterModule,
    FormsModule,
    SharedModule
  ]
})
export class TechAgentModule { }
