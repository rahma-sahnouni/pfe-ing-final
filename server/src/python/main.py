"""
FastAPI - Port 8000
Extraction CV via LLM (qwen2.5:3b) + Embedding JobBERT + OCR pour PDF scannés
Version stable sans 'format: json' (compatible tous modèles)
"""

import os
import re
import json
import logging
import httpx
from typing import Optional, List
from datetime import datetime

from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import pytesseract
from pdf2image import convert_from_bytes

# ── Config ────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

OLLAMA_URL       = os.getenv("OLLAMA_URL",       "http://localhost:11434")
EXTRACTION_MODEL = os.getenv("EXTRACTION_MODEL", "qwen2.5:3b")
ANALYSIS_MODEL   = os.getenv("ANALYSIS_MODEL",   "llama3.2")
POPPLER_PATH     = r"C:\poppler\poppler-26.02.0\Library\bin"
OCR_MIN_CHARS    = 100

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="HireFlow AI Service")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Embedding ─────────────────────────────────────────────────────────────────
embedding_model = None
try:
    from sentence_transformers import SentenceTransformer
    embedding_model = SentenceTransformer(os.getenv("EMBEDDING_MODEL", "jjzha/jobbert-base-cased"))
    logger.info("JobBERT loaded")
except Exception as e:
    logger.warning(f"Embedding model failed: {e}")

# ── Schémas ───────────────────────────────────────────────────────────────────
class EncodeJobRequest(BaseModel):
    title: str
    department: Optional[str] = ""
    description: Optional[str] = ""
    skills: Optional[List[dict]] = []
    prerequisites: Optional[List[str]] = []
    experienceLevel: Optional[str] = ""

class ExtractRequest(BaseModel):
    text: str

class AnalyzeRequest(BaseModel):
    cv: str
    job: str
    score: int

# ── Helpers embedding ─────────────────────────────────────────────────────────
def _get_embedding(text: str):
    if not embedding_model:
        return None
    try:
        return embedding_model.encode(text, normalize_embeddings=True).tolist()
    except Exception:
        return None

# ── Regex fallback simples ────────────────────────────────────────────────────
def _extract_email(text):
    m = re.search(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', text)
    return m.group(0) if m else None

def _extract_phone(text):
    text_no_years = re.sub(r'\b(19|20)\d{2}\b', '', text)
    m = re.search(r'(\+?\d[\d\s\-().]{7,14}\d)', text_no_years)
    return m.group(1).strip() if m else None

def _extract_name(text):
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    name_pattern = re.compile(r'^[A-ZÀÂÉÈÊËÎÏÔÙÛÜÆŒ][a-zA-ZÀ-ÿ\-]+(?: [A-ZÀÂÉÈÊËÎÏÔÙÛÜÆŒ][a-zA-ZÀ-ÿ\-]+){1,2}$')
    for line in lines[:15]:
        if name_pattern.match(line) and not re.search(r'\d', line):
            return line
    return None

# ─── Extraction forcée des compétences depuis le texte brut (liste statique) ───
KNOWN_TECH_KEYWORDS = [
    'Python','Java','JavaScript','TypeScript','C#','C++','Go','Rust','PHP','Ruby','Swift','Kotlin','Scala','R','MATLAB',
    'Angular','React','Vue','Vue.js','Next.js','Svelte','jQuery','Bootstrap','Tailwind','HTML','CSS','SASS','Redux',
    'Node.js','Express','NestJS','Django','Flask','FastAPI','Spring','Spring Boot','Laravel','Rails',
    'MongoDB','MySQL','PostgreSQL','SQLite','Oracle','Redis','Elasticsearch','Cassandra','Firebase','Supabase','SQLServer',
    'Docker','Kubernetes','Terraform','Jenkins','GitHub Actions','AWS','Azure','GCP','Heroku','Nginx','Apache',
    'Git','GitHub','GitLab','Jira','Postman','Swagger','Linux',
    'TensorFlow','PyTorch','scikit-learn','Keras','OpenCV','Pandas','NumPy','Matplotlib','Spark','Hadoop','Kafka',
    'React Native','Flutter','Android','iOS','GraphQL','REST','Microservices','Blockchain','Solidity','UML','BPMN','Scrum','Agile','Arduino'
]

def _extract_skills_from_text(text):
    found = set()
    lower = text.lower()
    for kw in KNOWN_TECH_KEYWORDS:
        if re.search(r'\b' + re.escape(kw.lower()) + r'\b', lower):
            found.add(kw)
    return list(found)

# ─── Extraction langues sans niveaux inventés ─────────────────────────────────
def _extract_languages_from_text(text):
    lang_map = {
        'français': ('Français', 'fr'), 'francais': ('Français', 'fr'), 'french': ('Français', 'fr'),
        'anglais': ('Anglais', 'en'), 'english': ('Anglais', 'en'),
        'arabe': ('Arabe', 'ar'), 'arabic': ('Arabe', 'ar'),
        'espagnol': ('Espagnol', 'es'), 'spanish': ('Espagnol', 'es'),
        'allemand': ('Allemand', 'de'), 'german': ('Allemand', 'de'),
        'italien': ('Italien', 'it'), 'italian': ('Italien', 'it'),
    }
    found = []
    lower = text.lower()
    for key, (name, code) in lang_map.items():
        if key in lower:
            idx = lower.find(key)
            context = lower[max(0, idx-50):idx+50]
            level_match = re.search(r'\b([abc][12])\b', context)
            level = level_match.group(1).upper() if level_match else None
            found.append({'name': name, 'code': code, 'level': level})
    unique = {}
    for l in found:
        if l['code'] not in unique:
            unique[l['code']] = l
    return list(unique.values())

# ─── Extraction certifications (sans hallucination) ────────────────────────────
def _extract_certifications_from_text(text):
    certs = []
    patterns = [
        r'certificat\s+([^\n]{5,80})',
        r'certification\s+([^\n]{5,80})',
        r'([A-Z][a-z]+ (?:certification|certificat)[^\n]{5,80})',
    ]
    for pat in patterns:
        for match in re.finditer(pat, text, re.IGNORECASE):
            cert = match.group(1).strip()
            if cert and len(cert) < 100:
                certs.append(cert)
    seen = set()
    unique = []
    for c in certs:
        if c.lower() not in seen and not re.match(r'^certificat\s*$', c.lower()):
            seen.add(c.lower())
            unique.append(c)
    return unique[:10]

# ─── Extraction éducation (reconnaissance des diplômes standards) ──────────────
def _extract_education_from_text(text):
    edu = []
    degree_patterns = [
        (r'cycle ingénieur[^\n]*', 'Cycle ingénieur'),
        (r'mastère[^\n]*', 'Mastère'),
        (r'master[^\n]*', 'Master'),
        (r'licence[^\n]*', 'Licence'),
        (r'bac(?:calauréat)?[^\n]*', 'Bac'),
        (r'diplôme[^\n]*', 'Diplôme'),
        (r'doctorat[^\n]*', 'Doctorat'),
    ]
    lines = text.split('\n')
    for i, line in enumerate(lines):
        line_lower = line.lower()
        for pattern, degree_type in degree_patterns:
            if re.search(pattern, line_lower):
                institution = None
                if i+1 < len(lines) and not re.search(r'\d{4}', lines[i+1]) and len(lines[i+1]) < 80:
                    institution = lines[i+1].strip()
                year = None
                year_match = re.search(r'\b(19|20)\d{2}\b', line)
                if year_match:
                    year = year_match.group(0)
                in_progress = 'en cours' in line_lower or 'present' in line_lower
                edu.append({
                    'degree': line.strip(),
                    'institution': institution,
                    'year': year,
                    'inProgress': in_progress
                })
                break
    seen = set()
    unique = []
    for e in edu:
        key = e['degree'][:50]
        if key not in seen:
            seen.add(key)
            unique.append(e)
    return unique[:8]

# ─── Extraction expérience (projets académiques et stages) ─────────────────────
def _extract_experience_from_text(text):
    exp = []
    sections = re.split(r'\n(?:Stages|Projets académiques|Expérience professionnelle)\s*\n', text, flags=re.IGNORECASE)
    if len(sections) < 2:
        return []
    relevant = sections[1]
    lines = relevant.split('\n')
    current = {}
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if len(line) < 100 and not line.startswith(('•', '-', '○')):
            if current:
                exp.append(current)
            current = {'title': line, 'company': None, 'duration': None, 'type': 'stage', 'description': ''}
        else:
            if current:
                current['description'] += ' ' + line
    if current:
        exp.append(current)
    for e in exp:
        e['description'] = re.sub(r'\s+', ' ', e['description']).strip()
    return exp

# ─── Préprocessing multi-colonnes ──────────────────────────────────────────────
SECTION_HEADERS_FR = [
    'contact', 'profil', 'competences', 'skills', 'langues', 'formation', 'education',
    'experience', 'stages', 'projets', 'certifications', 'centres d interet'
]

def _normalise_str(s: str) -> str:
    import unicodedata
    return unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()

def _is_section_header(line: str) -> bool:
    norm = _normalise_str(line.strip())
    norm = re.sub(r'[^a-z\s]', '', norm).strip()
    return any(norm == h or norm.startswith(h) for h in SECTION_HEADERS_FR)

def preprocess_cv_text(raw_text: str) -> str:
    if not raw_text or len(raw_text.strip()) < 30:
        return raw_text
    lines = raw_text.split('\n')
    first_non_empty = [l for l in lines if l.strip()][:15]
    header_count = sum(1 for l in first_non_empty if _is_section_header(l))
    if header_count < 1:
        return raw_text
    sections = {}
    header_order = []
    current_section = '__preamble__'
    sections[current_section] = []
    for line in lines:
        if _is_section_header(line):
            norm = _normalise_str(line.strip()).replace('[^a-z\s]', '',).strip()
            canonical = next((h for h in SECTION_HEADERS_FR if norm == h or norm.startswith(h)), norm)
            if canonical not in sections:
                sections[canonical] = []
                header_order.append(canonical)
            current_section = canonical
        else:
            sections.setdefault(current_section, []).append(line)
    CANONICAL_ORDER = [
        '__preamble__', 'contact', 'profil', 'formation', 'education', 'experience', 'stages',
        'projets', 'competences', 'skills', 'langues', 'certifications', 'centres d interet'
    ]
    sorted_sections = ['__preamble__'] + sorted(header_order, key=lambda a: next((i for i, c in enumerate(CANONICAL_ORDER) if a == c or a.startswith(c)), 999))
    parts = []
    preamble_lines = [l for l in sections.get('__preamble__', []) if l.strip()]
    candidate_name = None
    remaining_preamble = []
    name_pattern = re.compile(r'^[A-ZÀÂÉÈÊËÎÏÔÙÛÜÆŒ][a-zA-ZÀ-ÿ\-]+(?: [A-ZÀÂÉÈÊËÎÏÔÙÛÜÆŒ][a-zA-ZÀ-ÿ\-]+){1,2}$')
    for l in preamble_lines:
        if not candidate_name and name_pattern.match(l.strip()):
            candidate_name = l
        else:
            remaining_preamble.append(l)
    if candidate_name:
        parts.append(candidate_name)
        parts.append('')
    for section_key in sorted_sections:
        if section_key == '__preamble__':
            if remaining_preamble:
                parts.extend(remaining_preamble)
                parts.append('')
            continue
        section_lines = sections.get(section_key, [])
        if not section_lines or all(not l.strip() for l in section_lines):
            continue
        parts.append(section_key.upper())
        parts.extend(section_lines)
        parts.append('')
    return '\n'.join(parts)

# ─── Évaluation qualité OCR ───────────────────────────────────────────────────
CV_SECTION_KEYWORDS = ['contact', 'compétences', 'skills', 'langues', 'formation', 'education', 'expérience', 'stage', 'projet', 'certification']
def _assess_ocr_quality(text: str) -> dict:
    if not text or len(text.strip()) < OCR_MIN_CHARS:
        return {"usable": False, "reason": "too_short"}
    sections = sum(1 for kw in CV_SECTION_KEYWORDS if kw in text.lower())
    non_ascii = sum(1 for c in text if ord(c) > 127 and c not in 'àâéèêëîïôùûüæœ')
    noise = non_ascii / max(len(text), 1)
    usable = sections >= 1 and noise < 0.15
    return {"usable": usable, "sections": sections, "noise_ratio": noise}

# ─── Extraction LLM (une passe JSON, sans 'format: json' pour compatibilité) ───
async def _extract_cv_with_llm(text: str) -> dict:
    prompt = (
        "<|system|>\n"
        "You are an expert CV parser. Output ONLY valid JSON, no markdown, no explanation.\n"
        "NEVER invent information. If something is not in the CV, use null for strings, [] for lists.\n"
        "NEVER add certifications like 'AWS Certified' unless explicitly mentioned.\n"
        "NEVER invent company names like 'Acme'.\n"
        "NEVER add language levels (A1, B2, C1, etc.) unless explicitly stated.\n"
        "<|end|>\n"
        "<|user|>\n"
        "Extract from this CV and return JSON following this schema:\n"
        "{\n"
        '  "name": "string or null",\n'
        '  "email": "string or null",\n'
        '  "phone": "string or null (NEVER a year)",\n'
        '  "location": "string or null",\n'
        '  "summary": "string or null",\n'
        '  "yearsExperience": 0.0,\n'
        '  "skills": ["skill1", "skill2"],\n'
        '  "languages": [{"name": "French", "code": "fr", "level": null}],\n'
        '  "certifications": ["Certification name"],\n'
        '  "education": [{"degree": "...", "institution": "...", "year": "...", "inProgress": false}],\n'
        '  "experience": [{"title": "...", "company": "...", "duration": "...", "type": "stage|job", "description": "..."}]\n'
        "}\n\n"
        "RULES:\n"
        "- For languages, if level not specified, set level = null.\n"
        "- For certifications, only include those explicitly listed.\n"
        "- For experience, type 'stage' for internships, 'job' otherwise.\n"
        "- Do NOT invent any data.\n"
        f"CV TEXT:\n{text[:4500]}\n"
        "<|end|>\n"
        "<|assistant|>\n"
    )
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": EXTRACTION_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0, "num_predict": 1500, "num_ctx": 2048}
                }
            )
        raw = r.json().get("response", "")
        # Nettoyer la réponse pour extraire le JSON
        raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw)
        # Chercher le premier { et dernier }
        start = raw.find('{')
        end = raw.rfind('}')
        if start != -1 and end != -1:
            raw = raw[start:end+1]
        else:
            raise ValueError("No JSON object found")
        parsed = json.loads(raw)
        logger.info(f"LLM extraction OK: name={parsed.get('name')}, skills={len(parsed.get('skills', []))}")
        return parsed
    except Exception as e:
        logger.warning(f"LLM extraction failed: {e}")
        return None

# ─── Validation et nettoyage (avec anti-hallucination) ────────────────────────
def _validate_and_clean(data: dict, raw_text: str = "") -> dict:
    defaults = {
        "name": None, "email": None, "phone": None, "location": None, "summary": None,
        "yearsExperience": 0, "skills": [], "languages": [], "certifications": [],
        "education": [], "experience": []
    }
    result = {**defaults, **data}

    # Nettoyer phone
    phone = result.get("phone")
    if phone and re.fullmatch(r'\d{4}\s*[-–]\s*\d{4}|\d{4}', str(phone).strip()):
        result["phone"] = None

    # SKILLS : si LLM en a moins de 3, prendre depuis le texte brut
    if len(result["skills"]) < 3 and raw_text:
        result["skills"] = _extract_skills_from_text(raw_text)
    else:
        soft = {"communication","teamwork","leadership","problem solving","autonomy","rigueur"}
        seen = set()
        cleaned = []
        for s in result["skills"]:
            if isinstance(s, str) and s.lower() not in soft and s not in seen:
                seen.add(s)
                cleaned.append(s)
        result["skills"] = cleaned[:30]

    # LANGUES : si LLM a retourné avec niveaux inventés, remplacer niveau par null
    if raw_text:
        text_langs = _extract_languages_from_text(raw_text)
        if text_langs:
            result["languages"] = text_langs
        else:
            for lang in result["languages"]:
                if lang.get("level") and lang["level"] not in ["A1","A2","B1","B2","C1","C2"]:
                    lang["level"] = None
    else:
        for lang in result["languages"]:
            if lang.get("level") and lang["level"] not in ["A1","A2","B1","B2","C1","C2"]:
                lang["level"] = None

    # CERTIFICATIONS : filtrer les hallucinations
    bad_certs = {"aws certified", "aws certified developer", "certified", "scrum master", "pmp"}
    real_certs = []
    for c in result["certifications"]:
        if c.lower() not in bad_certs and len(c) > 5:
            real_certs.append(c)
    if not real_certs and raw_text:
        real_certs = _extract_certifications_from_text(raw_text)
    result["certifications"] = real_certs[:10]

    # EDUCATION : si vide, utiliser extraction locale
    if not result["education"] and raw_text:
        result["education"] = _extract_education_from_text(raw_text)

    # EXPERIENCE : si vide, utiliser extraction locale
    if not result["experience"] and raw_text:
        result["experience"] = _extract_experience_from_text(raw_text)

    # yearsExperience : recalcul simple
    total_years = 0.0
    for ex in result["experience"]:
        dur_str = ex.get("duration", "")
        years = 0.0
        if dur_str:
            if re.search(r'\d{4}\s*[-–]\s*\d{4}', dur_str):
                start, end = map(int, re.findall(r'\d{4}', dur_str)[:2])
                years = end - start
            elif re.search(r'\d{4}\s*[-–]\s*en cours', dur_str, re.IGNORECASE):
                start = int(re.search(r'\d{4}', dur_str).group())
                years = datetime.now().year - start
        if years == 0 and dur_str:
            # estimation grossière : un stage de quelques mois = 0.5
            years = 0.5
        if ex.get("type") == "stage":
            total_years += years * 0.5
        else:
            total_years += years
    result["yearsExperience"] = round(total_years, 1) if total_years > 0 else 0

    return result

# ─── OCR ──────────────────────────────────────────────────────────────────────
async def _extract_via_ocr(pdf_bytes: bytes) -> dict:
    try:
        images = convert_from_bytes(pdf_bytes, dpi=300, poppler_path=POPPLER_PATH)
        full_text = ""
        for img in images:
            page_text = pytesseract.image_to_string(img, lang='fra+eng', config='--psm 1')
            if len(page_text.strip()) < 100:
                page_text = pytesseract.image_to_string(img, lang='fra+eng', config='--psm 3')
            full_text += page_text + "\n"
        if len(full_text.strip()) < 50:
            return None
        return {"text": full_text}
    except Exception as e:
        logger.warning(f"OCR failed: {e}")
        return None

# ─── Routes ───────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "embedding": embedding_model is not None, "ollama_model": EXTRACTION_MODEL}

@app.post("/encode-job")
def encode_job(req: EncodeJobRequest):
    full_text = "\n".join([req.title, req.department or "", req.description or "", req.experienceLevel or "",
                           " ".join(s.get("name", "") for s in req.skills), " ".join(req.prerequisites)])
    emb = _get_embedding(full_text)
    if not emb:
        raise HTTPException(503, "Embedding service unavailable")
    return {"embedding": emb, "dims": len(emb)}

@app.post("/extract")
async def extract_cv(req: ExtractRequest):
    if not req.text or len(req.text.strip()) < 10:
        raise HTTPException(400, "CV text too short")
    quality = _assess_ocr_quality(req.text)
    logger.info(f"Quality: {quality}")
    text_to_process = preprocess_cv_text(req.text)
    llm_result = await _extract_cv_with_llm(text_to_process) if quality["usable"] else None
    if llm_result:
        entities = _validate_and_clean(llm_result, raw_text=text_to_process)
        if not entities.get("name"):
            entities["name"] = _extract_name(text_to_process)
        if not entities.get("email"):
            entities["email"] = _extract_email(text_to_process)
        if not entities.get("phone"):
            entities["phone"] = _extract_phone(text_to_process)
    else:
        # Fallback complet local
        entities = {
            "name": _extract_name(text_to_process),
            "email": _extract_email(text_to_process),
            "phone": _extract_phone(text_to_process),
            "location": None,
            "summary": None,
            "yearsExperience": 0,
            "skills": _extract_skills_from_text(text_to_process),
            "languages": _extract_languages_from_text(text_to_process),
            "certifications": _extract_certifications_from_text(text_to_process),
            "education": _extract_education_from_text(text_to_process),
            "experience": _extract_experience_from_text(text_to_process),
        }
        entities["yearsExperience"] = _validate_and_clean(entities, raw_text=text_to_process)["yearsExperience"]
    embedding = _get_embedding(req.text[:4000])
    return {"entities": entities, "embedding": embedding}

@app.post("/extract-from-pdf")
async def extract_from_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(400, "File must be PDF")
    contents = await file.read()
    ocr_result = await _extract_via_ocr(contents)
    if not ocr_result:
        raise HTTPException(500, "OCR failed")
    full_text = ocr_result["text"]
    quality = _assess_ocr_quality(full_text)
    text_to_process = preprocess_cv_text(full_text)
    llm_result = await _extract_cv_with_llm(text_to_process) if quality["usable"] else None
    if llm_result:
        entities = _validate_and_clean(llm_result, raw_text=text_to_process)
        if not entities.get("name"):
            entities["name"] = _extract_name(text_to_process)
        if not entities.get("email"):
            entities["email"] = _extract_email(text_to_process)
        if not entities.get("phone"):
            entities["phone"] = _extract_phone(text_to_process)
    else:
        entities = {
            "name": _extract_name(text_to_process),
            "email": _extract_email(text_to_process),
            "phone": _extract_phone(text_to_process),
            "location": None,
            "summary": None,
            "yearsExperience": 0,
            "skills": _extract_skills_from_text(text_to_process),
            "languages": _extract_languages_from_text(text_to_process),
            "certifications": _extract_certifications_from_text(text_to_process),
            "education": _extract_education_from_text(text_to_process),
            "experience": _extract_experience_from_text(text_to_process),
        }
        entities["yearsExperience"] = _validate_and_clean(entities, raw_text=text_to_process)["yearsExperience"]
    embedding = _get_embedding(full_text[:4000])
    return {"entities": entities, "embedding": embedding, "ocr_text": full_text}

@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    prompt = f"CV summary:\n{req.cv[:1200]}\n\nJob:\n{req.job[:600]}\n\nMatch score: {req.score}%\n\nIn 3 sentences: candidate strengths and key missing skills. Be concise."
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": ANALYSIS_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.3, "num_predict": 200, "num_ctx": 1024}
                }
            )
        return {"analysis": r.json().get("response")}
    except Exception as e:
        logger.warning(f"Analyze failed: {e}")
        return {"analysis": None}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))