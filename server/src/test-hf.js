'use strict';
/**
 * test-hf.js — diagnostic complet de hf.service.js
 * Lancez depuis le dossier server/ :  node test-hf.js
 */

require('dotenv').config();

const HF_TOKEN = process.env.HF_API_TOKEN || '';
console.log('\n── Diagnostic hf.service ──────────────────────────────');
console.log('HF_API_TOKEN :', HF_TOKEN ? `✅ présent (${HF_TOKEN.slice(0,8)}...)` : '❌ MANQUANT dans .env');

// ── fetch disponible ? ──────────────────────────────────────────────────────
let _fetch;
if (typeof fetch !== 'undefined') {
  _fetch = fetch;
  console.log('fetch        : ✅ natif (Node >= 18)');
} else {
  try {
    _fetch = require('node-fetch');
    console.log('fetch        : ✅ node-fetch installé');
  } catch {
    console.log('fetch        : ❌ node-fetch manquant → npm install node-fetch@2');
    process.exit(1);
  }
}

// ── Test 1 : QA model ───────────────────────────────────────────────────────
async function testQA() {
  console.log('\n[Test 1] QA model (deepset/roberta-base-squad2)');
  const url = 'https://api-inference.huggingface.co/models/deepset/roberta-base-squad2';
  const payload = {
    inputs: {
      question: 'What is the full name of the candidate?',
      context:  'John Doe is a software engineer based in Paris. Email: john@example.com. Phone: +33 6 12 34 56 78.'
    }
  };
  try {
    const res = await _fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {})
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) {
      console.log('  ❌ Erreur API :', data.error);
      if (data.error.includes('loading')) console.log('  ℹ️  Modèle en chargement, réessayez dans 30s');
    } else {
      console.log('  ✅ Réponse :', JSON.stringify(data));
    }
  } catch (err) {
    console.log('  ❌ Erreur réseau :', err.message);
  }
}

// ── Test 2 : Embedding model ────────────────────────────────────────────────
async function testEmbedding() {
  console.log('\n[Test 2] Embedding model (all-MiniLM-L6-v2)');
  const url = 'https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2';
  const payload = { inputs: ['Software engineer with 3 years experience in Node.js'] };
  try {
    const res = await _fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {})
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) {
      console.log('  ❌ Erreur API :', data.error);
      if (data.error.includes('loading')) console.log('  ℹ️  Modèle en chargement, réessayez dans 30s');
    } else if (Array.isArray(data)) {
      console.log(`  ✅ Embedding reçu : vecteur de ${data[0]?.length ?? '?'} dimensions`);
    } else {
      console.log('  ⚠️  Réponse inattendue :', JSON.stringify(data).slice(0, 200));
    }
  } catch (err) {
    console.log('  ❌ Erreur réseau :', err.message);
  }
}

// ── Test 3 : extractCVData ──────────────────────────────────────────────────
async function testExtract() {
  console.log('\n[Test 3] extractCVData() avec un CV fictif');

  // Simule le service sans require('../services/hf.service')
  // pour éviter les problèmes de chemin
  const cvText = `
Rahma Sahnouni
rahmasahnouni704@gmail.com
+216 55 123 456
Tunis, Tunisia

Développeuse Full Stack avec 2 ans d'expérience.

Compétences : Angular, Node.js, MongoDB, Express, TypeScript, HTML, CSS

Langues : Français, Anglais, Arabe

Formation :
Master Informatique - Université de Tunis - 2023

Expérience :
Développeuse Web - TechCorp - 2022-2024
Développement d'applications Angular et Node.js
  `;

  // Regex rapide pour vérifier sans appel API
  const emailMatch = cvText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = cvText.match(/(\+?\d[\d\s\-().]{7,}\d)/);
  const skillsBlock = cvText.match(/(?:skills?|compétences?)[:\s]+([\s\S]{0,400})/i);
  const skills = skillsBlock ? skillsBlock[1].split(/[,;\n•|\/]/).map(s => s.trim()).filter(s => s.length > 1 && s.length < 60).slice(0, 15) : [];

  console.log('  Email trouvé    :', emailMatch?.[0] || '❌ rien');
  console.log('  Téléphone trouvé:', phoneMatch?.[0] || '❌ rien');
  console.log('  Skills trouvés  :', skills.length ? skills.join(', ') : '❌ rien');

  if (skills.length > 0 && emailMatch) {
    console.log('  ✅ Extraction regex OK — les données de base seraient extraites');
  } else {
    console.log('  ⚠️  Extraction regex partielle');
  }
}

// ── Test 4 : PDF lisible ? ──────────────────────────────────────────────────
async function testPDF() {
  console.log('\n[Test 4] Lecture PDF (pdf-parse disponible ?)');
  try {
    const pdfParse = require('pdf-parse');
    console.log('  ✅ pdf-parse installé');

    const fs   = require('fs');
    const path = require('path');

    // Cherche un PDF dans uploads/cvs/
    const uploadsDir = path.join(__dirname, 'src', 'uploads', 'cvs');
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.pdf'));
      if (files.length) {
        const pdfPath = path.join(uploadsDir, files[0]);
        const buffer  = fs.readFileSync(pdfPath);
        const data    = await pdfParse(buffer);
        const preview = data.text?.trim().slice(0, 200);
        console.log('  PDF trouvé      :', files[0]);
        console.log('  Texte extrait   :', preview?.length ? `✅ ${data.text.length} chars` : '❌ vide');
        if (preview) console.log('  Aperçu         :', preview.replace(/\n/g, ' '));
      } else {
        console.log('  ⚠️  Aucun PDF dans src/uploads/cvs/');
      }
    } else {
      console.log('  ⚠️  Dossier src/uploads/cvs/ introuvable');
    }
  } catch (err) {
    console.log('  ❌ pdf-parse :', err.message);
  }
}

// ── Run all tests ────────────────────────────────────────────────────────────
(async () => {
  await testQA();
  await testEmbedding();
  await testExtract();
  await testPDF();
  console.log('\n── Fin du diagnostic ───────────────────────────────────\n');
})();