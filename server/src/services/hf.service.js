'use strict';

/**
 * hf.service.js — Proxy Node.js vers le microservice FastAPI Python
 * ==================================================================
 * Ce fichier est le pont entre le monde Node.js (Express) et le microservice
 * Python (FastAPI sur :8000). Toute la logique IA (lecture PDF, phi4, bge-m3)
 * est déléguée à Python. Ce fichier ne fait que :
 *   1. Formater les requêtes HTTP vers FastAPI
 *   2. Recevoir et mapper les résultats
 *   3. Calculer le score final /100 via la formule pondérée
 */

const { setGlobalDispatcher, Agent } = require('undici');

// Désactive les timeouts internes d'undici pour laisser AbortSignal.timeout()
// gérer seul les délais. phi4 peut prendre 5-10 minutes sur CPU.
setGlobalDispatcher(new Agent({
  headersTimeout: 0,       // pas de timeout sur les headers
  bodyTimeout:    0,       // pas de timeout sur le body
  connectTimeout: 30_000,  // 30s max pour établir la connexion TCP
}));

const HF_API_URL = process.env.HF_API_URL || 'http://localhost:8000'; // NOSONAR

// Logger coloré pour identifier les logs de ce service dans la console
const log = { // NOSONAR
  info:    (...a) => console.log('\x1b[36m[hf.service]\x1b[0m', ...a),   // cyan
  success: (...a) => console.log('\x1b[32m[hf.service]\x1b[0m', ...a),   // vert
  warn:    (...a) => console.warn('\x1b[33m[hf.service]\x1b[0m', ...a),  // jaune
  error:   (...a) => console.error('\x1b[31m[hf.service]\x1b[0m', ...a), // rouge
  section: (t)    => console.log('\x1b[35m[hf.service]\x1b[0m', '─'.repeat(10), t, '─'.repeat(10)),
};


// ═════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Mappe les données extraites par phi4 (format Python) vers le format
 * attendu par le reste de l'application Node.js.
 * Normalise les noms de champs (hard_skills → skills, etc.).
 */
function _mapExtracted(extracted, rawText) {
  if (!extracted) return _emptyCV(rawText);
  return {
    name:            extracted.name           ?? null,
    email:           extracted.email          ?? null,
    phone:           extracted.phone          ?? null,
    location:        extracted.location       ?? null,
    summary:         extracted.summary        ?? null,
    skills:          extracted.hard_skills    ?? extracted.skills ?? [],
    soft_skills:     extracted.soft_skills    ?? [],
    languages:       extracted.languages      ?? [],
    certifications:  extracted.certifications ?? [],
    education:       extracted.education      ?? [],
    experience:      extracted.experience     ?? [],
    yearsExperience: extracted.yearsExperience ?? 0,
    cvRawText:       rawText,
    _embedding:      null,        // embeddings stockés côté Python, pas Node.js
    rawExtracted:    extracted,   // données brutes pour score_prereq_from_extraction
  };
}

/**
 * Retourne une structure CV vide (utilisée en cas d'erreur d'extraction).
 * Évite les crashes downstream si l'extraction échoue.
 */
function _emptyCV(rawText = '') {
  return {
    name: null, email: null, phone: null, location: null, summary: null,
    skills: [], soft_skills: [], languages: [], certifications: [],
    education: [], experience: [], yearsExperience: 0,
    cvRawText: rawText, _embedding: null,
  };
}

/**
 * Détermine le label de recommandation selon le score global.
 * Seuils définis dans le cahier des charges Nexus Peak :
 *   ≥ 75% → Strong match
 *   ≥ 55% → Partial match
 *   < 55% → Weak match
 */
function _computeRecommendation(score) {
  if (score >= 75) return 'Strong match';
  if (score >= 55) return 'Partial match';
  return 'Weak match';
}

/**
 * Calcule le score global à partir des évaluations skills et prérequis.
 *
 * Formule (section 4.4 du rapport) :
 *   Sglobal = α × Scompétences + (1−α) × Sprérequis
 *
 * où :
 *   α            = skillsWeight / 100          (défini par le RH, défaut 60%)
 *   Scompétences = β × Shard + (1−β) × Ssoft  (β = hardSkillsWeight, défaut 70%)
 *   Sprérequis   = moyenne pondérée des prérequis (scoring binaire : présent→1, absent→0)
 *
 * Scoring binaire : present → 1.0, absent → 0.0
 * Chaque item est pondéré par son champ weight.
 */
function _scoreFromEvalues(skillsEval, prereqsEval, _yearsExp, job) {
  const alpha = (job.skillsWeight     ?? 60) / 100;  // poids Skills vs Prérequis
  const beta  = (job.hardSkillsWeight ?? 70) / 100;  // poids Hard vs Soft au sein des Skills

  // Scoring binaire (present → 1.0, absent → 0.0)
  const bin = (item) => (item.present ? 1.0 : 0.0);

  // Séparation hard skills / soft skills
  const hardSkills = (skillsEval || []).filter(s => (s.type || 'TECHNICAL').toUpperCase() !== 'SOFT');
  const softSkills = (skillsEval || []).filter(s => (s.type || 'TECHNICAL').toUpperCase() === 'SOFT');

  /**
   * Moyenne pondérée d'une liste d'items.
   * Si la liste est vide → 1.0 (pas de pénalité pour un critère non défini).
   */
  const weightedAvg = (items) => {
    if (!items.length) return 1.0;
    const totalW = items.reduce((s, x) => s + (x.weight ?? 1), 0) || items.length;
    const earned = items.reduce((s, x) => s + bin(x) * (x.weight ?? 1), 0);
    return earned / totalW;
  };

  const Shard = weightedAvg(hardSkills);
  const Ssoft = weightedAvg(softSkills);

  // Scompétences : combine hard et soft si les deux existent
  const Scompetences = (hardSkills.length && softSkills.length)
    ? beta * Shard + (1 - beta) * Ssoft
    : hardSkills.length ? Shard : Ssoft;

  // Sprérequis : moyenne pondérée des prérequis
  const Sprereqs = (() => {
    if (!prereqsEval?.length) return 1.0;
    const totalW = prereqsEval.reduce((s, p) => s + (p.weight ?? 10), 0) || prereqsEval.length;
    const earned = prereqsEval.reduce((s, p) => s + bin(p) * (p.weight ?? 10), 0);
    return earned / totalW;
  })();

  // Score final arrondi à l'entier
  const globalScore = Math.round((alpha * Scompetences + (1 - alpha) * Sprereqs) * 100);

  // Prérequis obligatoires non satisfaits → blocage automatique
  const blocking      = (prereqsEval || [])
    .filter(p => !p.present && (p.obligatory ?? false))
    .map(p => p.requis);

  // Deduplicate by nom (case-insensitive) keeping the highest-score entry,
  // so a skill listed under multiple types never appears in both matched and missing.
  const _deduped = (() => {
    const seen = new Map();
    for (const s of (skillsEval || [])) {
      const key = (s.nom || '').toLowerCase().trim();
      if (!seen.has(key) || s.score > seen.get(key).score) seen.set(key, s);
    }
    return [...seen.values()];
  })();
  const matchedSkills = _deduped.filter(s => s.present).map(s => s.nom);
  const missingSkills = _deduped.filter(s => !s.present).map(s => s.nom);

  return {
    score:            globalScore,
    matchedSkills,
    missingSkills,
    blockedByPrereqs: blocking,
    prereqDetails:    (prereqsEval || []).map(p => ({
      type:       p.type,
      label:      p.requis,
      obligatory: p.obligatory ?? false,
      matched:    p.present    ?? false,
    })),
    semanticScore:   null,
    experienceScore: null,
    levelScore:      null,
    recommendation:  _computeRecommendation(globalScore),
    analysis:        null,
    scoreBreakdown: {
      skillsWeight:  Math.round(alpha * 100),
      prereqsWeight: Math.round((1 - alpha) * 100),
      skillsScore:   Math.round(Scompetences * 100),
      prereqsScore:  Math.round(Sprereqs * 100),
      hardScore:     Math.round(Shard * 100),
      softScore:     Math.round(Ssoft * 100),
    },
  };
}


// ═════════════════════════════════════════════════════════════════════════════
// API PUBLIQUE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Extrait les entités CV depuis un buffer PDF.
 * Python lit le PDF, exécute phi4 et retourne les données structurées.
 *
 * @param {Buffer}  pdfBuffer - Contenu binaire du fichier PDF
 * @param {Object}  job       - Offre d'emploi (optionnel, pilote le prompt dynamique)
 * @returns {Object} cvMapped - CV structuré + _scoreData si job fourni
 */
async function extractCVFromPDFBuffer(pdfBuffer, job = null) {
  log.section('EXTRACT CV FROM PDF');

  // Formatage des prérequis et skills pour l'API Python
  const jobPrereqs = job
    ? JSON.stringify((job.prerequisites || []).map(p => ({ type: p.type || '', value: p.value || '' })))
    : '[]';
  const jobSkills = job
    ? JSON.stringify((job.skills || []).map(s => ({ nom: s.name || s.nom || '', type: s.type || 'hard' })))
    : '[]';
  const jobId = job ? String(job._id || job.id || '') : '';

  // Envoi multipart/form-data (PDF + métadonnées job)
  const form = new FormData();
  form.append('fichier',           new Blob([pdfBuffer], { type: 'application/pdf' }), 'cv.pdf');
  form.append('job_skills',        jobSkills);
  form.append('job_prerequisites', jobPrereqs);
  form.append('job_id',            jobId);

  try {
    const res = await fetch(`${HF_API_URL}/extract`, {
      method: 'POST',
      body:   form,
      signal: AbortSignal.timeout(900_000), // 15 min max (phi4 sur CPU peut être lent)
    });

    if (!res.ok) {
      log.warn(`Python /extract returned ${res.status} — using empty CV`);
      return _emptyCV('');
    }

    log.info('Reading /extract response body...');
    const data     = await res.json();
    const nSkills  = data.extracted?.hard_skills?.length ?? 0;
    log.success(`/extract parsed OK — hard_skills: ${nSkills}`);

    // Mapping vers le format Node.js
    const mapped = _mapExtracted(data.extracted, data.texte_brut || '');

    // Stockage des évaluations pour scoreFromExtractData (évite un appel HTTP supplémentaire)
    mapped._scoreData = {
      skillsEvalues: data.skills_evalues    || [],
      prereqEvalues: data.prerequis_evalues || [],
    };
    return mapped;
  } catch (err) {
    log.error(`extractCVFromPDFBuffer FAILED (${err.constructor.name}): ${err.message} — using empty CV`);
    return _emptyCV('');
  }
}

/**
 * Extrait les entités CV depuis un texte brut (sans PDF).
 * Utilisé quand le PDF n'est pas disponible (re-scoring depuis texte stocké).
 *
 * @param {string} cvText - Texte brut du CV
 * @returns {Object} cvMapped
 */
async function extractCVData(cvText) {
  log.section('EXTRACT CV DATA');
  try {
    const res = await fetch(`${HF_API_URL}/extract-text`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: cvText }),
      signal:  AbortSignal.timeout(900_000),
    });
    if (!res.ok) return _emptyCV(cvText);
    const data = await res.json();
    log.success('Extraction via FastAPI successful');
    return _mapExtracted(data.extracted, cvText);
  } catch (err) {
    log.warn(`extractCVData failed: ${err.message}`);
    return _emptyCV(cvText);
  }
}

/**
 * Pré-calcule et met en cache les embeddings bge-m3 d'un job côté Python.
 * Appelé une seule fois à la création du job.
 * Retourne null (les embeddings sont stockés en mémoire Python, pas Node.js).
 *
 * @param {Object} job - Offre d'emploi avec skills[] et prerequisites[]
 * @returns {null}
 */
async function encodeJobSkills(job) {
  try {
    const body = {
      job_id:        String(job._id || job.id || ''),
      skills:        (job.skills        || []).map(s => ({ nom: s.name || s.nom || '', type: s.type || 'technical' })),
      prerequisites: (job.prerequisites || []).map(p => ({ type: p.type || '', value: p.value || '' })),
    };
    const res = await fetch(`${HF_API_URL}/index-job`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(60_000),
    });
    if (!res.ok) { log.warn(`/index-job → ${res.status}`); return null; }
    const data = await res.json();
    log.info(`Job indexed: ${data.indexed} items for job ${data.job_id}`);
    return null; // null → le champ MongoDB embedding n'est pas mis à jour
  } catch (err) {
    log.warn(`encodeJobSkills failed: ${err.message}`);
    return null;
  }
}

/**
 * Score un CV pré-extrait contre un job, en utilisant bge-m3 uniquement (pas phi4).
 * Plus rapide que matchCVToJobs car le LLM n'est pas impliqué.
 * Utilisé pour les recommandations de jobs (getRecommendedJobs).
 *
 * @param {Object} cvMapped - CV déjà extrait (résultat de extractCVFromPDFBuffer)
 * @param {Object} job      - Offre d'emploi
 * @returns {Object} résultat de scoring {score, matchedSkills, ...}
 */
async function scoreSkillsForJob(cvMapped, job) {
  const body = {
    cv_hard_skills:    cvMapped.skills       || [],
    cv_soft_skills:    cvMapped.soft_skills  || [],
    cv_raw_text:       cvMapped.cvRawText    || '',
    cv_extracted:      cvMapped.rawExtracted || {},
    job_skills:        (job.skills        || []).map(s => ({
      nom:    s.name   || s.nom  || '',
      type:   s.type   || 'hard',
      weight: s.weight ?? 1,
    })),
    job_prerequisites: (job.prerequisites || []).map(p => ({
      type:  p.type  || '',
      value: p.value || '',
    })),
    job_id: String(job._id || job.id || ''),
  };

  const res = await fetch(`${HF_API_URL}/score-skills`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`/score-skills → ${res.status}`);

  const data = await res.json();

  // Enrichissement des prérequis avec weight et obligatory depuis la définition du job
  const prereqsEval = (data.prerequis_evalues || []).map((p, i) => ({
    ...p,
    weight:     (job.prerequisites || [])[i]?.weight     ?? 10,
    obligatory: (job.prerequisites || [])[i]?.obligatory ?? false,
  }));

  return _scoreFromEvalues(data.skills_evalues, prereqsEval, cvMapped.yearsExperience ?? 0, job);
}

/**
 * Calcule le score depuis les données déjà retournées par /extract.
 * Zéro appel HTTP supplémentaire — utilise _scoreData stocké dans cvMapped.
 * Retourne null si _scoreData n'est pas disponible.
 *
 * @param {Object} cvMapped - CV avec _scoreData (résultat de extractCVFromPDFBuffer avec job)
 * @param {Object} job      - Offre d'emploi
 * @returns {Object|null}
 */
function scoreFromExtractData(cvMapped, job) {
  if (!cvMapped._scoreData) return null;
  const prereqsEval = (cvMapped._scoreData.prereqEvalues || []).map((p, i) => ({
    ...p,
    weight:     (job.prerequisites || [])[i]?.weight     ?? 10,
    obligatory: (job.prerequisites || [])[i]?.obligatory ?? false,
  }));
  return _scoreFromEvalues(
    cvMapped._scoreData.skillsEvalues || [],
    prereqsEval,
    cvMapped.yearsExperience ?? 0,
    job,
  );
}

/**
 * Supprime les embeddings d'un job du cache Python.
 * Appelé à la suppression d'une offre d'emploi.
 *
 * @param {string} jobId - ID MongoDB du job
 */
async function removeJobIndex(jobId) {
  try {
    await fetch(`${HF_API_URL}/index-job/${encodeURIComponent(String(jobId))}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    log.warn(`removeJobIndex failed: ${err.message}`);
  }
}

/**
 * Compare un CV contre plusieurs jobs en parallèle.
 * Deux modes selon la disponibilité du PDF :
 *   - pdfBuffer disponible → POST /extract par job (phi4 + bge-m3, plus précis)
 *   - pdfBuffer absent     → POST /extract-text par job (phi4 + bge-m3 sur texte)
 *
 * Utilise Promise.all pour paralléliser les appels (un appel HTTP par job simultanément).
 *
 * @param {string}        cvText      - Texte brut du CV
 * @param {Array}         jobs        - Liste des offres d'emploi
 * @param {null}          cvEmbedding - Non utilisé (gardé pour compatibilité)
 * @param {Object|null}   cvExtracted - CV extrait (optionnel)
 * @param {Buffer|null}   pdfBuffer   - Buffer PDF (optionnel)
 * @returns {Array} résultats de scoring triés
 */
async function matchCVToJobs(cvText, jobs, cvEmbedding = null, cvExtracted = null, pdfBuffer = null) {
  log.section('MATCH CV TO JOBS');
  if (!jobs?.length) return [];

  const results = await Promise.all(jobs.map(async (job, idx) => {
    const jobSkills = (job.skills || []).map(s => ({
      nom:    s.name   || s.nom  || '',
      type:   s.type   || 'hard',
      weight: s.weight ?? 1,
    }));
    const jobPrereqs = (job.prerequisites || []).map(p => ({
      type:  p.type  || '',
      value: p.value || '',
    }));
    const jobId = String(job._id || job.id || '');

    try {
      let data;

      if (pdfBuffer) {
        // Mode PDF : extraction complète phi4 pour chaque job
        const form = new FormData();
        form.append('fichier',           new Blob([pdfBuffer], { type: 'application/pdf' }), 'cv.pdf');
        form.append('job_skills',        JSON.stringify(jobSkills));
        form.append('job_prerequisites', JSON.stringify(jobPrereqs));
        form.append('job_id',            jobId);
        const res = await fetch(`${HF_API_URL}/extract`, {
          method: 'POST', body: form, signal: AbortSignal.timeout(900_000),
        });
        if (!res.ok) throw new Error(`/extract → ${res.status}`);
        data = await res.json();
      } else {
        // Mode texte : phi4 sur texte brut stocké
        const res = await fetch(`${HF_API_URL}/extract-text`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            text:              cvText || '',
            job_skills:        jobSkills,
            job_prerequisites: jobPrereqs,
            job_id:            jobId,
          }),
          signal: AbortSignal.timeout(900_000),
        });
        if (!res.ok) throw new Error(`/extract-text → ${res.status}`);
        data = await res.json();
      }

      const yearsExp = data.extracted?.yearsExperience ?? cvExtracted?.yearsExperience ?? 0;

      // Enrichissement des prérequis avec weight + obligatory
      const prereqsEval = (data.prerequis_evalues || []).map((p, i) => ({
        ...p,
        weight:     (job.prerequisites || [])[i]?.weight     ?? 10,
        obligatory: (job.prerequisites || [])[i]?.obligatory ?? false,
      }));

      return {
        jobIndex: idx,
        ...(_scoreFromEvalues(data.skills_evalues, prereqsEval, yearsExp, job)),
      };
    } catch (err) {
      log.warn(`matchCVToJobs job[${idx}] failed: ${err.message}`);
      return null;
    }
  }));

  return results.filter(Boolean);
}

module.exports = {
  encodeJobSkills,
  extractCVData,
  extractCVFromPDFBuffer,
  matchCVToJobs,
  removeJobIndex,
  scoreFromExtractData,
  scoreSkillsForJob,
};