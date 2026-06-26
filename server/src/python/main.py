import os
os.environ["PYTORCH_NO_CUDA_MEMORY_CACHING"] = "1"

"""
NexGenAI — Microservice Python d'extraction CV + scoring sémantique
====================================================================
FastAPI service on port 8000.

  POST /extract      → phi4 extraction dynamique (champs pilotés par le job) + bge-m3 cosine
  POST /extract-text → même pipeline, texte brut en entrée (pas de PDF)
  POST /score-skills → scoring bge-m3 uniquement, sans LLM (CV déjà extrait)
  POST /embed        → sentence-transformers BAAI/bge-m3
  POST /index-job    → pré-calcul embeddings job en mémoire
  GET  /health       → santé du service

Architecture :
  Phase 1 — Lecture PDF (pdfplumber 2-colonnes + OCR Tesseract fallback + PyMuPDF)
  Phase 2 — phi4 extraction dynamique (UN seul appel, champs définis par le job)
  Phase 3 — bge-m3 cosine scoring sur données extraites + texte brut ligne par ligne
  Phase 4 — ESCO ontologie pour normalisation des skills (Node == Node.js)
"""

import json
import re
import io
import pathlib
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from functools import lru_cache

import numpy as np
import requests
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from pydantic import BaseModel

# ── Dépendances obligatoires ──────────────────────────────────────────────────
try:
    import fitz  # PyMuPDF
except ImportError:
    raise RuntimeError("PyMuPDF manquant → pip install pymupdf")

try:
    from docx import Document as DocxDocument
except ImportError:
    raise RuntimeError("python-docx manquant → pip install python-docx")

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    raise RuntimeError("sentence-transformers manquant → pip install sentence-transformers")

try:
    import pdfplumber
    _PDFPLUMBER_AVAILABLE = True
except ImportError:
    _PDFPLUMBER_AVAILABLE = False

# ── Configuration globale ─────────────────────────────────────────────────────
OLLAMA_URL  = "http://localhost:11434/api/generate"  # NOSONAR
QWEN_MODEL  = "phi4:latest"                          # modèle LLM retenu (F1=0.83)
EMBED_MODEL = "BAAI/bge-m3"                          # modèle d'embeddings retenu (P@4=0.70)
ESCO_URL    = "https://ec.europa.eu/esco/api/search"  # NOSONAR
CHUNK_CHARS = 12_000
NUM_CTX     = 3072

log = logging.getLogger("nexgenai.extractor")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s — %(message)s")

# Instance globale du modèle d'embeddings (chargé une seule fois au démarrage)
_embed_model: SentenceTransformer | None = None

# Cache en mémoire des embeddings pré-calculés par job
# Structure : { job_id: { terme: np.ndarray } }
_job_embs_cache: dict[str, dict[str, np.ndarray]] = {}


# ── Cycle de vie de l'application ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Chargement du modèle bge-m3 au démarrage, libération à l'arrêt."""
    global _embed_model
    log.info("Chargement du modèle multilingue (%s)...", EMBED_MODEL)
    _embed_model = SentenceTransformer(EMBED_MODEL)
    if not _PDFPLUMBER_AVAILABLE:
        log.warning("pdfplumber absent — pip install pdfplumber pour la détection 2 colonnes")
    log.info("Modèle chargé — service prêt sur :8000")
    yield
    # Rien à libérer explicitement ; Python gère la mémoire


app = FastAPI(title="NexGenAI Extractor", lifespan=lifespan)


@app.middleware("http")
async def add_connection_close(request, call_next):
    """Force la fermeture des connexions HTTP après chaque requête (évite les keep-alive bloquants)."""
    response = await call_next(request)
    response.headers["Connection"] = "close"
    return response


# ═════════════════════════════════════════════════════════════════════════════
# ESCO — Normalisation des skills via l'ontologie européenne
# But : résoudre les variantes d'un même skill (Node == Node.js, JS == JavaScript)
# ═════════════════════════════════════════════════════════════════════════════

@lru_cache(maxsize=1000)
def esco_get_uri(skill_name: str) -> str | None:
    """
    Interroge l'API ESCO pour obtenir l'URI canonique d'un skill.
    Le cache LRU évite de refaire la même requête réseau pour le même terme.
    Retourne None si ESCO est indisponible ou ne connaît pas le terme.
    """
    if not skill_name or not skill_name.strip():
        return None
    try:
        resp = requests.get(
            ESCO_URL,
            params={
                "text":     skill_name.strip(),
                "language": "fr",
                "type":     "skill",
                "full":     False,
                "limit":    1,
            },
            timeout=5,
        )
        if resp.status_code != 200:
            return None
        results = resp.json().get("_embedded", {}).get("results", [])
        if not results:
            return None
        return results[0].get("uri")
    except Exception as e:
        log.debug("ESCO indisponible pour '%s': %s", skill_name, e)
        return None


def esco_skills_match(skill_job: str, skill_cv: str) -> bool:
    """
    Retourne True si les deux skills partagent le même URI ESCO.
    Exemple : "Node" et "Node.js" → même URI → True.
    """
    uri_job = esco_get_uri(skill_job)
    uri_cv  = esco_get_uri(skill_cv)
    if uri_job and uri_cv and uri_job == uri_cv:
        log.info("   ESCO match: '%s' == '%s' (uri=%s)", skill_job, skill_cv, uri_job)
        return True
    return False


def prefix_skills_match(skill_job: str, skill_cv: str) -> bool:
    """
    Match par préfixe après normalisation (suppression espaces/ponctuation).
    Couvre les cas comme "React" == "ReactJS", "Python" == "Python3".
    Les suffixes tolérés sont : js, py, ts, db, 2..9.
    """
    s1 = re.sub(r'[\s.\-_/]', '', skill_job.strip().lower())  # NOSONAR
    s2 = re.sub(r'[\s.\-_/]', '', skill_cv.strip().lower())   # NOSONAR
    if s1 == s2:
        return True
    KNOWN_SUFFIXES = {'js', 'py', 'ts', 'db', '2', '3', '4', '5', '6', '7', '8', '9'}
    if s1 and s2:
        if s2.startswith(s1) and len(s1) >= 3 and s2[len(s1):] in KNOWN_SUFFIXES:
            return True
        if s1.startswith(s2) and len(s2) >= 3 and s1[len(s2):] in KNOWN_SUFFIXES:
            return True
    return False


def skills_match(skill_job: str, skill_cv: str) -> bool:
    """
    Fonction principale de matching de skills.
    Ordre de priorité :
      1. Égalité exacte (insensible à la casse)
      2. Match ESCO (ontologie sémantique)
      3. Match par préfixe normalisé
    """
    if not skill_job or not skill_cv:
        return False
    if skill_job.strip().lower() == skill_cv.strip().lower():
        return True
    if esco_skills_match(skill_job, skill_cv):
        return True
    if prefix_skills_match(skill_job, skill_cv):
        log.info("   Prefix match: '%s' == '%s'", skill_job, skill_cv)
        return True
    return False


# ═════════════════════════════════════════════════════════════════════════════
# LECTURE PDF — 3 stratégies en cascade
# ═════════════════════════════════════════════════════════════════════════════

def _words_to_lines(word_list: list) -> str:
    """
    Regroupe les mots extraits par pdfplumber en lignes de texte.
    Les mots sont triés par position Y (ligne) puis X (colonne gauche→droite).
    """
    if not word_list:
        return ""
    lines: dict = {}
    for w in word_list:
        # Arrondi à 3px pour regrouper les mots sur la même ligne visuelle
        y_key = round(w["top"] / 3) * 3
        lines.setdefault(y_key, []).append(w)
    result = []
    for y_key in sorted(lines):
        line_text = " ".join(
            w["text"] for w in sorted(lines[y_key], key=lambda w: w["x0"])
        ).strip()
        if line_text:
            result.append(line_text)
    return "\n".join(result)


def read_pdf(data: bytes) -> str:
    """
    Lit un fichier PDF et retourne son texte brut.

    Stratégie 1 — Test PyMuPDF rapide :
      Si le texte extrait est < 50 caractères → PDF scanné → passer à l'OCR.

    Stratégie 2 — OCR Tesseract (fallback PDF scanné) :
      Rastérise chaque page en image 2× puis applique Tesseract.
      Langues détectées automatiquement (fra+eng+ara si disponibles).

    Stratégie 3 — pdfplumber (PDF natif) :
      Détecte les mises en page 2 colonnes via l'analyse de la distribution
      horizontale des mots (x0). Si un grand écart est trouvé entre 20% et 75%
      de la largeur de page, on lit colonne gauche (sidebar) + colonne droite
      (main content) séparément pour éviter les mélanges de texte.

    Fallback final — PyMuPDF extraction basique.
    """
    # ── Test rapide : PDF natif ou scanné ?
    try:
        doc       = fitz.open(stream=data, filetype="pdf")
        test_text = "".join(page.get_text("text") for page in doc)
        doc.close()
    except Exception:
        test_text = ""

    # ── Stratégie 2 : OCR si texte insuffisant
    if len(test_text.strip()) < 50:
        try:
            import pytesseract
            from PIL import Image

            _tess_exe = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
            if os.path.isfile(_tess_exe):
                pytesseract.pytesseract.tesseract_cmd = _tess_exe

            _tessdata = r'C:\Program Files\Tesseract-OCR\tessdata'
            _avail    = [lg for lg in ('fra', 'eng', 'ara')
                         if os.path.isfile(os.path.join(_tessdata, f'{lg}.traineddata'))]
            _lang = '+'.join(_avail) if _avail else 'eng'
            log.info("OCR lang: %s", _lang)

            doc      = fitz.open(stream=data, filetype="pdf")
            all_text = []
            for i, page in enumerate(doc):
                log.info("   OCR page %d...", i + 1)
                pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
                img = Image.open(io.BytesIO(pix.tobytes("png")))
                t   = pytesseract.image_to_string(img, lang=_lang, config="--psm 3")
                if t.strip():
                    all_text.append(t.strip())
            doc.close()
            ocr_text = "\n\n".join(all_text)
            if ocr_text.strip():
                return ocr_text
        except Exception as e:
            log.warning("OCR indisponible (%s) → extraction basique", type(e).__name__)
        return test_text.strip()

    # ── Stratégie 3 : pdfplumber avec détection 2 colonnes
    if _PDFPLUMBER_AVAILABLE:
        try:
            all_text = []
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                for page_num, page in enumerate(pdf.pages):
                    pw    = page.width
                    words = page.extract_words(
                        x_tolerance=3, y_tolerance=3,
                        keep_blank_chars=False, use_text_flow=False,
                    )
                    if not words:
                        t = page.extract_text()
                        if t:
                            all_text.append(t.strip())
                        continue

                    # Détection du point de séparation entre 2 colonnes
                    x0_list   = [w["x0"] for w in words]
                    x0_sorted = sorted(set(round(x, -1) for x in x0_list))
                    max_gap, best_split = 0.0, None
                    for i in range(len(x0_sorted) - 1):
                        gap = x0_sorted[i + 1] - x0_sorted[i]
                        mid = (x0_sorted[i] + x0_sorted[i + 1]) / 2
                        # Le séparateur doit être entre 20% et 75% de la largeur
                        if pw * 0.20 <= mid <= pw * 0.75 and gap > max_gap:
                            max_gap, best_split = gap, mid

                    is_two_col = False
                    mid_x      = pw / 2
                    if best_split and max_gap >= pw * 0.08:
                        ln = sum(1 for x in x0_list if x < best_split)
                        rn = sum(1 for x in x0_list if x >= best_split)
                        n  = len(x0_list)
                        # Les deux colonnes doivent chacune contenir ≥10% des mots
                        if ln >= n * 0.10 and rn >= n * 0.10:
                            is_two_col, mid_x = True, best_split

                    log.info("   Page %d : %s", page_num + 1, "2-col" if is_two_col else "1-col")

                    if is_two_col:
                        lw = [w for w in words if w["x0"] < mid_x]   # sidebar (gauche)
                        rw = [w for w in words if w["x0"] >= mid_x]  # main content (droite)
                        pt = (
                            "=== MAIN CONTENT ===\n" + _words_to_lines(rw) +
                            "\n\n=== SIDEBAR ===\n"  + _words_to_lines(lw)
                        )
                    else:
                        pt = _words_to_lines(words)

                    if pt.strip():
                        all_text.append(pt)
            return "\n\n".join(all_text)
        except Exception as e:
            log.warning("pdfplumber échoué (%s) → fallback PyMuPDF", e)

    # ── Fallback final : PyMuPDF extraction basique
    doc  = fitz.open(stream=data, filetype="pdf")
    text = "\n".join(page.get_text("text") for page in doc)
    doc.close()
    return text


def read_docx(data: bytes) -> str:
    """Extrait le texte d'un fichier DOCX paragraphe par paragraphe."""
    doc = DocxDocument(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def read_cv(data: bytes, filename: str) -> str:
    """Route vers read_pdf ou read_docx selon l'extension du fichier."""
    ext = pathlib.Path(filename).suffix.lower()
    if ext == ".pdf":
        return read_pdf(data)
    elif ext in (".docx", ".doc"):
        return read_docx(data)
    raise HTTPException(status_code=400, detail=f"Format non supporté : {ext}")


def clean_cv_text(text: str) -> str:
    """
    Normalise le texte brut extrait :
    - Réduit les séquences de ≥3 sauts de ligne à 2
    - Supprime les espaces multiples
    - Élimine les lignes de moins de 2 caractères (artefacts)
    """
    text = re.sub(r'\n{3,}', '\n\n', text)  # NOSONAR
    text = re.sub(r' {2,}', ' ', text)       # NOSONAR
    lines = [l for l in text.split('\n') if len(l.strip()) > 1]
    return '\n'.join(lines).strip()


def prepare_for_qwen(text: str, max_chars: int = 4000) -> str:
    """
    Tronque le texte pour respecter la fenêtre de contexte de phi4 (NUM_CTX=3072 tokens).
    Garde le début (profil/skills) et la fin (expériences récentes) du CV.
    """
    cleaned = clean_cv_text(text)
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[:2500] + "\n\n[...]\n\n" + cleaned[-1500:]


# ═════════════════════════════════════════════════════════════════════════════
# RECALCUL EXPÉRIENCE — Parsing des dates et calcul des durées
# ═════════════════════════════════════════════════════════════════════════════

def recalculate_experience(extracted: dict) -> dict:
    """
    Recalcule le nombre de mois par poste à partir des dates extraites par phi4.
    phi4 extrait les dates en texte libre (ex: "mars 2022", "03/2022", "2022-03").
    Cette fonction les parse et calcule la durée réelle pour éviter les hallucinations.

    Formats supportés : mois en lettres (FR/EN/AR), MM/YYYY, YYYY-MM, YYYY seul.
    "présent", "actuel", "current", "ongoing" → datetime.now().
    """
    MOIS = {
        "janvier": 1, "février": 2, "february": 2, "mars": 3, "march": 3,
        "avril": 4, "april": 4, "mai": 5, "may": 5, "juin": 6, "june": 6,
        "juillet": 7, "july": 7, "août": 8, "aout": 8, "august": 8,
        "septembre": 9, "september": 9, "octobre": 10, "october": 10,
        "novembre": 11, "november": 11, "décembre": 12, "decembre": 12,
        "december": 12, "jan": 1, "feb": 2, "mar": 3, "apr": 4,
        "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    }

    def parse_date(s: str):
        if not s:
            return None
        s = s.strip().lower()
        # Détection "présent / actuel / current"
        if any(w in s for w in ["présent", "present", "aujourd", "actuel",
                                  "jusqu", "maintenant", "current", "now",
                                  "ce jour", "ongoing", "en cours"]):
            return datetime.now()
        # Séparateur tiret ou em-dash (ex: "2020 — présent")
        if "-" in s or "—" in s:
            parts = re.split(r'[-—]', s)  # NOSONAR
            for part in parts:
                if any(w in part for w in ["présent", "present", "actuel", "current", "now"]):
                    others = [p.strip() for p in parts
                              if not any(w in p for w in ["présent", "present", "actuel", "current"])]
                    if others:
                        return parse_date(others[0])
        # "mars 2022", "march 2022"
        for mois_name, mois_num in MOIS.items():
            if mois_name in s:
                m = re.search(r'\b(19|20)\d{2}\b', s)  # NOSONAR
                if m:
                    return datetime(int(m.group()), mois_num, 1)
        # "03/2022" ou "03-2022"
        m = re.match(r'^(\d{1,2})[/\-](\d{4})$', s.strip())  # NOSONAR
        if m and 1 <= int(m.group(1)) <= 12:
            return datetime(int(m.group(2)), int(m.group(1)), 1)
        # "2022/03"
        m = re.match(r'^(\d{4})[/\-](\d{1,2})$', s.strip())  # NOSONAR
        if m and 1 <= int(m.group(2)) <= 12:
            return datetime(int(m.group(1)), int(m.group(2)), 1)
        # Année seule "2022"
        m = re.search(r'\b(19|20)\d{2}\b', s)  # NOSONAR
        if m:
            return datetime(int(m.group()), 1, 1)
        return None

    exp       = extracted.get("experience") or {}
    positions = exp.get("positions") or []
    if not positions:
        exp["total_months"] = 0
        extracted["experience"] = exp
        return extracted

    total = 0
    for p in positions:
        debut = parse_date(p.get("debut"))
        fin   = parse_date(p.get("fin"))
        if debut and fin and fin >= debut:
            mois = max(1, (fin.year - debut.year) * 12 + (fin.month - debut.month))
            p["duree_mois"] = mois
            total += mois
            log.info("   %s → %s = %d mois", p.get("debut"), p.get("fin"), mois)
        else:
            p["duree_mois"] = 0

    exp["total_months"] = total
    extracted["experience"] = exp
    log.info("   Total expérience recalculé : %d mois", total)
    return extracted


# ═════════════════════════════════════════════════════════════════════════════
# CONSTRUCTION DU PROMPT — Dynamique selon les prérequis du job
# ═════════════════════════════════════════════════════════════════════════════

# En-tête commun à toutes les requêtes d'extraction
_EXTRACTION_HEADER = """\
You are a strict CV data extractor. CV language: ANY (French, English, Arabic…).
CV structure: ANY layout, ANY section names.

GOLDEN RULE — EXPERIENCE:
Include a position ONLY if it appears under a section explicitly named:
"Expérience professionnelle", "Expérience", "Experience", "Work experience",
"Emplois", "Parcours professionnel".
ALWAYS EXCLUDE: Stages/Internships, Projets académiques, Formation/Education,
Certifications, Clubs, Profil.
If no such section exists → positions: [], total_months: 0

IMPORTANT: Return ONLY valid JSON matching exactly the schema below. No markdown. No explanation.\
"""

# Instructions par type de champ (injectées dynamiquement selon les prérequis du job)
_TASK_DEGREE = """\
Find ALL education entries (Bac, BTS, DUT, Licence, Bachelor, Master, Ingénieur,
Mastère, Cycle ingénieur, PhD, MBA — any language equivalent).
For each: titre + annee. Select the most recent as main degree.\
"""

_TASK_EXPERIENCE = """\
Apply GOLDEN RULE strictly.
For each real job: titre, entreprise, debut, fin. Leave duree_mois: 0.\
"""

_TASK_LANGUAGE = """\
All languages with level (natif/courant/bilingue/avancé/intermédiaire/débutant/A1-C2/null).\
"""

_TASK_CERTIFICATION = """\
All certifications. If none → [].\
"""

_TASK_HARD_SKILLS = """\
ALL technical skills: programming languages, frameworks, libraries, databases,
cloud, tools, methodologies. Include everything technical found anywhere in the CV.\
"""

_TASK_SOFT_SKILLS = """\
Behavioral traits only, ≤ 6 words each, max 8 items.
Examples: "Leadership", "Communication", "Travail en équipe".
EXCLUDE technical skills and long sentences.\
"""


def _primary_json_key(json_schema: str) -> str:
    """Extrait la première clé d'un fragment de schéma JSON (ex: '"degree": ...' → 'degree')."""
    m = re.match(r'\s*"([^"]+)"\s*:', json_schema.strip())
    return m.group(1) if m else ""


def _add_standard_field(fields: list, type_: str) -> None:
    """Ajoute un champ standard (DEGREE / EXPERIENCE / LANGUAGE / CERTIFICATION) à la liste."""
    if type_ == "DEGREE":
        fields.append({
            "name":        "degree",
            "instruction": _TASK_DEGREE,
            "json_schema": (
                '"degree": {"titre": "string or null", "annee": "string or null"}, '
                '"all_diplomas": [{"titre": "string", "annee": "string or null"}]'
            ),
        })
    elif type_ == "EXPERIENCE":
        fields.append({
            "name":        "experience",
            "instruction": _TASK_EXPERIENCE,
            "json_schema": (
                '"experience": {"total_months": 0, "positions": ['
                '{"titre": "string", "entreprise": "string or null", '
                '"debut": "string or null", "fin": "string or null", "duree_mois": 0}'
                ']}'
            ),
        })
    elif type_ == "LANGUAGE":
        fields.append({
            "name":        "languages",
            "instruction": _TASK_LANGUAGE,
            "json_schema": '"languages": [{"langue": "string", "niveau": "string or null"}]',
        })
    elif type_ == "CERTIFICATION":
        fields.append({
            "name":        "certifications",
            "instruction": _TASK_CERTIFICATION,
            "json_schema": '"certifications": ["string"]',
        })


def build_extraction_fields(prereqs: list, needs_hard: bool, needs_soft: bool) -> tuple:
    """
    Décide dynamiquement quels champs phi4 doit extraire, selon les prérequis du job.

    Principe : n'extraire que ce que le job nécessite.
    - Si le job a un prérequis DEGREE → ajouter le champ diplôme
    - Si le job a un prérequis EXPERIENCE → ajouter le champ expérience
    - etc.
    - Sans prérequis (upload profil sans contexte job) → tout extraire
    - Les prérequis custom (avec instruction+json_schema) sont toujours ajoutés
    - hard_skills + soft_skills sont toujours ajoutés en dernier

    Retourne :
      fields     : liste de dicts {name, instruction, json_schema}
      custom_map : dict {index_prereq → field_name} pour le scoring
    """
    fields:     list = []
    custom_map: dict = {}
    custom_ctr: int  = 0
    seen:       set  = set()

    # Champs standards pilotés par les types de prérequis
    for prereq in prereqs:
        ptype = (prereq.get("type") or "").upper()
        if ptype in ("DEGREE", "EDUCATION") and "DEGREE" not in seen:
            _add_standard_field(fields, "DEGREE")
            seen.add("DEGREE")
        elif ptype == "EXPERIENCE" and "EXPERIENCE" not in seen:
            _add_standard_field(fields, "EXPERIENCE")
            seen.add("EXPERIENCE")
        elif ptype == "LANGUAGE" and "LANGUAGE" not in seen:
            _add_standard_field(fields, "LANGUAGE")
            seen.add("LANGUAGE")
        elif ptype == "CERTIFICATION" and "CERTIFICATION" not in seen:
            _add_standard_field(fields, "CERTIFICATION")
            seen.add("CERTIFICATION")

    # Sans prérequis → tout extraire (upload profil sans contexte job)
    if not prereqs:
        for ftype in ("DEGREE", "EXPERIENCE", "LANGUAGE", "CERTIFICATION"):
            _add_standard_field(fields, ftype)

    # Prérequis custom (définis par le RH avec instruction+json_schema personnalisés)
    for i, prereq in enumerate(prereqs):
        has_custom = bool(prereq.get("instruction") and prereq.get("json_schema"))
        if has_custom:
            fname = _primary_json_key(prereq["json_schema"]) or f"custom_prereq_{custom_ctr}"
            custom_ctr += 1
            custom_map[i] = fname
            fields.append({
                "name":        fname,
                "instruction": prereq["instruction"],
                "json_schema": prereq["json_schema"],
            })

    # hard_skills et soft_skills toujours présents (scoring skills)
    if not any(f["name"] == "hard_skills" for f in fields):
        fields.append({
            "name":        "hard_skills",
            "instruction": _TASK_HARD_SKILLS,
            "json_schema": '"hard_skills": ["string"]',
        })
    if not any(f["name"] == "soft_skills" for f in fields):
        fields.append({
            "name":        "soft_skills",
            "instruction": _TASK_SOFT_SKILLS,
            "json_schema": '"soft_skills": ["string"]',
        })

    return fields, custom_map


def build_prompt_from_fields(cv_text: str, fields: list) -> str:
    """
    Assemble le prompt final envoyé à phi4.

    Structure du prompt :
      1. _EXTRACTION_HEADER (règles fixes)
      2. ### TASK 1 — NOM_DU_CHAMP\n instruction...  (une section par champ)
      3. === EXPECTED JSON SCHEMA ===\n { ... }       (schéma exact attendu)
      4. === CV TEXT ===\n texte_du_cv\n\nJSON:       (texte à analyser)

    phi4 est configuré avec "format": "json" → il ne retourne que du JSON.
    """
    instructions = "\n\n".join(
        f"### TASK {i} — {f['name'].upper()}\n{f['instruction'].strip()}"
        for i, f in enumerate(fields, 1)
    )
    schema_body = ",\n  ".join(f["json_schema"] for f in fields)
    schema_str  = "{\n  " + schema_body + "\n}"
    return (
        f"{_EXTRACTION_HEADER}\n\n"
        + instructions
        + f"\n\n=== EXPECTED JSON SCHEMA ===\n{schema_str}"
        + f"\n\n=== CV TEXT ===\n{cv_text}\n\nJSON:"
    )


# ═════════════════════════════════════════════════════════════════════════════
# APPEL OLLAMA — Streaming phi4
# ═════════════════════════════════════════════════════════════════════════════

def call_qwen(prompt: str) -> str:
    """
    Envoie le prompt à phi4 via l'API Ollama en mode streaming.
    Ollama retourne les tokens un par un (Server-Sent Events JSON).
    On concatène jusqu'à recevoir {"done": true}.

    Options clés :
      num_predict : 900 tokens max en sortie (JSON CV ou jugement prérequis)
      temperature : 0.0 → déterministe, pas de créativité
      num_ctx     : 3072 → fenêtre de contexte
      num_gpu     : 999 → utilise tout le GPU disponible
    """
    payload = {
        "model":  QWEN_MODEL,
        "prompt": prompt,
        "format": "json",   # force phi4 à produire du JSON valide
        "stream": True,
        "options": {
            "num_predict": 900,
            "temperature": 0.0,
            "num_ctx":     NUM_CTX,
            "num_thread":  4,
            "num_gpu":     999,
        }
    }
    try:
        resp = requests.post(OLLAMA_URL, json=payload, stream=True, timeout=300)
        resp.raise_for_status()
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=503, detail="Ollama indisponible")
    except requests.exceptions.HTTPError as e:
        log.error("Ollama HTTP error: %s", e)
        raise HTTPException(status_code=503, detail=f"Ollama service error: {e}")

    full_text = ""
    for line in resp.iter_lines():
        if line:
            try:
                data = json.loads(line)
                full_text += data.get("response", "")
                if data.get("done"):
                    ec = data.get("eval_count", 0)
                    ed = data.get("eval_duration", 0)
                    if ed > 0:
                        log.info("phi4: %d tokens @ %.1f t/s", ec, ec / (ed / 1e9))
                    break
            except json.JSONDecodeError:
                continue
    return full_text


# ═════════════════════════════════════════════════════════════════════════════
# PARSING JSON ROBUSTE
# ═════════════════════════════════════════════════════════════════════════════

def extract_json(raw: str) -> dict:
    """
    Parse le JSON retourné par phi4 de manière robuste.
    Gère les cas :
      - Fences markdown (```json ... ```)
      - Texte parasite avant/après le JSON
      - Virgules trailing (,} ou ,])
      - JSON tronqué (depth > 0 à la fin)
    """
    raw   = re.sub(r"```json\s*", "", raw)   # NOSONAR
    raw   = re.sub(r"```\s*",     "", raw).strip()  # NOSONAR
    start = raw.find("{")
    if start == -1:
        return {}

    # Trouver l'accolade fermante correspondante
    depth, end = 0, -1
    for i, ch in enumerate(raw[start:], start):
        if ch == "{":   depth += 1
        elif ch == "}": depth -= 1
        if depth == 0:
            end = i + 1
            break
    if end == -1:
        return {}

    try:
        return json.loads(raw[start:end])
    except json.JSONDecodeError:
        try:
            # Tentative de correction des virgules trailing
            cleaned = re.sub(r",\s*([}\]])", r"\1", raw[start:end])  # NOSONAR
            return json.loads(cleaned)
        except Exception:
            return {}


# ═════════════════════════════════════════════════════════════════════════════
# SCORING — Skills (bge-m3 cosine similarity)
# ═════════════════════════════════════════════════════════════════════════════

def _cosine_max(query_emb: np.ndarray, candidates: list, embed_model) -> tuple:
    """
    Calcule la cosine similarity entre query_emb et chaque candidat,
    retourne (meilleur_score, meilleur_candidat).

    Vectorisé via NumPy : une seule opération matricielle embs @ query_emb
    calcule tous les produits scalaires simultanément (bien plus rapide qu'une boucle).

    Formule : cos(θ) = (A · B) / (‖A‖ × ‖B‖)
    """
    if not candidates or embed_model is None:
        return 0.0, ""
    embs   = embed_model.encode(candidates, show_progress_bar=False)
    norms  = np.linalg.norm(embs, axis=1) + 1e-9   # +epsilon évite division par zéro
    norm_q = np.linalg.norm(query_emb) + 1e-9
    sims   = (embs @ query_emb) / (norms * norm_q)  # vecteur de scores
    idx    = int(np.argmax(sims))
    return float(sims[idx]), candidates[idx]


def score_skill_vs_list(
    skill_name:       str,
    extracted_skills: list,
    line_embs:        np.ndarray,
    embed_model,
    precomp_emb:      "np.ndarray | None" = None,
) -> float:
    """
    Score un skill job contre les skills extraits du CV + les lignes brutes du texte.

    3 niveaux de matching (par ordre de priorité) :
      1. Match exact/ESCO/préfixe → score 1.0 immédiat
      2. Cosine similarity contre la liste de skills extraits par phi4
      3. Cosine similarity contre les lignes brutes (filet de sécurité si phi4 a raté)

    Le score final est le max des deux sources de cosine.
    precomp_emb : embedding pré-calculé depuis le cache job (évite un recalcul).
    """
    if not skill_name.strip() or embed_model is None:
        return 0.0

    # Priorité 1 : match normalisé (exact / ESCO / préfixe)
    for extracted_skill in extracted_skills:
        if skills_match(skill_name, extracted_skill):
            log.info("   Match normalisé: '%s' == '%s'", skill_name, extracted_skill)
            return 1.0

    # Embedding du skill job (depuis cache ou calcul frais)
    skill_emb = precomp_emb if precomp_emb is not None \
        else embed_model.encode([skill_name], show_progress_bar=False)[0]
    norm_s = np.linalg.norm(skill_emb) + 1e-9
    best   = 0.0

    # Source A : skills extraits par phi4
    if extracted_skills:
        embs  = embed_model.encode(extracted_skills, show_progress_bar=False)
        norms = np.linalg.norm(embs, axis=1) + 1e-9
        sims  = (embs @ skill_emb) / (norms * norm_s)
        best  = max(best, float(np.max(sims)))

    # Source B : lignes brutes du CV (fallback phi4)
    if line_embs is not None and line_embs.shape[0] > 0:
        norms_l = np.linalg.norm(line_embs, axis=1) + 1e-9
        sims_l  = (line_embs @ skill_emb) / (norms_l * norm_s)
        best    = max(best, float(np.max(sims_l)))

    return best


# ═════════════════════════════════════════════════════════════════════════════
# SCORING — Prérequis (logique par type)
# ═════════════════════════════════════════════════════════════════════════════

def score_prereq_from_extraction(
    prereq:            dict,
    extracted:         dict,
    embed_model,
    custom_field_name: str = None,
    precomp_req_emb:   "np.ndarray | None" = None,
) -> dict:
    """
    Score un prérequis job contre les données extraites du CV.

    Logique par type :
      EXPERIENCE   → ratio mois pertinents / mois requis (phi4 juge la pertinence domaine)
      DEGREE       → phi4 juge l'équivalence niveau+domaine (Ingénieur == Bac+5)
      LANGUAGE     → cosine similarity sur "langue niveau"
      CERTIFICATION → phi4 juge l'équivalence (AWS Solutions Architect == AWS SA)
      CUSTOM       → cosine similarity sur le champ custom extrait

    Retourne un dict {type, requis, detecte, present, score}.
    """
    type_  = (prereq.get("type") or "").upper()
    value  = (prereq.get("value") or "").strip()
    result = {"type": type_, "requis": value, "detecte": None, "present": False, "score": 0.0}

    if not value or embed_model is None:
        return result

    log.info("score_prereq: type='%s' value='%s' custom_field='%s'",
             type_, value, custom_field_name)

    # Embedding du prérequis (depuis cache ou calcul frais)
    req_emb = precomp_req_emb if precomp_req_emb is not None \
        else embed_model.encode([value], show_progress_bar=False)[0]

    def cosine_max(candidates: list) -> tuple:
        return _cosine_max(req_emb, [c for c in candidates if c and str(c).strip()], embed_model)

    # ── Traitement via champ custom extrait par phi4 ──────────────────────────
    if custom_field_name and custom_field_name in extracted:
        field_val = extracted[custom_field_name]

        if type_ == "EXPERIENCE":
            if isinstance(field_val, dict):
                positions = field_val.get("positions") or []
                total_m   = field_val.get("total_months", 0)
            else:
                positions, total_m = [], 0

            # Parsing de la durée requise ("2 ans", "18 mois", "2")
            years_m  = re.search(r'(\d+)\s*an',    value, re.I)  # NOSONAR
            months_m = re.search(r'(\d+)\s*mois',  value, re.I)  # NOSONAR
            number_m = re.search(r'^\s*(\d+)\s*$', value.strip())  # NOSONAR
            if years_m:
                required = int(years_m.group(1)) * 12
            elif months_m:
                required = int(months_m.group(1))
            elif number_m:
                n = int(number_m.group(1))
                required = n if n > 12 else n * 12
            else:
                required = 0

            if required == 0:
                result.update({"score": 1.0, "detecte": f"{total_m} mois / 0 mois requis", "present": True})
                return result

            if not positions:
                score = min(1.0, total_m / required)
                result.update({
                    "score":   round(score, 4),
                    "detecte": f"{total_m} mois / {required} mois requis",
                    "present": score >= 1.0,
                })
                return result

            # phi4 juge quels postes sont pertinents pour le domaine requis
            domain_match = re.search(r'(?:en|in)\s+(.+)$', value, re.I)  # NOSONAR
            domain       = domain_match.group(1).strip() if domain_match else value

            positions_text = "\n".join([
                f"- {p.get('titre', '?')} @ {p.get('entreprise', '?')} ({p.get('duree_mois', 0)} mois)"
                for p in positions
            ])

            prompt = f"""You are a strict HR evaluator.

Job requires experience in: "{domain}"

Candidate positions:
{positions_text}

For each position decide if it is RELEVANT to "{domain}".
Be semantic — understand synonyms and related roles:
- "Cloud Infrastructure Lead" IS relevant to "DevOps Kubernetes Docker"
- "SRE Site Reliability" IS relevant to "DevOps Kubernetes Docker"
- "Scrum Master" IS relevant to "gestion de projet management"
- "Product Owner" IS relevant to "gestion de projet management"
- "Contrôleur de gestion" IS relevant to "finance comptabilité"
- "Administrateur réseau" IS relevant to "cybersécurité"
- "Security Analyst" IS relevant to "cybersécurité"

Return ONLY valid JSON:
{{
  "relevant_positions": [
    {{"titre": "string", "duree_mois": 0, "relevant": true or false, "reason": "string"}}
  ]
}}

JSON:"""

            raw               = call_qwen(prompt)
            parsed            = extract_json(raw)
            relevant_positions = parsed.get("relevant_positions", [])
            relevant_months    = sum(
                p.get("duree_mois", 0)
                for p in relevant_positions
                if p.get("relevant")
            )
            if not relevant_positions:
                relevant_months = total_m

            score = min(1.0, relevant_months / required)
            log.info("EXPERIENCE: domain='%s' required=%d relevant=%d score=%.4f",
                     domain, required, relevant_months, score)
            result.update({
                "score":   round(score, 4),
                "detecte": f"{relevant_months} mois pertinents / {required} mois requis",
                "present": score >= 1.0,
            })
            return result

        elif type_ == "DEGREE":
            if isinstance(field_val, dict):
                titre = field_val.get("titre") or ""
            elif isinstance(field_val, list):
                titres = [d.get("titre", "") for d in field_val if isinstance(d, dict) and d.get("titre")]
                titre  = titres[0] if titres else ""
            else:
                titre = str(field_val) if field_val else ""

            if not titre:
                result.update({"score": 0.0, "detecte": "", "present": False})
                return result

            # phi4 juge l'équivalence niveau académique + domaine
            prompt = f"""You are a strict HR evaluator specialized in academic degrees.

Job requires: "{value}"
Candidate has: "{titre}"

Academic levels (lowest to highest):
Bac < BTS/DUT < Licence/Bachelor/Bac+3 < Master/Ingénieur/Mastère/Bac+5 < PhD/Doctorat

IMPORTANT equivalences — these are EXACTLY the same level:
- Ingénieur = Ingénieurie = Cycle ingénieur = Diplôme ingénieur = Bac+5 ingénieur
- Master = Mastère = Bac+5 = M2 = DEA = DESS
- Licence = Bachelor = Bac+3 = L3
- BTS = DUT = Bac+2

Rules:
- Same level + same domain          → score 1.0   satisfied=true
- Same level + close domain         → score 0.85  satisfied=true
- Same level + different domain     → score 0.5   satisfied=false
- Lower level + same domain         → score 0.2   satisfied=false
- Lower level + different domain    → score 0.0   satisfied=false
- Higher level than required        → score 1.0   satisfied=true

Answer ONLY with valid JSON:
{{"satisfied": true or false, "score": 0.0 to 1.0, "reason": "short explanation in French"}}

JSON:"""

            raw    = call_qwen(prompt)
            parsed = extract_json(raw)
            score   = round(float(parsed.get("score",    0.0)), 4)
            present = bool(parsed.get("satisfied", False))
            reason  = parsed.get("reason", titre)
            log.info("DEGREE: value='%s' titre='%s' score=%.4f satisfied=%s", value, titre, score, present)
            result.update({"score": score, "detecte": f"{titre} — {reason}", "present": present})
            return result

        elif type_ == "LANGUAGE":
            if isinstance(field_val, list):
                lang_texts = [
                    f"{l.get('langue', '')} {l.get('niveau') or ''}".strip()
                    for l in field_val if isinstance(l, dict)
                ]
            else:
                lang_texts = [str(field_val)] if field_val else []
            score, best = cosine_max(lang_texts) if lang_texts else (0.0, "")
            result.update({"score": round(score, 4), "detecte": best, "present": score >= 0.55})
            return result

        elif type_ == "CERTIFICATION":
            if isinstance(field_val, list):
                certs = [str(c) for c in field_val if c]
            elif field_val:
                certs = [str(field_val)]
            else:
                certs = []

            if not certs:
                result.update({"score": 0.0, "detecte": "", "present": False})
                return result

            certs_str = ", ".join(certs)
            prompt = f"""You are a strict HR evaluator specialized in professional certifications.

Job requires certification: "{value}"
Candidate has: "{certs_str}"

Does the candidate have this certification or an equivalent one?
Answer ONLY with valid JSON:
{{"satisfied": true or false}}

JSON:"""
            raw    = call_qwen(prompt)
            parsed = extract_json(raw)
            present = bool(parsed.get("satisfied", False))
            result.update({
                "score":   1.0 if present else 0.0,
                "detecte": certs_str,
                "present": present,
            })
            return result

        else:
            # Champ custom → cosine similarity directe
            if isinstance(field_val, list):
                candidates = [
                    json.dumps(v, ensure_ascii=False) if isinstance(v, dict) else str(v)
                    for v in field_val if v
                ]
            elif isinstance(field_val, dict):
                candidates = [json.dumps(field_val, ensure_ascii=False)]
            elif field_val:
                candidates = [str(field_val)]
            else:
                candidates = []
            score, best = cosine_max(candidates) if candidates else (0.0, "")
            result.update({"score": round(score, 4), "detecte": best, "present": score >= 0.50})
            return result

    # ── Routing standard (sans champ custom) ─────────────────────────────────
    if type_ in ("DEGREE", "EDUCATION"):
        diplomas = extracted.get("all_diplomas") or []
        titles   = [d.get("titre", "") for d in diplomas if d.get("titre")]
        if not titles:
            dt = (extracted.get("degree") or {}).get("titre")
            if dt:
                titles = [dt]
        score, best = cosine_max(titles)
        result.update({"score": round(score, 4), "detecte": best, "present": score >= 0.55})

    elif type_ == "EXPERIENCE":
        exp      = extracted.get("experience") or {}
        total_m  = exp.get("total_months", 0)
        years_m  = re.search(r'(\d+)\s*an',    value, re.I)   # NOSONAR
        months_m = re.search(r'(\d+)\s*mois',  value, re.I)   # NOSONAR
        number_m = re.search(r'^\s*(\d+)\s*$', value.strip())  # NOSONAR
        if years_m:
            required = int(years_m.group(1)) * 12
        elif months_m:
            required = int(months_m.group(1))
        elif number_m:
            n = int(number_m.group(1))
            required = n if n > 12 else n * 12
        else:
            required = 0
        score = 1.0 if required == 0 else min(1.0, total_m / required)
        result.update({
            "score":   round(score, 4),
            "detecte": f"{total_m} mois / {required} mois requis",
            "present": score >= 1.0,
        })

    elif type_ == "LANGUAGE":
        langs      = extracted.get("languages") or []
        lang_texts = [f"{l.get('langue', '')} {l.get('niveau') or ''}".strip() for l in langs]
        score, best = cosine_max(lang_texts)
        result.update({"score": round(score, 4), "detecte": best, "present": score >= 0.55})

    elif type_ == "CERTIFICATION":
        certs = extracted.get("certifications") or []
        score, best = cosine_max([str(c) for c in certs])
        result.update({"score": round(score, 4), "detecte": best, "present": score >= 0.55})

    else:
        all_skills = (extracted.get("hard_skills") or []) + (extracted.get("soft_skills") or [])
        score, best = cosine_max(all_skills)
        result.update({"score": round(score, 4), "detecte": best, "present": score >= 0.50})

    log.info("score_prereq result: %s", result)
    return result


# ═════════════════════════════════════════════════════════════════════════════
# PIPELINE COMMUN — Extraction + Scoring (utilisé par /extract et /extract-text)
# ═════════════════════════════════════════════════════════════════════════════

def _run_pipeline(cv_text: str, prereqs: list, skills: list, job_id: str | None) -> dict:
    """
    Pipeline complet : texte brut → extraction phi4 → scoring bge-m3.

    Étapes :
      1. Préparation du texte (nettoyage + troncature)
      2. Construction du prompt dynamique
      3. Appel phi4 (Ollama)
      4. Parse JSON + recalcul expérience
      5. Encodage des lignes brutes en embeddings (filet de sécurité)
      6. Scoring des skills (bge-m3 cosine)
      7. Scoring des prérequis (phi4 juge + bge-m3 cosine selon type)

    Retourne : {extracted, skills_evalues, prerequis_evalues}
    """
    needs_hard = any((s.get("type") or "").upper() != "SOFT" for s in skills)
    needs_soft = any((s.get("type") or "").upper() == "SOFT" for s in skills)

    # Récupération du cache d'embeddings job (pré-calculés via /index-job)
    job_embs  = _job_embs_cache.get(job_id, {}) if job_id else {}
    cache_hit = len(job_embs) > 0
    log.info(
        "Matching — %d prérequis, %d skills (hard=%s soft=%s) — job cache: %s (%d termes)",
        len(prereqs), len(skills), needs_hard, needs_soft,
        "HIT" if cache_hit else "MISS", len(job_embs)
    )

    # ── Phase 2 : Extraction LLM
    text_for_qwen      = prepare_for_qwen(cv_text, max_chars=4000)
    fields, custom_map = build_extraction_fields(prereqs, needs_hard, needs_soft)
    prompt             = build_prompt_from_fields(text_for_qwen, fields)
    try:
        raw_qwen  = call_qwen(prompt)
        extracted = extract_json(raw_qwen) or {}
    except HTTPException:
        log.warning("Ollama unavailable — using regex fallback extraction")
        _lang_re = re.compile(
            r'\b(english|french|arabic|german|spanish|italian|dutch|chinese|japanese)\b'
            r'[\s:–\-]*([a-cA-C][12]|native|fluent|bilingual|professionnel|courant|notions)?',
            re.I,
        )
        _languages: list = []
        for _m in _lang_re.finditer(cv_text):
            _label = f"{_m.group(1).capitalize()} {(_m.group(2) or '').strip()}".strip()
            if _label not in _languages:
                _languages.append(_label)

        _diploma_re = re.compile(
            r'\b(master\s*\d*|licence|bachelor|ing[eé]nieur|engineering|phd|doctorat'
            r'|bts|dut|mba|m\.?s\.?c\.?|b\.?s\.?c\.?)\b',
            re.I,
        )
        _diplomas = list({_m.group(0).strip().title() for _m in _diploma_re.finditer(cv_text)})

        _cert_re = re.compile(
            r'\b(aws|azure|gcp|pmp|cissp|itil|scrum|comptia|prince2|cka|ckad|tensorflow|pytorch)\b',
            re.I,
        )
        _certs = list({_m.group(0).strip().upper() for _m in _cert_re.finditer(cv_text)})

        extracted = {
            "hard_skills":    [],
            "soft_skills":    [],
            "experience":     {"total_months": 0, "positions": []},
            "degree":         _diplomas[0] if _diplomas else None,
            "all_diplomas":   _diplomas,
            "languages":      _languages,
            "certifications": _certs,
        }
    extracted          = recalculate_experience(extracted)

    log.info(
        "EXTRACTION COMPLETE: hard_skills=%d diplomas=%d exp=%d mois",
        len(extracted.get("hard_skills") or []),
        len(extracted.get("all_diplomas") or []),
        (extracted.get("experience") or {}).get("total_months", 0),
    )
    print("\n" + "═" * 60)
    print("EXTRACTION CV COMPLÈTE")
    print("═" * 60)
    print(json.dumps(extracted, indent=2, ensure_ascii=False))
    print("═" * 60 + "\n")

    # ── Phase 3 : Encodage des lignes brutes (bge-m3)
    paragraphs  = [p.strip() for p in re.split(r'\n{2,}', cv_text) if p.strip()] or [cv_text]  # NOSONAR
    seen_lower: set  = set()
    unique_lines: list = []
    for para in paragraphs:
        for seg in re.split(r'[,;\n]+', para):  # NOSONAR
            seg = seg.strip()
            if 2 <= len(seg) <= 80 and seg.lower() not in seen_lower:
                seen_lower.add(seg.lower())
                unique_lines.append(seg)

    if _embed_model is not None and unique_lines:
        line_embs: np.ndarray = _embed_model.encode(unique_lines, show_progress_bar=False)
    else:
        line_embs = np.zeros((0, 384))

    # ── Scoring des skills
    skills_evalues = []
    for skill in skills:
        nom        = (skill.get("nom") or skill.get("name") or "").strip()
        skill_type = (skill.get("type") or "TECHNICAL").upper()
        if not nom:
            continue
        extracted_list = extracted.get("soft_skills" if skill_type == "SOFT" else "hard_skills") or []
        precomp        = job_embs.get(nom)
        score = score_skill_vs_list(nom, extracted_list, line_embs, _embed_model, precomp)
        log.info("'%s' type=%s score=%.4f%s", nom, skill_type, score,
                 " [cached-emb]" if precomp is not None else "")
        skills_evalues.append({
            "nom":     nom,
            "type":    skill_type,
            "score":   round(score, 4),
            "present": score >= 0.55,
            "weight":  skill.get("weight", 1),
        })

    # ── Scoring des prérequis
    prerequis_evalues = [
        score_prereq_from_extraction(
            p, extracted, _embed_model,
            custom_field_name=custom_map.get(i),
            precomp_req_emb=job_embs.get((p.get("value") or "").strip()),
        )
        for i, p in enumerate(prereqs)
    ]

    log.info("Matching terminé — %d skills, %d prérequis", len(skills_evalues), len(prerequis_evalues))
    return {
        "extracted":         extracted,
        "skills_evalues":    skills_evalues,
        "prerequis_evalues": prerequis_evalues,
    }


# ═════════════════════════════════════════════════════════════════════════════
# UTILITAIRES
# ═════════════════════════════════════════════════════════════════════════════

def compute_embeddings(terms: list) -> dict:
    """Encode une liste de termes et retourne {terme: vecteur} (pour l'endpoint /embed)."""
    if not terms or _embed_model is None:
        return {}
    vecs = _embed_model.encode(terms, show_progress_bar=False, convert_to_numpy=True)
    return {term: vec.tolist() for term, vec in zip(terms, vecs)}


def cosine_sim_np(a, b) -> float:
    """
    Cosine similarity entre deux vecteurs numpy.
    Formule : cos(θ) = (A · B) / (‖A‖ × ‖B‖)
    Retourne 0.0 si l'un des vecteurs est nul.
    """
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


# ═════════════════════════════════════════════════════════════════════════════
# ENDPOINTS REST
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    """Endpoint de santé — vérifie que le service est opérationnel."""
    return {
        "status":      "ok",
        "model":       EMBED_MODEL,
        "qwen":        QWEN_MODEL,
        "pdfplumber":  _PDFPLUMBER_AVAILABLE,
        "esco":        "enabled",
        "cached_jobs": len(_job_embs_cache),
    }


@app.post("/extract")
async def extract(
    fichier:           UploadFile = File(...),
    job_prerequisites: str        = Form(default=None),
    job_skills:        str        = Form(default=None),
    job_id:            str        = Form(default=None),
):
    """
    Endpoint principal : reçoit un PDF, le lit, l'extrait avec phi4 et le score avec bge-m3.
    Appelé par hf.service.js → extractCVFromPDFBuffer() et matchCVToJobs().
    """
    data = await fichier.read()
    if not data:
        return {"texte_brut": "", "extracted": {}, "skills_evalues": [], "prerequis_evalues": []}

    text = read_cv(data, fichier.filename or "cv.pdf")
    if not text.strip():
        log.warning("CV illisible — retour structure vide")
        return {"texte_brut": "", "extracted": {}, "skills_evalues": [], "prerequis_evalues": []}

    prereqs: list = []
    if job_prerequisites:
        try:
            prereqs = json.loads(job_prerequisites) or []
        except json.JSONDecodeError:
            pass

    skills: list = []
    if job_skills:
        try:
            skills = json.loads(job_skills) or []
        except json.JSONDecodeError:
            pass

    result               = _run_pipeline(text, prereqs, skills, job_id)
    result["texte_brut"] = text[:5000]
    return result


class ExtractTextRequest(BaseModel):
    text:              str
    job_skills:        list = []
    job_prerequisites: list = []
    job_id:            str | None = None


@app.post("/extract-text")
async def extract_from_text(req: ExtractTextRequest):
    """
    Même pipeline que /extract mais depuis un texte brut (pas de PDF).
    Appelé par hf.service.js → extractCVData() et matchCVToJobs() sans pdfBuffer.
    """
    text = (req.text or "").strip()
    if not text:
        return {"texte_brut": "", "extracted": {}, "skills_evalues": [], "prerequis_evalues": []}
    result               = _run_pipeline(text, req.job_prerequisites or [], req.job_skills or [], req.job_id)
    result["texte_brut"] = text[:5000]
    return result


class ScoreSkillsRequest(BaseModel):
    cv_hard_skills:    list = []
    cv_soft_skills:    list = []
    cv_raw_text:       str  = ""
    cv_extracted:      dict = {}
    job_skills:        list = []
    job_prerequisites: list = []
    job_id:            str  = ""


@app.post("/score-skills")
async def score_skills_endpoint(req: ScoreSkillsRequest):
    """
    Scoring bge-m3 uniquement, sans appel LLM.
    Utilisé pour les recommandations de jobs (CV déjà extrait, pas besoin de re-extraire).
    Appelé par hf.service.js → scoreSkillsForJob().
    """
    raw_lines = [l.strip() for l in req.cv_raw_text.split('\n') if l.strip()][:200]
    if _embed_model is not None and raw_lines:
        line_embs = _embed_model.encode(raw_lines, show_progress_bar=False)
    else:
        line_embs = np.zeros((0, 384))

    skills_evalues = []
    for skill in req.job_skills:
        nom = (skill.get("nom") or skill.get("name") or "").strip()
        if not nom:
            continue
        skill_type = (skill.get("type") or "TECHNICAL").upper()
        cv_list    = req.cv_soft_skills if skill_type == "SOFT" else req.cv_hard_skills
        score      = score_skill_vs_list(nom, cv_list, line_embs, _embed_model, None)
        log.info("score-skills: '%s' type=%s score=%.4f", nom, skill_type, score)
        skills_evalues.append({
            "nom":     nom,
            "type":    skill_type,
            "score":   round(score, 4),
            "present": score >= 0.55,
            "weight":  skill.get("weight", 1),
        })

    prereq_evalues = [
        score_prereq_from_extraction(p, req.cv_extracted, _embed_model)
        for p in req.job_prerequisites
    ]

    return {"skills_evalues": skills_evalues, "prerequis_evalues": prereq_evalues}


class IndexJobRequest(BaseModel):
    job_id:        str
    skills:        list
    prerequisites: list


@app.post("/index-job")
def index_job(req: IndexJobRequest):
    """
    Pré-calcule et met en cache les embeddings bge-m3 de tous les skills et prérequis du job.
    Appelé une seule fois à la création du job (hf.service.js → encodeJobSkills).
    Évite de recalculer les mêmes embeddings à chaque candidature.
    """
    if _embed_model is None:
        raise HTTPException(status_code=503, detail="Modèle non chargé.")

    terms = []
    for s in req.skills:
        t = (s.get("nom") or s.get("name") or "").strip()
        if t:
            terms.append(t)
    for p in req.prerequisites:
        v = (p.get("value") or "").strip()
        if v:
            terms.append(v)

    seen: set = set()
    unique_terms = [t for t in terms if not (t in seen or seen.add(t))]

    if not unique_terms:
        _job_embs_cache[req.job_id] = {}
        return {"job_id": req.job_id, "indexed": 0}

    embs = _embed_model.encode(unique_terms, show_progress_bar=False)
    _job_embs_cache[req.job_id] = {t: embs[i] for i, t in enumerate(unique_terms)}

    log.info("/index-job: job=%s — %d termes indexés", req.job_id, len(unique_terms))
    return {"job_id": req.job_id, "indexed": len(unique_terms)}


@app.delete("/index-job/{job_id}")
def delete_job_index(job_id: str):
    """Supprime les embeddings d'un job du cache mémoire (appelé à la suppression du job)."""
    removed = job_id in _job_embs_cache
    _job_embs_cache.pop(job_id, None)
    log.info("/index-job/%s supprimé du cache (%s)", job_id, "ok" if removed else "absent")
    return {"job_id": job_id, "removed": removed}


@app.get("/index-job/status")
def index_job_status():
    """Retourne l'état du cache d'embeddings (nombre de jobs indexés et leurs tailles)."""
    return {
        "cached_jobs": len(_job_embs_cache),
        "jobs":        {jid: len(embs) for jid, embs in _job_embs_cache.items()},
    }


class EmbedRequest(BaseModel):
    textes: list


@app.post("/embed")
def embed(req: EmbedRequest):
    """Encode une liste de textes en vecteurs bge-m3 (usage général)."""
    if not req.textes:
        return {"embeddings": {}}
    return {"embeddings": compute_embeddings(req.textes)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv("BIND_HOST", "127.0.0.1"), port=int(os.getenv("PORT", 8000)))