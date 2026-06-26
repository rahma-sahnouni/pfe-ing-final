"""
run.py — Point d'entrée du microservice FastAPI NexGenAI
=========================================================
Lance uvicorn sur le port 8000.
Sur Windows, applique WindowsSelectorEventLoopPolicy pour la compatibilité asyncio.
"""

import sys

# ── Correctif Windows : la politique d'event loop par défaut (ProactorEventLoop)
# est incompatible avec certaines opérations réseau d'uvicorn.
# WindowsSelectorEventLoopPolicy règle ce problème sans affecter Linux/macOS.
if sys.platform == 'win32':
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

if __name__ == '__main__':
    uvicorn.run(
        'main:app',          # module:variable — charge app = FastAPI() depuis main.py
        host='0.0.0.0',      # écoute sur toutes les interfaces réseau (pas seulement localhost)
        port=8000,           # port utilisé par hf.service.js (HF_API_URL=http://localhost:8000)
        log_level='info',    # affiche les requêtes entrantes dans la console
        loop='none',         # désactive la création automatique d'event loop par uvicorn
                             # (on la gère nous-mêmes via la politique Windows ci-dessus)
    )