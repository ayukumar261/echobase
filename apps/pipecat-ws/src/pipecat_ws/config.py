from __future__ import annotations

import os

GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1"

ADVISOR_MODEL = "anthropic/claude-opus-4-7"
EXECUTOR_MODEL = "anthropic/claude-haiku-4.5"

MAX_EXECUTORS_PER_SESSION = 12
MAX_PARALLEL_EXECUTORS = 4

ADVISOR_TIMEOUT_S = 30.0
EXECUTOR_TIMEOUT_S = 45.0
