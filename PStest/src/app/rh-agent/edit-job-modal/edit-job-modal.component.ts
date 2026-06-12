import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { JobOffer, JobOfferService } from '../../_services/job-offer.service';
import { UserApi, UserService } from '../../_services/user.service';

// Interfaces identiques à celles du modal de création
export interface TechnicalTest {
  id?: number;
  name: string;
  type: string;
  duration: number;
  minScore: number;
}
export interface Prerequisite {
  id?: number;
  icon?: string;
  type: string;
  value: string;
  role?: string;
  obligatory: boolean;
  customLabel?: string;
}
export interface Skill {
  id?: number;
  name: string;
  minLevel: number;
  weight: number;
  obligatory: boolean;
}
export interface HiringStage {
  id?: number;
  label: string;
  evaluator: string;
}
export interface TestPeriod {
  start: string | null;
  end: string | null;
}
export interface AssignmentConfig {
  enabled: boolean;
  assignedTo: string[];
  deadline: string | null;
}

@Component({
  selector: 'app-edit-job-modal',
  templateUrl: './edit-job-modal.component.html',
  styleUrls: ['./edit-job-modal.component.css']
})
export class EditJobModalComponent implements OnInit {
  @Input() job!: JobOffer;
  @Output() closed = new EventEmitter<void>();
  @Output() jobUpdated = new EventEmitter<JobOffer>();

  // Formulaire complet, calqué sur la structure du create modal
  form: Partial<JobOffer> & {
    tests: TechnicalTest[];
    stages: HiringStage[];
    testPeriod: TestPeriod;
    testAssignments: {
      rhTest: AssignmentConfig;
      technicalTest: AssignmentConfig;
    };
    intervAssignments: {
      rhTest: AssignmentConfig;
      technicalTest: AssignmentConfig;
    };
  } = {
    title: '',
    department: 'Engineering',
    location: '',
    contractType: 'Full-time',
    experienceLevel: 'Mid-level (3-5 years)',
    description: '',
    prerequisites: [],
    skills: [],
    tests: [],
    stages: [],
    testAssignments: {
      rhTest: { enabled: false, assignedTo: [], deadline: null },
      technicalTest: { enabled: false, assignedTo: [], deadline: null }
    },
    intervAssignments: {
      rhTest: { enabled: false, assignedTo: [], deadline: null },
      technicalTest: { enabled: false, assignedTo: [], deadline: null }
    },
    testPeriod: { start: null, end: null },
    status: 'open'
  };

  saving = false;
  errorMsg = '';

  // Options pour les sélecteurs
  departments = ['Engineering', 'Design', 'People', 'Marketing', 'Finance', 'Product', 'Security', 'Data'];
  contractTypes = ['Full-time', 'Part-time', 'Contract', 'Freelance', 'Internship', 'Apprenticeship'];
  experienceLevels = ['Junior (0-2 years)', 'Mid-level (3-5 years)', 'Senior (5-8 years)', 'Lead / Staff (8+ years)', 'Principal / Architect'];
  prereqTypes = ['Certification', 'Language', 'Experience', 'Education', 'Location', 'Custom'];
  testTypes = ['MCQ', 'Coding Challenge', 'Case Study', 'Live Coding', 'System Design', 'Take-Home Project'];

  availableAgents: UserApi[] = [];

  constructor(
    private jobService: JobOfferService,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    // Copie profonde du job reçu
    this.form = JSON.parse(JSON.stringify(this.job));

    // Initialiser les structures manquantes si nécessaire
    if (!this.form.tests) this.form.tests = [];
    if (!this.form.stages) this.form.stages = [];
    if (!this.form.testPeriod) this.form.testPeriod = { start: null, end: null };
    if (!this.form.testAssignments) {
      this.form.testAssignments = {
        rhTest: { enabled: false, assignedTo: [], deadline: null },
        technicalTest: { enabled: false, assignedTo: [], deadline: null }
      };
    }
    if (!this.form.intervAssignments) {
      this.form.intervAssignments = {
        rhTest: { enabled: false, assignedTo: [], deadline: null },
        technicalTest: { enabled: false, assignedTo: [], deadline: null }
      };
    }

    // Normalisation : les assignations peuvent contenir des objets utilisateur complets côté backend
    const normalizeAssignees = (assignees: any[]): string[] =>
      assignees.map(a => (typeof a === 'object' ? (a._id ?? a.id) : a)).filter(Boolean);

    if (this.form.testAssignments.rhTest.assignedTo) {
      this.form.testAssignments.rhTest.assignedTo = normalizeAssignees(this.form.testAssignments.rhTest.assignedTo);
    }
    if (this.form.testAssignments.technicalTest.assignedTo) {
      this.form.testAssignments.technicalTest.assignedTo = normalizeAssignees(this.form.testAssignments.technicalTest.assignedTo);
    }
    if (this.form.intervAssignments.rhTest.assignedTo) {
      this.form.intervAssignments.rhTest.assignedTo = normalizeAssignees(this.form.intervAssignments.rhTest.assignedTo);
    }
    if (this.form.intervAssignments.technicalTest.assignedTo) {
      this.form.intervAssignments.technicalTest.assignedTo = normalizeAssignees(this.form.intervAssignments.technicalTest.assignedTo);
    }

    // Charger la liste des agents
    this.userService.getUsers().subscribe(agents => this.availableAgents = agents);
  }

  // ──────────────────────────────────────────────────────────
  // Getter simplifiés pour les templates
  get rhTest()   { return this.form.testAssignments.rhTest; }
  get techTest() { return this.form.testAssignments.technicalTest; }
  get rhInterview()   { return this.form.intervAssignments.rhTest; }
  get techInterview() { return this.form.intervAssignments.technicalTest; }

  // ──────────────────────────────────────────────────────────
  // Tests & Stages : gestion des listes
  addTest() {
    this.form.tests!.push({
      id: Date.now(),
      name: '',
      type: 'MCQ',
      duration: 30,
      minScore: 70
    });
  }
  removeTest(index: number) {
    this.form.tests!.splice(index, 1);
  }

  addStage() {
    this.form.stages!.push({
      id: Date.now(),
      label: '',
      evaluator: ''
    });
  }
  removeStage(index: number) {
    this.form.stages!.splice(index, 1);
  }

  // ──────────────────────────────────────────────────────────
  // Gestion des assignations (tests & interviews)
  getAgentLabel(uid: string): string {
    const agent = this.availableAgents.find(a => a.id === uid);
    return agent ? (agent.name ?? agent.email) : uid;
  }

  // Pour les tests
  getUnassignedForTest(type: 'rh' | 'tech'): UserApi[] {
    const already = type === 'rh' ? this.rhTest.assignedTo : this.techTest.assignedTo;
    return this.availableAgents.filter(a => !already.includes(a.id));
  }
  addTestAssignee(type: 'rh' | 'tech', event: Event) {
    const uid = (event.target as HTMLSelectElement).value;
    if (!uid) return;
    const target = type === 'rh' ? this.rhTest : this.techTest;
    if (!target.assignedTo.includes(uid)) target.assignedTo.push(uid);
    (event.target as HTMLSelectElement).value = '';
  }
  removeTestAssignee(type: 'rh' | 'tech', uid: string) {
    const target = type === 'rh' ? this.rhTest : this.techTest;
    target.assignedTo = target.assignedTo.filter(id => id !== uid);
  }

  // Pour les interviews
  getUnassignedForInterview(type: 'rh' | 'tech'): UserApi[] {
    const already = type === 'rh' ? this.rhInterview.assignedTo : this.techInterview.assignedTo;
    return this.availableAgents.filter(a => !already.includes(a.id));
  }
  addInterviewAssignee(type: 'rh' | 'tech', event: Event) {
    const uid = (event.target as HTMLSelectElement).value;
    if (!uid) return;
    const target = type === 'rh' ? this.rhInterview : this.techInterview;
    if (!target.assignedTo.includes(uid)) target.assignedTo.push(uid);
    (event.target as HTMLSelectElement).value = '';
  }
  removeInterviewAssignee(type: 'rh' | 'tech', uid: string) {
    const target = type === 'rh' ? this.rhInterview : this.techInterview;
    target.assignedTo = target.assignedTo.filter(id => id !== uid);
  }

  // ──────────────────────────────────────────────────────────
  // Compétences et prérequis (CRUD)
  addSkill() {
    this.form.skills!.push({
      id: Date.now(),
      name: '',
      minLevel: 3,
      weight: 0,
      obligatory: false
    });
  }
  removeSkill(index: number) {
    this.form.skills!.splice(index, 1);
  }

  addPrerequisite() {
    this.form.prerequisites!.push({
      id: Date.now(),
      icon: 'verified',
      type: 'Certification',
      value: '',
      obligatory: false
    });
  }
  removePrerequisite(index: number) {
    this.form.prerequisites!.splice(index, 1);
  }

  // ──────────────────────────────────────────────────────────
  // Helper pour la période de test
  get testPeriodDurationDays(): number | null {
    const { start, end } = this.form.testPeriod;
    if (!start || !end) return null;
    const diff = new Date(end).getTime() - new Date(start).getTime();
    return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : null;
  }
  get testPeriodValid(): boolean {
    const { start, end } = this.form.testPeriod;
    if (!start && !end) return true;
    if (start && end) return new Date(end) > new Date(start);
    return true;
  }
  get todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // ──────────────────────────────────────────────────────────
  // Sauvegarde
  save() {
    if (!this.form.title?.trim()) {
      this.errorMsg = 'Job title is required.';
      return;
    }
    if (!this.testPeriodValid) {
      this.errorMsg = 'Test period end date must be after start date.';
      return;
    }
    // Validation des assignations d'interview si activées
    if (this.rhInterview.enabled && this.rhInterview.assignedTo.length === 0) {
      this.errorMsg = 'Please assign at least one RH interviewer.';
      return;
    }
    if (this.techInterview.enabled && this.techInterview.assignedTo.length === 0) {
      this.errorMsg = 'Please assign at least one technical interviewer.';
      return;
    }

    this.saving = true;
    this.errorMsg = '';

    // Nettoyer les IDs temporaires avant envoi (comme le fait le backend avec _stripFrontendId)
    const cleanArray = (arr: any[]) => arr.map(({ id, ...rest }) => rest);
    const payload = {
      ...this.form,
      prerequisites: this.form.prerequisites ? cleanArray(this.form.prerequisites) : [],
      skills: this.form.skills ? cleanArray(this.form.skills) : [],
      tests: this.form.tests ? cleanArray(this.form.tests) : [],
      stages: this.form.stages ? cleanArray(this.form.stages) : []
    };

    this.jobService.updateJob(this.job._id!, payload as JobOffer).subscribe({
      next: (updated) => {
        this.saving = false;
        this.jobUpdated.emit(updated);
        this.close();
      },
      error: (err) => {
        this.saving = false;
        this.errorMsg = err.message || 'Failed to update job.';
      }
    });
  }

  close() {
    this.closed.emit();
  }
}