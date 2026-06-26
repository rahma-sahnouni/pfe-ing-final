// create-job-modal.component.ts
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { JobOfferService, JobOffer } from '../../_services/job-offer.service';
import { UserApi, UserService } from '../../_services/user.service';

export interface TechnicalTest {
  id: number; name: string; type: string; duration: number; minScore: number;
}
export interface Prerequisite {
  id: number; icon: string; type: string; value: string;
  role?: string; obligatory: boolean; customLabel?: string;
  values: string[];
  extraOptions: string[];
  weight: number;
}
export interface Skill {
  id: number; name: string; minLevel: number; weight: number;
  obligatory: boolean; type: 'hard' | 'soft';
}
export interface GlobalWeights {
  prerequisites: number;
  hardSkills:    number;
  softSkills:    number;
}
export interface HiringStage {
  id: number; label: string; evaluator: string;
}
export interface TestPeriod {
  start: string | null;
  end:   string | null;
}

export interface NewJobForm {
  title: string; department: string; location: string;
  contractType: string; experienceLevel: string; description: string;
  prerequisites: Prerequisite[];
  skills: Skill[];
  globalWeights: GlobalWeights;
  skillsWeight:     number;
  hardSkillsWeight: number;
  tests: TechnicalTest[]; stages: HiringStage[];
  testAssignments: {
    rhTest:        { enabled: boolean; assignedTo: string[]; deadline: string | null };
    technicalTest: { enabled: boolean; assignedTo: string[]; deadline: string | null };
  };
  intervAssignments: {
    rhTest:        { enabled: boolean; assignedTo: string[]; deadline: string | null };
    technicalTest: { enabled: boolean; assignedTo: string[]; deadline: string | null };
  };
  testPeriod: TestPeriod;
}

@Component({
  selector:    'app-create-job-modal',
  templateUrl: './create-job-modal.component.html',
  styleUrls:   ['./create-job-modal.component.css'],
})
export class CreateJobModalComponent implements OnInit {

  @Output() closed     = new EventEmitter<void>();
  @Output() jobCreated = new EventEmitter<JobOffer>();

  currentStep   = 1;
  isSubmitting  = false;
  submitError:  string | null = null;

  stepError:      string | null = null;
  showStep1Errors = false;

  addingOption:   Record<number, boolean> = {};
  newOptionText:  Record<number, string>  = {};
  customMode:     Record<string, string>  = {};

  totalSteps = 5;
  steps = [
    { id: 1, label: 'General Info' },
    { id: 2, label: 'Prerequisites' },
    { id: 3, label: 'Technical Skills' },
    { id: 4, label: 'Tests & Assignments' },
    { id: 5, label: 'Interview Assignments' },
  ];

  form: NewJobForm = {
    testAssignments: {
      rhTest:        { enabled: false, assignedTo: [], deadline: null },
      technicalTest: { enabled: false, assignedTo: [], deadline: null },
    },
    intervAssignments: {
      rhTest:        { enabled: false, assignedTo: [], deadline: null },
      technicalTest: { enabled: false, assignedTo: [], deadline: null },
    },
    testPeriod: { start: null, end: null },
    title: '', department: 'Engineering', location: '',
    contractType: 'Full-time', experienceLevel: 'Mid-level (3-5 years)', description: '',
    globalWeights: { prerequisites: 30, hardSkills: 50, softSkills: 20 },
    skillsWeight:     70,
    hardSkillsWeight: 60,
    prerequisites: [
      { id: 1, icon: 'verified',  type: 'Certification', value: 'AWS Certified Developer – Associate', obligatory: true,  values: ['AWS Certified Developer – Associate'], extraOptions: [], weight: 40 },
      { id: 2, icon: 'translate', type: 'Language',      value: 'English (C1 – Advanced)',            obligatory: true,  values: ['English (C1 – Advanced)'],            extraOptions: [], weight: 35 },
      { id: 3, icon: 'work',      type: 'Experience',    value: '5',                                   obligatory: true,  values: [],                                      extraOptions: [], weight: 25, role: '' },
    ],
    skills: [
      { id: 1, name: 'Angular',       minLevel: 3, weight: 50, obligatory: true,  type: 'hard' },
      { id: 2, name: 'TypeScript',    minLevel: 4, weight: 50, obligatory: true,  type: 'hard' },
      { id: 3, name: 'Communication', minLevel: 3, weight: 60, obligatory: false, type: 'soft' },
      { id: 4, name: 'Teamwork',      minLevel: 3, weight: 40, obligatory: false, type: 'soft' },
    ],
    tests: [
      { id: 1, name: 'JavaScript & TypeScript Fundamentals', type: 'MCQ', duration: 30, minScore: 70 },
    ],
    stages: [
      { id: 1, label: 'STAGE 1 – HR Screen', evaluator: '' },
      { id: 2, label: 'STAGE 2 – Technical',  evaluator: '' },
      { id: 3, label: 'STAGE 3 – Final',       evaluator: '' },
    ],
  };

  /* ─── Dropdown options ─── */
  prereqTypes  = ['Education', 'Language', 'Certification', 'Experience', 'Location', 'Custom'];
  prereqIcons: Record<string, string> = {
    Certification: 'verified', Language: 'translate', Experience: 'work',
    Education: 'school', Location: 'location_on', Custom: 'tune',
  };
  langOptions = [
    'English (C2 – Mastery)', 'English (C1 – Advanced)', 'English (B2 – Upper-Intermediate)',
    'French (C1 – Advanced)', 'French (B2 – Upper-Intermediate)', 'Spanish (B2 – Upper-Intermediate)',
    'German (B2 – Upper-Intermediate)', 'Arabic (Native)', 'Arabic (Professional Proficiency)',
    'Mandarin (HSK 4+)', 'Portuguese (B2)',
  ];
  certificationOptions = [
    'AWS Certified Developer – Associate', 'AWS Solutions Architect – Associate',
    'AWS Solutions Architect – Professional', 'AWS DevOps Engineer – Professional',
    'Google Cloud Professional Cloud Architect', 'Google Cloud Professional Data Engineer',
    'Google Cloud Associate Cloud Engineer', 'Microsoft Azure Developer Associate (AZ-204)',
    'Microsoft Azure Solutions Architect (AZ-305)', 'Microsoft Azure Administrator (AZ-104)',
    'Certified Kubernetes Administrator (CKA)', 'Certified Kubernetes Application Developer (CKAD)',
    'HashiCorp Certified Terraform Associate', 'Docker Certified Associate (DCA)',
    'Certified Scrum Master (CSM)', 'Professional Scrum Master (PSM I)',
    'PMI Project Management Professional (PMP)', 'SAFe 6 Agilist', 'CompTIA Security+',
    'Certified Ethical Hacker (CEH)', 'Certified Information Systems Security Professional (CISSP)',
    'Offensive Security Certified Professional (OSCP)', 'TensorFlow Developer Certificate',
    'Databricks Certified Associate Developer for Apache Spark', 'Snowflake SnowPro Core',
    'Oracle Certified Professional – Java SE 17', 'Cisco Certified Network Associate (CCNA)',
  ];
  educationOptions = [
    "Bachelor's Degree in Computer Science", "Bachelor's Degree in Software Engineering",
    "Bachelor's Degree in Information Systems", "Bachelor's Degree in Electronics / Embedded Systems",
    "Bachelor's Degree in Mathematics / Statistics", "Bachelor's Degree in any field",
    "Master's Degree in Computer Science", "Master's Degree in Software Engineering",
    "Master's Degree in Data Science & AI", "Master's Degree in Cybersecurity",
    "Master's Degree in Information Systems", "Engineering Degree (Grandes Écoles – France)",
    "PhD in Computer Science", "PhD in Machine Learning / AI",
    "Associate Degree in Computer Science", "Any degree level accepted",
  ];
  locationOptions = [
    'Based in Tunisia (on-site)', 'Based in France (on-site)', 'Based in EU (any country)',
    'Based in Morocco', 'Based in Algeria', 'Open to relocation (company sponsored)',
    'Remote – Worldwide', 'Remote – EMEA timezone (UTC±3)', 'Remote – EU timezone required',
    'Hybrid – 2 days on-site per week', 'On-site required (no remote)',
  ];
  roleOptions = [
    'Software Engineer', 'Senior Software Engineer', 'Frontend Developer', 'Backend Developer',
    'Full-Stack Developer', 'Mobile Developer (iOS)', 'Mobile Developer (Android)',
    'Mobile Developer (React Native / Flutter)', 'DevOps Engineer', 'Site Reliability Engineer (SRE)',
    'Platform Engineer', 'Data Engineer', 'Data Analyst', 'Data Scientist', 'Machine Learning Engineer',
    'AI / LLM Engineer', 'Cloud Architect', 'Solutions Architect', 'Security Engineer',
    'QA / Test Automation Engineer', 'Embedded Systems Engineer', 'Product Manager',
    'Technical Project Manager', 'Scrum Master', 'UI/UX Designer', 'Tech Lead',
    'Engineering Manager', 'CTO / VP of Engineering',
  ];
  deptOptions      = ['Engineering', 'Design', 'People', 'Marketing', 'Finance', 'Product', 'Security', 'Data'];
  contractOptions  = ['Full-time', 'Part-time', 'Contract', 'Freelance', 'Internship', 'Apprenticeship'];
  expOptions       = ['Junior (0-2 years)', 'Mid-level (3-5 years)', 'Senior (5-8 years)', 'Lead / Staff (8+ years)', 'Principal / Architect'];
  testTypes        = ['MCQ', 'Coding Challenge', 'Case Study', 'Live Coding', 'System Design', 'Take-Home Project'];

  suggestedSkillsMap: Record<string, { hard: string[]; soft: string[] }> = {
    Engineering: {
      hard: ['JavaScript / TypeScript', 'Python', 'Java', 'Go', 'Rust', 'Node.js', 'React', 'Angular',
             'Vue.js', 'NestJS', 'Spring Boot', 'GraphQL', 'REST API Design', 'PostgreSQL', 'MongoDB',
             'Redis', 'Docker', 'Kubernetes', 'AWS / GCP / Azure', 'Terraform', 'CI/CD'],
      soft: ['Problem Solving', 'Communication', 'Teamwork', 'Adaptability', 'Time Management',
             'Critical Thinking', 'Attention to Detail', 'Initiative'],
    },
    Data: {
      hard: ['Python (pandas / NumPy)', 'SQL (advanced)', 'Apache Spark', 'dbt', 'Airflow', 'Kafka',
             'Tableau / Power BI', 'Machine Learning', 'Deep Learning', 'Data Warehousing'],
      soft: ['Analytical Thinking', 'Communication', 'Curiosity', 'Storytelling with Data', 'Collaboration'],
    },
    Security: {
      hard: ['Penetration Testing', 'SIEM / SOC Tools', 'Network Security', 'OWASP Top 10',
             'Cryptography', 'Cloud Security', 'Zero Trust Architecture'],
      soft: ['Attention to Detail', 'Ethical Judgment', 'Problem Solving', 'Communication', 'Initiative'],
    },
    Design: {
      hard: ['Figma', 'Design Systems', 'Prototyping', 'Accessibility (WCAG)', 'Adobe Creative Suite'],
      soft: ['Creativity', 'Empathy', 'Communication', 'User Research', 'Collaboration'],
    },
    People: {
      hard: ['HR Information Systems', 'Recruitment Platforms', 'Performance Management', 'Labor Law'],
      soft: ['Empathy', 'Communication', 'Conflict Resolution', 'Organizational Skills', 'Discretion'],
    },
    Marketing: {
      hard: ['SEO / SEM', 'Google Analytics', 'Content Strategy', 'Social Media Management', 'CRM Tools'],
      soft: ['Creativity', 'Communication', 'Analytical Thinking', 'Storytelling', 'Adaptability'],
    },
    Finance: {
      hard: ['Financial Modeling', 'Excel / Power Query', 'ERP Systems', 'IFRS / GAAP', 'Tax Compliance'],
      soft: ['Attention to Detail', 'Analytical Thinking', 'Integrity', 'Communication', 'Problem Solving'],
    },
    Product: {
      hard: ['Product Roadmapping', 'User Story Writing', 'A/B Testing', 'Data Analytics', 'Agile / Scrum'],
      soft: ['Vision & Strategy', 'Communication', 'Empathy', 'Prioritization', 'Leadership'],
    },
  };

  constructor(
    private jobOfferService: JobOfferService,
    private userService:     UserService,
  ) {}

  /* ─── Skill list helpers ─── */
  get hardSkillList(): Skill[] { return this.form.skills.filter(s => s.type === 'hard'); }
  get softSkillList(): Skill[] { return this.form.skills.filter(s => s.type === 'soft'); }
  get obligatoryPrereqCount(): number { return this.form.prerequisites.filter(p => p.obligatory).length; }

  get totalHardWeight(): number { return this.hardSkillList.reduce((s, sk) => s + sk.weight, 0); }
  get totalSoftWeight(): number { return this.softSkillList.reduce((s, sk) => s + sk.weight, 0); }
  get hardWeight():      number { return this.totalHardWeight; }
  get softWeight():      number { return this.totalSoftWeight; }
  get hardSkillsCount(): number { return this.hardSkillList.length; }
  get softSkillsCount(): number { return this.softSkillList.length; }

  get essentialHard(): number { return this.hardSkillList.filter(s => s.obligatory).length; }
  get essentialSoft(): number { return this.softSkillList.filter(s => s.obligatory).length; }

  get currentSuggestions(): string[] {
    const map = this.suggestedSkillsMap[this.form.department] || this.suggestedSkillsMap['Engineering'];
    return [...map.hard, ...map.soft].filter(s => !this.form.skills.some(sk => sk.name === s));
  }
  get currentHardSuggestions(): string[] {
    const map = this.suggestedSkillsMap[this.form.department] || this.suggestedSkillsMap['Engineering'];
    return map.hard.filter(s => !this.form.skills.some(sk => sk.name === s));
  }
  get currentSoftSuggestions(): string[] {
    const map = this.suggestedSkillsMap[this.form.department] || this.suggestedSkillsMap['Engineering'];
    return map.soft.filter(s => !this.form.skills.some(sk => sk.name === s));
  }

  addSkill(type: 'hard' | 'soft' = 'hard') {
    this.form.skills.push({ id: Date.now(), name: '', minLevel: 3, weight: 0, obligatory: false, type });
  }
  addSuggestedSkill(name: string, type: 'hard' | 'soft' = 'hard') {
    if (!this.form.skills.some(s => s.name === name)) {
      this.form.skills.push({ id: Date.now(), name, minLevel: 3, weight: 10, obligatory: false, type });
    }
  }
  removeSkill(id: number) { this.form.skills = this.form.skills.filter(s => s.id !== id); }

  /* ─── Global weights ─── */
  get prereqGlobalWeight(): number { return this.form.skillsWeight; }
  set prereqGlobalWeight(v: number) { this.form.skillsWeight = v; }

  get totalGlobalWeight(): number { return 100; }

  /* ─── Prerequisite weight ─── */
  get totalPrereqWeight(): number {
    return this.form.prerequisites.reduce((s, p) => s + (p.weight || 0), 0);
  }

  /* ─── Multi-select helpers ─── */
  isMultiSelect(type: string): boolean {
    return ['Education', 'Language', 'Certification', 'Location'].includes(type);
  }
  isMultiSelectType(type: string): boolean { return this.isMultiSelect(type); }

  getChecklistOptions(type: string): string[] {
    const defaults: Record<string, string[]> = {
      Education:     this.educationOptions,
      Language:      this.langOptions,
      Certification: this.certificationOptions,
      Location:      this.locationOptions,
    };
    return defaults[type] || [];
  }

  getOptionsForType(type: string, prereqId: number): string[] {
    const prereq = this.form.prerequisites.find(p => p.id === prereqId);
    return [...this.getChecklistOptions(type), ...(prereq?.extraOptions || [])];
  }

  toggleChecklistValue(p: Prerequisite, opt: string) {
    const idx = p.values.indexOf(opt);
    if (idx >= 0) p.values.splice(idx, 1);
    else p.values.push(opt);
  }
  toggleOption(p: Prerequisite, opt: string) { this.toggleChecklistValue(p, opt); }

  removeChecklistValue(p: Prerequisite, opt: string) {
    p.values = p.values.filter(v => v !== opt);
  }
  removeOption(p: Prerequisite, opt: string) { this.removeChecklistValue(p, opt); }

  addCustomOption(p: Prerequisite): void {
    const text = (this.newOptionText[p.id] || '').trim();
    const allExisting = [...this.getChecklistOptions(p.type), ...p.extraOptions];
    if (text && !allExisting.includes(text)) {
      p.extraOptions.push(text);
      if (!p.values.includes(text)) p.values.push(text);
    }
    this.newOptionText[p.id] = '';
    this.addingOption[p.id] = false;
  }

  onRoleSelectChange(p: Prerequisite, val: string) {
    if (val !== '__other__') p.role = val;
  }

  addNewOption(prereqId: number) {
    this.addingOption[prereqId] = true;
    this.newOptionText[prereqId] = '';
  }
  confirmNewOption(p: Prerequisite) {
    const text = (this.newOptionText[p.id] || '').trim();
    if (text && !p.extraOptions.includes(text)) {
      p.extraOptions.push(text);
      if (!p.values.includes(text)) p.values.push(text);
    }
    this.addingOption[p.id] = false;
    this.newOptionText[p.id] = '';
  }
  confirmCustom(_p: Prerequisite) { this.stepError = null; }

  /* ─── Prereq type change ─── */
  onPrereqTypeChange(prereq: Prerequisite) {
    prereq.icon = this.prereqIcons[prereq.type] || 'check_circle';
    prereq.role = undefined;
    prereq.customLabel = undefined;
    prereq.values = [];
    prereq.extraOptions = [];
    delete this.addingOption[prereq.id];
    delete this.newOptionText[prereq.id];
    prereq.value = prereq.type === 'Experience' ? '3' : '';
    if (prereq.type === 'Experience') prereq.role = '';
  }

  /* ─── Step Validation ─── */
  get step1Valid(): boolean {
    return !!(this.form.title.trim() && this.form.location.trim() && this.form.description.trim());
  }

  prereqHasValue(p: Prerequisite): boolean {
    if (this.isMultiSelect(p.type)) return p.values.length > 0;
    if (p.type === 'Experience') return !!(p.value);
    if (p.type === 'Custom') return !!(p.customLabel?.trim() && p.value?.trim());
    return true;
  }

  get step2Valid(): boolean {
    if (!this.form.prerequisites.length) return true;
    const allFilled = this.form.prerequisites.every(p => this.prereqHasValue(p));
    const weightsOk = this.totalPrereqWeight === 100;
    return allFilled && weightsOk;
  }

  get step3Valid(): boolean {
    if (!this.form.skills.length) return false;
    const hardOk = this.hardSkillList.length === 0 || this.totalHardWeight === 100;
    const softOk = this.softSkillList.length === 0 || this.totalSoftWeight === 100;
    return hardOk && softOk;
  }

  /* ─── Navigation ─── */
  next() {
    this.stepError = null;
    if (this.currentStep === 1) {
      this.showStep1Errors = true;
      if (!this.step1Valid) {
        this.stepError = 'Please fill in all required fields: title, location and description.';
        return;
      }
    }
    if (this.currentStep === 2) {
      if (this.form.prerequisites.length && !this.form.prerequisites.every(p => this.prereqHasValue(p))) {
        this.stepError = 'Each prerequisite must have at least one option selected.';
        return;
      }
      if (this.form.prerequisites.length && this.totalPrereqWeight !== 100) {
        this.stepError = `Prerequisite weights must total 100%. Current total: ${this.totalPrereqWeight}%`;
        return;
      }
    }
    if (this.currentStep === 3) {
      if (!this.form.skills.length) {
        this.stepError = 'Please add at least one skill.';
        return;
      }
      if (this.hardSkillList.length > 0 && this.totalHardWeight !== 100) {
        this.stepError = `Hard Skills weights must total 100%. Current total: ${this.totalHardWeight}%`;
        return;
      }
      if (this.softSkillList.length > 0 && this.totalSoftWeight !== 100) {
        this.stepError = `Soft Skills weights must total 100%. Current total: ${this.totalSoftWeight}%`;
        return;
      }
    }
    this.showStep1Errors = false;
    if (this.currentStep < this.totalSteps) this.currentStep++;
  }

  previous() {
    this.stepError = null;
    this.showStep1Errors = false;
    if (this.currentStep > 1) this.currentStep--;
  }

  close() { this.closed.emit(); }

  /* ─── Prerequisites CRUD ─── */
  addPrerequisite() {
    const newId = Date.now();
    this.form.prerequisites.push({
      id: newId, icon: 'verified', type: 'Certification',
      value: '', obligatory: false, values: [], extraOptions: [], weight: 0,
    });
  }
  removePrerequisite(id: number) {
    this.form.prerequisites = this.form.prerequisites.filter(p => p.id !== id);
    delete this.addingOption[id];
    delete this.newOptionText[id];
  }

  /* ─── Test period ─── */
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
  get todayIso(): string { return new Date().toISOString().slice(0, 10); }

  /* ─── Agents ─── */
  availableAgents: UserApi[] = [];
  ngOnInit() { this.userService.getUsers().subscribe(a => this.availableAgents = a); }
  getAgentLabel(uid: string): string {
    const a = this.availableAgents.find(a => a.id === uid);
    return a ? (a.name ?? a.email) : uid;
  }

  private agentsByRole(type: 'rh' | 'tech'): UserApi[] {
    const role = type === 'rh' ? 'rh' : 'technical evaluator';
    return this.availableAgents.filter(a => a.role === role);
  }

  addAssignee(type: 'rh' | 'tech', event: Event) {
    const uid = (event.target as HTMLSelectElement).value;
    if (!uid) return;
    const t = type === 'rh' ? this.form.testAssignments.rhTest : this.form.testAssignments.technicalTest;
    if (!t.assignedTo.includes(uid)) t.assignedTo.push(uid);
    (event.target as HTMLSelectElement).value = '';
  }
  removeAssignee(type: 'rh' | 'tech', uid: string) {
    const t = type === 'rh' ? this.form.testAssignments.rhTest : this.form.testAssignments.technicalTest;
    t.assignedTo = t.assignedTo.filter(id => id !== uid);
  }
  getUnassigned(type: 'rh' | 'tech'): UserApi[] {
    const already = type === 'rh'
      ? this.form.testAssignments.rhTest.assignedTo
      : this.form.testAssignments.technicalTest.assignedTo;
    return this.agentsByRole(type).filter(a => !already.includes(a.id));
  }

  addInterviewAssignee(type: 'rh' | 'tech', event: Event) {
    const uid = (event.target as HTMLSelectElement).value;
    if (!uid) return;
    const t = type === 'rh' ? this.form.intervAssignments.rhTest : this.form.intervAssignments.technicalTest;
    if (!t.assignedTo.includes(uid)) t.assignedTo.push(uid);
    (event.target as HTMLSelectElement).value = '';
  }
  removeInterviewAssignee(type: 'rh' | 'tech', uid: string) {
    const t = type === 'rh' ? this.form.intervAssignments.rhTest : this.form.intervAssignments.technicalTest;
    t.assignedTo = t.assignedTo.filter(id => id !== uid);
  }
  getUnassignedInterviewers(type: 'rh' | 'tech'): UserApi[] {
    const already = type === 'rh'
      ? this.form.intervAssignments.rhTest.assignedTo
      : this.form.intervAssignments.technicalTest.assignedTo;
    return this.agentsByRole(type).filter(a => !already.includes(a.id));
  }

  addRhInterviewAssignee(e: Event)        { this.addInterviewAssignee('rh', e); }
  removeRhInterviewAssignee(uid: string)  { this.removeInterviewAssignee('rh', uid); }
  getUnassignedRhInterviewers()           { return this.getUnassignedInterviewers('rh'); }
  addTechInterviewAssignee(e: Event)      { this.addInterviewAssignee('tech', e); }
  removeTechInterviewAssignee(uid: string){ this.removeInterviewAssignee('tech', uid); }
  getUnassignedTechInterviewers()         { return this.getUnassignedInterviewers('tech'); }

  /* ─── Donut helper ─── */
  dashArray(pct: number): string {
    const clamped = Math.min(100, Math.max(0, pct));
    return `${(clamped / 100) * 314.16} 314.16`;
  }

  /* ─── Submit ─── */
  private mapFormToJobOffer(form: NewJobForm): JobOffer {
    const skillsPct = form.skillsWeight;
    const hardPct   = Math.round(skillsPct * form.hardSkillsWeight / 100);
    const softPct   = skillsPct - hardPct;
    const prereqPct = 100 - skillsPct;

    return {
      title:           form.title,
      department:      form.department as JobOffer['department'],
      location:        form.location,
      contractType:    form.contractType as JobOffer['contractType'],
      experienceLevel: form.experienceLevel as JobOffer['experienceLevel'],
      description:     form.description,
      globalWeights:   { prerequisites: prereqPct, hardSkills: hardPct, softSkills: softPct } as any,
      prerequisites:   form.prerequisites.map(({ id, extraOptions, values, ...rest }) => ({
        ...rest,
        value: this.isMultiSelect(rest.type) ? values.join(', ') : rest.value,
      })) as any,
      skills:          form.skills.map(({ id, ...rest }) => rest) as any,
      tests:           form.tests.map(({ id, ...rest }) => rest) as any,
      stages:          form.stages.map(({ id, ...rest }) => rest) as any,
      testAssignments: {
        rhTest:        { enabled: form.testAssignments.rhTest.enabled,        assignedTo: form.testAssignments.rhTest.assignedTo,        deadline: form.testAssignments.rhTest.deadline || null },
        technicalTest: { enabled: form.testAssignments.technicalTest.enabled, assignedTo: form.testAssignments.technicalTest.assignedTo, deadline: form.testAssignments.technicalTest.deadline || null },
      },
      intervAssignments: {
        rhTest:        { enabled: form.intervAssignments.rhTest.enabled,        assignedTo: form.intervAssignments.rhTest.assignedTo,        deadline: form.intervAssignments.rhTest.deadline || null },
        technicalTest: { enabled: form.intervAssignments.technicalTest.enabled, assignedTo: form.intervAssignments.technicalTest.assignedTo, deadline: form.intervAssignments.technicalTest.deadline || null },
      },
      testPeriod: { start: form.testPeriod.start || null, end: form.testPeriod.end || null } as any,
      status: 'open',
    };
  }

  createJob() {
    if (this.isSubmitting) return;
    this.submitError = null;
    if (!this.form.title.trim()) { this.submitError = 'Job title is required.'; return; }
    if (!this.testPeriodValid)   { this.submitError = 'Test period end date must be after start date.'; return; }
    if (this.form.intervAssignments.rhTest.enabled && !this.form.intervAssignments.rhTest.assignedTo.length) {
      this.submitError = 'Please assign at least one RH interviewer.'; return;
    }
    if (this.form.intervAssignments.technicalTest.enabled && !this.form.intervAssignments.technicalTest.assignedTo.length) {
      this.submitError = 'Please assign at least one technical interviewer.'; return;
    }
    this.isSubmitting = true;
    this.jobOfferService.createJob(this.mapFormToJobOffer(this.form)).subscribe({
      next: (saved) => { this.isSubmitting = false; this.jobCreated.emit((saved as any).job ?? saved as any); this.close(); },
      error: (err: Error) => { this.isSubmitting = false; this.submitError = err.message; },
    });
  }
}
