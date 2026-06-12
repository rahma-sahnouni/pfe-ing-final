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
}
export interface Skill {
  id: number; name: string; minLevel: number; weight: number; obligatory: boolean;
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
  prerequisites: Prerequisite[]; skills: Skill[];
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

  customMode: Record<string | number, string> = {
    1: 'AWS Certified Developer – Associate',
    2: 'English (C1 – Advanced)',
    '3_role': '',
  };

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
    prerequisites: [
      { id: 1, icon: 'verified', type: 'Certification', value: 'AWS Certified Developer – Associate', obligatory: true },
      { id: 2, icon: 'translate', type: 'Language',      value: 'English (C1 – Advanced)',            obligatory: true },
      { id: 3, icon: 'work',      type: 'Experience',    value: '5', role: '',                         obligatory: true },
    ],
    skills: [
      { id: 1, name: 'Angular',         minLevel: 3, weight: 25, obligatory: true  },
      { id: 2, name: 'TypeScript',      minLevel: 4, weight: 20, obligatory: true  },
      { id: 3, name: 'REST API Design', minLevel: 3, weight: 15, obligatory: false },
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

  /* ─── Dropdown Options ─── */
  prereqTypes  = ['Certification', 'Language', 'Experience', 'Education', 'Location', 'Custom'];
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

  suggestedSkills: Record<string, string[]> = {
    Engineering: [
      'JavaScript / TypeScript', 'Python', 'Java', 'Go', 'Rust', 'C++', 'Node.js', 'React', 'Angular', 'Vue.js',
      'Next.js', 'NestJS', 'Spring Boot', 'Django / FastAPI', 'GraphQL', 'REST API Design', 'PostgreSQL',
      'MongoDB', 'Redis', 'Docker', 'Kubernetes', 'CI/CD (GitHub Actions / GitLab CI)', 'AWS / GCP / Azure',
      'Terraform', 'Microservices Architecture', 'System Design', 'Algorithm & Data Structures',
    ],
    Data: [
      'Python (pandas / NumPy)', 'SQL (advanced)', 'Apache Spark', 'dbt', 'Airflow', 'Kafka',
      'Tableau / Power BI', 'Machine Learning (scikit-learn)', 'Deep Learning (PyTorch / TensorFlow)',
      'Statistics & Probability', 'Data Warehousing (Snowflake / BigQuery)', 'ETL Pipeline Design',
    ],
    Security: [
      'Penetration Testing', 'SIEM / SOC Tools', 'Network Security', 'OWASP Top 10', 'Cryptography',
      'Incident Response', 'Cloud Security (AWS / Azure)', 'Zero Trust Architecture',
    ],
    Design: [
      'Figma', 'Design Systems', 'User Research', 'Prototyping', 'Accessibility (WCAG)',
      'Motion Design', 'Illustration', 'Adobe Creative Suite',
    ],
  };

  testNameSuggestions: Record<string, string[]> = {
    'MCQ': [
      'JavaScript & TypeScript Fundamentals', 'System Design Concepts', 'Cloud & DevOps Knowledge',
      'Algorithms & Data Structures', 'Security Best Practices', 'Database & SQL Knowledge',
      'Agile & Scrum Methodology',
    ],
    'Coding Challenge': [
      'Algorithmic Problem Solving (LeetCode-style)', 'API Integration Challenge', 'Refactoring Legacy Code',
      'Build a REST API (Node.js)', 'Data Pipeline Implementation', 'Frontend Component Challenge',
    ],
    'Case Study': [
      'Architecture Design Review', 'Product Strategy Analysis', 'Incident Post-Mortem Analysis',
      'Security Audit Case Study',
    ],
    'Live Coding': [
      'Pair Programming Session', 'Debugging & Code Review', 'Live Frontend Implementation',
      'Live SQL Query Optimization',
    ],
    'System Design': [
      'Design a Scalable URL Shortener', 'Design a Real-Time Chat System', 'Design a CI/CD Pipeline',
      'Design a Multi-Tenant SaaS Architecture',
    ],
    'Take-Home Project': [
      'Build a Full-Stack Mini App (48h)', 'Data Analysis Report (open dataset)', 'Security Assessment Report',
    ],
  };

  constructor(
    private jobOfferService: JobOfferService,
    private userService:     UserService,
  ) {}

  /* ─── Prereq Handlers ─── */
  onSelectChange(prereq: Prerequisite, selected: string) {
    if (selected !== '__other__') prereq.value = selected;
  }
  onRoleSelectChange(prereq: Prerequisite, selected: string) {
    if (selected !== '__other__') prereq.role = selected;
  }
  onPrereqTypeChange(prereq: Prerequisite) {
    prereq.icon = this.prereqIcons[prereq.type] || 'check_circle';
    prereq.role = undefined;
    prereq.customLabel = undefined;
    delete this.customMode[prereq.id + '_role'];
    const defaults: Record<string, string> = {
      Language: 'English (C1 – Advanced)', Education: "Bachelor's Degree in Computer Science",
      Location: 'Based in Tunisia (on-site)', Certification: 'AWS Certified Developer – Associate', Custom: '',
    };
    if (prereq.type === 'Experience') {
      prereq.value = '3'; prereq.role = '';
      this.customMode[prereq.id + '_role'] = '';
    } else {
      prereq.value = defaults[prereq.type] || '';
      if (prereq.type !== 'Custom') this.customMode[prereq.id] = prereq.value;
    }
  }

  /* ─── Computed ─── */
  get totalWeight(): number { return this.form.skills.reduce((s, sk) => s + sk.weight, 0); }
  get essentialSkills(): number { return this.form.skills.filter(s => s.obligatory).length; }
  get avgCompetency(): string {
    if (!this.form.skills.length) return '0.0';
    return (this.form.skills.reduce((s, sk) => s + sk.minLevel, 0) / this.form.skills.length).toFixed(1);
  }

  /* ─── Navigation ─── */
  next() { if (this.currentStep < this.totalSteps) this.currentStep++; }
  previous() { if (this.currentStep > 1) this.currentStep--; }
  close() { this.closed.emit(); }

  /* ─── Prerequisites CRUD ─── */
  addPrerequisite() {
    const newId = Date.now();
    const defaultVal = 'AWS Certified Developer – Associate';
    this.customMode[newId] = defaultVal;
    this.form.prerequisites.push({ id: newId, icon: 'verified', type: 'Certification', value: defaultVal, obligatory: false });
  }
  removePrerequisite(id: number) {
    this.form.prerequisites = this.form.prerequisites.filter(p => p.id !== id);
    delete this.customMode[id];
    delete this.customMode[id + '_role'];
  }

  /* ─── Skills CRUD ─── */
  addSkill() { this.form.skills.push({ id: Date.now(), name: '', minLevel: 3, weight: 0, obligatory: false }); }
  addSuggestedSkill(name: string) {
    if (!this.form.skills.some(s => s.name === name)) {
      this.form.skills.push({ id: Date.now(), name, minLevel: 3, weight: 10, obligatory: false });
    }
  }
  removeSkill(id: number) { this.form.skills = this.form.skills.filter(s => s.id !== id); }
  get currentSuggestions(): string[] {
    return (this.suggestedSkills[this.form.department] || this.suggestedSkills['Engineering'])
      .filter(s => !this.form.skills.some(sk => sk.name === s));
  }

  /* ─── Test period helpers ─── */
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

  /* ─── Gestion des assignations de TESTS ─── */
  availableAgents: UserApi[] = [];
  ngOnInit() {
    this.userService.getUsers().subscribe(agents => this.availableAgents = agents);
  }
  getAgentLabel(uid: string): string {
    const agent = this.availableAgents.find(a => a.id === uid);
    return agent ? (agent.name ?? agent.email) : uid;
  }
  addAssignee(type: 'rh' | 'tech', event: Event) {
    const uid = (event.target as HTMLSelectElement).value;
    if (!uid) return;
    const target = type === 'rh' ? this.form.testAssignments.rhTest : this.form.testAssignments.technicalTest;
    if (!target.assignedTo.includes(uid)) target.assignedTo.push(uid);
    (event.target as HTMLSelectElement).value = '';
  }
  removeAssignee(type: 'rh' | 'tech', uid: string) {
    const target = type === 'rh' ? this.form.testAssignments.rhTest : this.form.testAssignments.technicalTest;
    target.assignedTo = target.assignedTo.filter(id => id !== uid);
  }
  getUnassigned(type: 'rh' | 'tech'): UserApi[] {
    const already = type === 'rh' ? this.form.testAssignments.rhTest.assignedTo : this.form.testAssignments.technicalTest.assignedTo;
    return this.availableAgents.filter(a => !already.includes(a.id));
  }

  /* ─── Gestion des assignations d'INTERVIEW ─── */
  addInterviewAssignee(type: 'rh' | 'tech', event: Event) {
    const uid = (event.target as HTMLSelectElement).value;
    if (!uid) return;
    const target = type === 'rh' ? this.form.intervAssignments.rhTest : this.form.intervAssignments.technicalTest;
    if (!target.assignedTo.includes(uid)) target.assignedTo.push(uid);
    (event.target as HTMLSelectElement).value = '';
  }
  removeInterviewAssignee(type: 'rh' | 'tech', uid: string) {
    const target = type === 'rh' ? this.form.intervAssignments.rhTest : this.form.intervAssignments.technicalTest;
    target.assignedTo = target.assignedTo.filter(id => id !== uid);
  }
  getUnassignedInterviewers(type: 'rh' | 'tech'): UserApi[] {
    const already = type === 'rh' ? this.form.intervAssignments.rhTest.assignedTo : this.form.intervAssignments.technicalTest.assignedTo;
    return this.availableAgents.filter(a => !already.includes(a.id));
  }

  /* ─── Submit ─── */
  private mapFormToJobOffer(form: NewJobForm): JobOffer {
    return {
      title:           form.title,
      department:      form.department as JobOffer['department'],
      location:        form.location,
      contractType:    form.contractType as JobOffer['contractType'],
      experienceLevel: form.experienceLevel as JobOffer['experienceLevel'],
      description:     form.description,
      prerequisites:   form.prerequisites.map(({ id, ...rest }) => rest) as any,
      skills:          form.skills.map(({ id, ...rest }) => rest) as any,
      tests:           form.tests.map(({ id, ...rest }) => rest) as any,
      stages:          form.stages.map(({ id, ...rest }) => rest) as any,
      testAssignments: {
        rhTest: {
          enabled:    form.testAssignments.rhTest.enabled,
          assignedTo: form.testAssignments.rhTest.assignedTo,
          deadline:   form.testAssignments.rhTest.deadline || null,
        },
        technicalTest: {
          enabled:    form.testAssignments.technicalTest.enabled,
          assignedTo: form.testAssignments.technicalTest.assignedTo,
          deadline:   form.testAssignments.technicalTest.deadline || null,
        },
      },
      intervAssignments: {
        rhTest: {
          enabled:    form.intervAssignments.rhTest.enabled,
          assignedTo: form.intervAssignments.rhTest.assignedTo,
          deadline:   form.intervAssignments.rhTest.deadline || null,
        },
        technicalTest: {
          enabled:    form.intervAssignments.technicalTest.enabled,
          assignedTo: form.intervAssignments.technicalTest.assignedTo,
          deadline:   form.intervAssignments.technicalTest.deadline || null,
        },
      },
      testPeriod: {
        start: form.testPeriod.start || null,
        end:   form.testPeriod.end   || null,
      } as any,
      status: 'open',
    };
  }

  createJob() {
    if (this.isSubmitting) return;
    this.submitError = null;

    if (!this.form.title.trim()) {
      this.submitError = 'Job title is required.';
      return;
    }
    if (!this.testPeriodValid) {
      this.submitError = 'Test period end date must be after start date.';
      return;
    }
    // Validation des assignations d'interview
    if (this.form.intervAssignments.rhTest.enabled && this.form.intervAssignments.rhTest.assignedTo.length === 0) {
      this.submitError = 'Please assign at least one RH interviewer.';
      return;
    }
    if (this.form.intervAssignments.technicalTest.enabled && this.form.intervAssignments.technicalTest.assignedTo.length === 0) {
      this.submitError = 'Please assign at least one technical interviewer.';
      return;
    }

    this.isSubmitting = true;
    const payload = this.mapFormToJobOffer(this.form);

    this.jobOfferService.createJob(payload).subscribe({
      next: (savedJob) => {
        this.isSubmitting = false;
        this.jobCreated.emit(savedJob as any);
        this.close();
      },
      error: (err: Error) => {
        this.isSubmitting = false;
        this.submitError  = err.message;
      },
    });
  }
  // Pour l'interview RH (méthodes spécifiques)
addRhInterviewAssignee(event: Event) {
  this.addInterviewAssignee('rh', event);
}
removeRhInterviewAssignee(uid: string) {
  this.removeInterviewAssignee('rh', uid);
}
getUnassignedRhInterviewers(): UserApi[] {
  return this.getUnassignedInterviewers('rh');
}

// Pour l'interview Technique
addTechInterviewAssignee(event: Event) {
  this.addInterviewAssignee('tech', event);
}
removeTechInterviewAssignee(uid: string) {
  this.removeInterviewAssignee('tech', uid);
}
getUnassignedTechInterviewers(): UserApi[] {
  return this.getUnassignedInterviewers('tech');
}
}