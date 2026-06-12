'use strict';

/**
 * hf.service.js — Version allégée et anti-hallucination
 * Délègue la majeure partie de l'extraction à FastAPI
 */

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const HF_API_URL = process.env.HF_API_URL || 'http://localhost:8000';

const log = {
  info: (...a) => console.log('\x1b[36m[hf.service]\x1b[0m', ...a),
  success: (...a) => console.log('\x1b[32m[hf.service]\x1b[0m', ...a),
  warn: (...a) => console.warn('\x1b[33m[hf.service]\x1b[0m', ...a),
  error: (...a) => console.error('\x1b[31m[hf.service]\x1b[0m', ...a),
  section: (title) => console.log('\x1b[35m[hf.service]\x1b[0m', '─'.repeat(10), title, '─'.repeat(10)),
};

// ─── Extraction texte depuis PDF avec détection colonnes ──────────────────────
async function extractTextFromPDFBuffer(pdfBuffer) {
  log.section('PDF TEXT EXTRACTION');
  let text = '';
  try {
    const uint8Array = new Uint8Array(pdfBuffer);
    const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });
      const content = await page.getTextContent();
      const blocks = content.items
        .filter(item => item.str && item.str.trim())
        .map(item => ({ text: item.str, x: item.transform[4], y: viewport.height - item.transform[5] }));
      if (!blocks.length) continue;
      const midX = viewport.width / 2;
      const left = blocks.filter(b => b.x < midX).sort((a,b) => a.y - b.y);
      const right = blocks.filter(b => b.x >= midX).sort((a,b) => a.y - b.y);
      const isMulti = left.length > 5 && right.length > 5;
      const groupByLine = (arr, tol=3) => {
        const lines = [];
        for (const b of arr) {
          const last = lines[lines.length-1];
          if (last && Math.abs(b.y - last[0].y) <= tol) last.push(b);
          else lines.push([b]);
        }
        return lines.map(l => l.sort((a,b)=>a.x-b.x).map(b=>b.text).join(' '));
      };
      let pageText = '';
      if (isMulti) {
        pageText = [...groupByLine(left), '', ...groupByLine(right)].join('\n');
      } else {
        const all = blocks.sort((a,b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
        pageText = groupByLine(all).join('\n');
      }
      text += pageText + '\n\n';
    }
  } catch (err) {
    log.warn(`pdfjs failed: ${err.message}, fallback to pdf-parse`);
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(pdfBuffer);
      text = data.text || '';
    } catch (e2) { log.error(`pdf-parse failed: ${e2.message}`); }
  }
  if (!text || text.trim().length < 50) {
    log.warn('Text too short → OCR');
    const ocr = await _extractViaOCR(pdfBuffer);
    if (ocr.ocr_text) text = ocr.ocr_text;
  }
  return text;
}

async function _extractViaOCR(pdfBuffer) {
  const formData = new FormData();
  formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'cv.pdf');
  try {
    const res = await fetch(`${HF_API_URL}/extract-from-pdf`, { method: 'POST', body: formData, signal: AbortSignal.timeout(300000) });
    if (!res.ok) return {};
    const data = await res.json();
    return { extracted: data.entities, embedding: data.embedding, ocr_text: data.ocr_text };
  } catch (err) {
    return {};
  }
}

async function _extractViaFastAPI(cvText) {
  try {
    const res = await fetch(`${HF_API_URL}/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cvText.slice(0, 8000) }),
      signal: AbortSignal.timeout(300000),
    });
    if (!res.ok) return { extracted: null, embedding: null };
    const data = await res.json();
    return { extracted: data.entities, embedding: data.embedding };
  } catch (err) {
    return { extracted: null, embedding: null };
  }
}

async function extractCVData(cvText) {
  log.section('EXTRACT CV DATA');
  const { extracted, embedding } = await _extractViaFastAPI(cvText);
  if (extracted) {
    log.success('Extraction via FastAPI successful');
    return { ...extracted, cvRawText: cvText, _embedding: embedding };
  } else {
    log.warn('FastAPI extraction failed, returning empty');
    return { name: null, email: null, phone: null, skills: [], languages: [], education: [], experience: [], yearsExperience: 0, cvRawText: cvText };
  }
}

async function extractCVFromPDFBuffer(pdfBuffer) {
  const text = await extractTextFromPDFBuffer(pdfBuffer);
  if (!text || text.trim().length < 50) throw new Error('Could not extract text from PDF');
  return extractCVData(text);
}

async function encodeJobSkills(job) {
  try {
    const res = await fetch(`${HF_API_URL}/encode-job`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: job.title, department: job.department || '', description: job.description || '',
        skills: (job.skills || []).map(s => ({ name: s.name, weight: s.weight ?? 1 })),
        prerequisites: (job.prerequisites || []).map(p => p.value || p.customLabel || ''),
        experienceLevel: job.experienceLevel || '',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.embedding;
  } catch (err) { return null; }
}

function _cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? Math.round((dot / (Math.sqrt(na) * Math.sqrt(nb))) * 100) : 0;
}

function _softMatch(text, keyword) {
  if (!text || !keyword) return false;
  const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = normalize(text), kw = normalize(keyword);
  return t.includes(kw) || kw.includes(t);
}

async function matchCVToJobs(cvText, jobs, cvEmbedding = null) {
  log.section('MATCH CV TO JOBS');
  let embed = cvEmbedding;
  if (!embed) {
    const { embedding } = await _extractViaFastAPI(cvText);
    embed = embedding;
  }
  const cv = await extractCVData(cvText);
  const results = await Promise.all(jobs.map(async (job, idx) => {
    try {
      // Skills score
      let skillScore = 100, matched = [], missing = [];
      if (job.skills?.length) {
        let totalWeight = 0, earned = 0;
        for (const js of job.skills) {
          const w = js.weight ?? 1;
          totalWeight += w;
          const found = cv.skills.some(cs => _softMatch(cs, js.name));
          if (found) { matched.push(js.name); earned += w; }
          else missing.push(js.name);
        }
        skillScore = totalWeight ? Math.round((earned / totalWeight) * 100) : 100;
      }
      // Prerequisites (simplifié)
      let prereqScore = 100, blocking = [];
      if (job.prerequisites?.length) {
        let total = 0, earned = 0;
        for (const p of job.prerequisites) {
          const w = p.obligatory ? 2 : 1;
          total += w;
          let ok = false;
          if (p.type === 'Experience') ok = (cv.yearsExperience >= parseInt(p.value,10));
          else if (p.type === 'Language') {
            const codeMap = { english:'en', french:'fr', arabic:'ar', spanish:'es', german:'de', italian:'it' };
            const norm = p.value.toLowerCase();
            let expCode = null;
            for (const [k,code] of Object.entries(codeMap)) if (norm.includes(k)) expCode = code;
            ok = cv.languages.some(l => l.code === expCode);
          } else ok = true;
          if (ok) earned += w;
          else if (p.obligatory) blocking.push(p.value);
        }
        prereqScore = total ? Math.round((earned/total)*100) : 100;
      }
      // Semantic score
      let semScore = 50;
      if (embed) {
        let jobEmbed = job.embedding;
        if (!jobEmbed) jobEmbed = await encodeJobSkills(job);
        if (jobEmbed) semScore = _cosineSimilarity(embed, jobEmbed);
      }
      // Experience score
      const levels = {
        'Junior (0-2 years)': [0,2], 'Mid-level (3-5 years)': [3,5],
        'Senior (5-8 years)': [5,8], 'Lead / Staff (8+ years)': [8,15]
      };
      const range = levels[job.experienceLevel];
      let expScore = 50;
      if (range) {
        expScore = cv.yearsExperience >= range[0] && cv.yearsExperience <= range[1] ? 100 :
                   Math.max(0, 100 - Math.abs(cv.yearsExperience - (range[0]+range[1])/2)*15);
      }
      const globalScore = Math.round(skillScore*0.4 + prereqScore*0.35 + semScore*0.15 + expScore*0.1);
      // LLM analysis
      let analysis = null;
      try {
        const res = await fetch(`${HF_API_URL}/analyze`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cv: cvText.slice(0,1200), job: [job.title, job.description].join('\n'), score: globalScore }),
          signal: AbortSignal.timeout(50000),
        });
        const data = await res.json();
        analysis = data.analysis;
      } catch(e) {}
      return {
        jobIndex: idx, score: globalScore, matchedSkills: matched, missingSkills: missing,
        blockedByPrereqs: blocking, semanticScore: semScore, experienceScore: expScore,
        analysis, recommendation: globalScore >= 75 ? 'Strong match' : (globalScore >= 55 ? 'Partial match' : 'Weak match')
      };
    } catch(e) { return null; }
  }));
  return results.filter(Boolean);
}

module.exports = { encodeJobSkills, extractCVData, extractCVFromPDFBuffer, matchCVToJobs };