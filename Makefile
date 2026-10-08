# Local dev for agentic-upsell (FastAPI, :8100) and aidmvcs-be-dev (Next.js, :3000).
# Run `make help` for the list.

UPSELL := agentic-upsell
BE     := aidmvcs-be-dev

PY := python
ifeq ($(OS),Windows_NT)
BIN := .venv/Scripts
FIX_PATH = $(subst /,\,$1)
else
BIN := .venv/bin
FIX_PATH = $1
endif

# The one local DB both seeders write to. Defaults to the DB be-dev's .env.local
# uses, so the CRM UI shows the seeded data. Override: make seed SEED_DB=...
SEED_DB ?= mongodb://127.0.0.1:27017/emailai

.PHONY: help infra infra-down setup upsell-setup be-setup \
        upsell upsell-worker upsell-debug-ui upsell-test upsell-eval \
        be be-worker dev \n        seed seed-crm seed-ai

help:
	@echo "infra           start mongo/redis/mysql/postgres/n8n (docker compose)"
	@echo "infra-down      stop the docker services"
	@echo "setup           upsell-setup + be-setup"
	@echo "upsell-setup    create venv, install upsell deps, copy .env"
	@echo "be-setup        npm install for be-dev"
	@echo "upsell          run upsell API on :8100 with reload"
	@echo "upsell-worker   run upsell SAQ job worker"
	@echo "upsell-debug-ui run the upsell debug UI (vite)"
	@echo "upsell-test     run upsell unit tests"
	@echo "upsell-eval     run upsell eval gate"
	@echo "be              run be-dev Next.js on :3000"
	@echo "be-worker       run be-dev background worker"
	@echo "seed            seed CRM + AI layer demo data into SEED_DB"
	@echo "seed-crm        seed CRM only (demo dealer, staff, stock, leads, customers)"
	@echo "seed-ai         seed AI layer only (2 dev dealers, customers, leads, campaign)"
	@echo "dev             infra + upsell + be together"

# ---- shared infra ----------------------------------------------------------
infra:
	docker compose up -d mongodb redis

infra-down:
	docker compose stop

ifeq ($(OS),Windows_NT)
COPY_ENV := powershell -Command "if (-not (Test-Path '$(UPSELL)\.env')) { Copy-Item '$(UPSELL)\.env.example' '$(UPSELL)\.env' }"
else
COPY_ENV := test -f $(UPSELL)/.env || cp $(UPSELL)/.env.example $(UPSELL)/.env
endif

ifeq ($(OS),Windows_NT)
CREATE_VENV := powershell -Command "if (-not (Test-Path '.venv')) { $(PY) -m venv .venv }"
else
CREATE_VENV := test -d .venv || $(PY) -m venv .venv
endif

# ---- setup -----------------------------------------------------------------
setup: upsell-setup be-setup

upsell-setup:
	cd $(UPSELL) && $(CREATE_VENV)
	cd $(UPSELL) && "$(BIN)/python" -m pip install -e ".[dev]"
	@$(COPY_ENV)

be-setup:
	cd $(BE) && npm install

# ---- agentic-upsell --------------------------------------------------------
upsell:
	cd $(UPSELL) && "$(BIN)/uvicorn" upsell_agent.main:app --reload --port 8100

upsell-worker:
	cd $(UPSELL) && "$(BIN)/saq" upsell_agent.worker.main.settings

upsell-debug-ui:
	cd $(UPSELL)/debug-ui && npm install && npm run dev

upsell-test:
	cd $(UPSELL) && "$(BIN)/pytest" tests -v

upsell-eval:
	cd $(UPSELL) && "$(BIN)/pytest" evals -v

# ---- aidmvcs-be-dev --------------------------------------------------------
be:
	cd $(BE) && npm run dev

be-worker:
	cd $(BE) && npm run worker

# ---- everything ------------------------------------------------------------
# -j2 runs both servers in parallel in one terminal; Ctrl+C stops both.
dev: infra
	$(MAKE) -j2 upsell be

# ---- local demo data -------------------------------------------------------
# Both seeders refuse non-local hosts and wipe only their own demo data on re-run.
seed: seed-crm seed-ai

# Target-specific exports, so this works whichever shell make picks.
seed-crm seed-ai: export MONGODB_URI := $(SEED_DB)
seed-ai: export ENVIRONMENT := DEV

seed-crm:
	cd $(BE) && node scripts/seed-local-crm.js

seed-ai:
	cd $(UPSELL) && "$(BIN)/python" -m upsell_agent.devtools.seed
