import json
import os
import urllib.error
import urllib.request
from urllib.parse import urlparse
from datetime import datetime
from typing import Any, Dict, List, Optional

try:
    import psycopg
    from pgvector.psycopg import register_vector
    from pgvector import Vector
except Exception:
    psycopg = None
    register_vector = None
    Vector = None


def _clean_env(name: str, default: str = "") -> str:
    value = os.getenv(name, default)
    if value is None:
        return default
    value = value.strip()
    if len(value) >= 2 and ((value[0] == '"' and value[-1] == '"') or (value[0] == "'" and value[-1] == "'")):
        value = value[1:-1]
    return value.strip()


class AzureOpenAIClient:
    def __init__(self):
        raw_endpoint = _clean_env("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
        self.endpoint = self._normalize_endpoint(raw_endpoint)
        self.api_key = _clean_env("AZURE_OPENAI_API_KEY", "")
        self.api_version = _clean_env("AZURE_OPENAI_API_VERSION", "2024-10-21")
        self.embedding_deployment = _clean_env("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-small")
        self.chat_deployment = _clean_env("AZURE_OPENAI_CHAT_DEPLOYMENT", "gpt-5-mini")

    def _normalize_endpoint(self, endpoint: str) -> str:
        if not endpoint:
            return ""
        parsed = urlparse(endpoint)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
        return endpoint.rstrip("/")

    @property
    def configured(self) -> bool:
        return bool(self.endpoint and self.api_key and self.embedding_deployment and self.chat_deployment)

    def _post(self, url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        req = urllib.request.Request(
            url=url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "api-key": self.api_key,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Azure OpenAI HTTPError: {e.code} {detail}") from e
        except Exception as e:
            raise RuntimeError(f"Azure OpenAI request failed: {e}") from e

    def embed_text(self, text: str) -> List[float]:
        url = (
            f"{self.endpoint}/openai/deployments/{self.embedding_deployment}/embeddings"
            f"?api-version={self.api_version}"
        )
        payload = {
            "input": text,
            "model": "text-embedding-3-small",
        }
        data = self._post(url, payload)
        return data["data"][0]["embedding"]

    def chat_similarity_and_solution(self, current_summary: str, candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
        url = (
            f"{self.endpoint}/openai/deployments/{self.chat_deployment}/chat/completions"
            f"?api-version={self.api_version}"
        )

        system = (
            "あなたは微生物シミュレーション向けAIサポートです。"
            "現在状態と類似ケースを比較し、実行可能な打ち手を提案してください。"
            "必ず日本語で回答し、JSONのみを返してください。"
            "JSONキーは必ず summary, recommended_action, param_updates, reasoning, ranked_case_ids を使用してください。"
            "param_updates は数値・文字列・真偽値またはオブジェクトを値に持つ辞書にしてください。"
        )
        user = {
            "current": current_summary,
            "candidates": candidates,
        }

        payload = {
            "model": "gpt-5-mini",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
            ],
        }
        data = self._post(url, payload)
        content = data["choices"][0]["message"]["content"]

        try:
            return json.loads(content)
        except Exception:
            cleaned = content.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.strip("`")
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:].strip()
            try:
                return json.loads(cleaned)
            except Exception:
                pass
            return {
                "summary": "gpt-5-mini の出力をJSON化できなかったため、候補をそのまま返します。",
                "recommended_action": "manual_review",
                "param_updates": {},
                "reasoning": content,
                "ranked_case_ids": [c.get("id") for c in candidates],
            }


class SupabaseVectorStore:
    def __init__(self):
        self.db_url = _clean_env("SUPABASE_DB_URL", "")
        self.azure = AzureOpenAIClient()
        self.enabled = bool(self.db_url and self.azure.configured and psycopg is not None and register_vector is not None and Vector is not None)
        self._init_error: Optional[str] = None

        if psycopg is None or register_vector is None or Vector is None:
            self._init_error = "psycopg/pgvector is not installed"

        if self.enabled:
            try:
                self._init_db()
            except Exception as e:
                self.enabled = False
                self._init_error = str(e)

    def _connect(self, register: bool = True):
        conn = psycopg.connect(self.db_url)
        if register and register_vector is not None:
            register_vector(conn)
        return conn

    def _init_db(self):
        with self._connect(register=False) as conn:
            with conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            conn.commit()

            register_vector(conn)

            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS ai_case_vectors (
                        id BIGSERIAL PRIMARY KEY,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        case_text TEXT NOT NULL,
                        before_json JSONB NOT NULL,
                        after_json JSONB NOT NULL,
                        action_json JSONB,
                        embedding vector(1536) NOT NULL
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ai_case_vectors_embedding_idx
                    ON ai_case_vectors USING ivfflat (embedding vector_cosine_ops)
                    """
                )
            conn.commit()

    def _make_case_text(self, before_snapshot: Dict[str, Any], after_snapshot: Dict[str, Any], action: Optional[Dict[str, Any]]) -> str:
        b_env = before_snapshot.get("env", {})
        a_env = after_snapshot.get("env", {})
        b_stats = before_snapshot.get("stats", {})
        a_stats = after_snapshot.get("stats", {})
        action_text = json.dumps(action, ensure_ascii=False) if action else "none"

        return (
            f"before: S={b_env.get('S')} pH={b_env.get('pH')} temp={b_env.get('temp')} rad={b_env.get('rad')} "
            f"total_N={b_stats.get('total_N')} active={b_stats.get('active_strains')} | "
            f"action: {action_text} | "
            f"after: S={a_env.get('S')} pH={a_env.get('pH')} temp={a_env.get('temp')} rad={a_env.get('rad')} "
            f"total_N={a_stats.get('total_N')} active={a_stats.get('active_strains')}"
        )

    def ingest_case(self, before_snapshot: Dict[str, Any], after_snapshot: Dict[str, Any], action: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self._init_error or "AI store is not configured"}

        case_text = self._make_case_text(before_snapshot, after_snapshot, action)
        embedding = self.azure.embed_text(case_text)

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ai_case_vectors (case_text, before_json, after_json, action_json, embedding)
                    VALUES (%s, %s::jsonb, %s::jsonb, %s::jsonb, %s)
                    RETURNING id
                    """,
                    (
                        case_text,
                        json.dumps(before_snapshot, ensure_ascii=False),
                        json.dumps(after_snapshot, ensure_ascii=False),
                        json.dumps(action, ensure_ascii=False) if action else None,
                        embedding,
                    ),
                )
                row = cur.fetchone()
            conn.commit()

        return {
            "ok": True,
            "case_id": int(row[0]),
            "stored_at": datetime.utcnow().isoformat(),
        }

    def retrieve_similar(self, current_snapshot: Dict[str, Any], top_k: int = 8) -> Dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self._init_error or "AI store is not configured"}

        current_text = self._make_case_text(current_snapshot, current_snapshot, None)
        query_embedding = self.azure.embed_text(current_text)
        query_vector = Vector(query_embedding)

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SET LOCAL ivfflat.probes = 100")
                cur.execute(
                    """
                    SELECT id, case_text, before_json, after_json, action_json,
                           1 - (embedding <=> %s) AS cosine_similarity
                    FROM ai_case_vectors
                    ORDER BY embedding <=> %s
                    LIMIT %s
                    """,
                          (query_vector, query_vector, max(1, top_k)),
                )
                rows = cur.fetchall()

                if len(rows) == 0:
                    cur.execute(
                        """
                        SELECT id, case_text, before_json, after_json, action_json,
                               1 - (embedding <=> %s) AS cosine_similarity
                        FROM ai_case_vectors
                        ORDER BY id DESC
                        LIMIT %s
                        """,
                        (query_vector, max(1, top_k)),
                    )
                    rows = cur.fetchall()

        candidates = []
        for row in rows:
            candidates.append(
                {
                    "id": int(row[0]),
                    "case_text": row[1],
                    "before": row[2],
                    "after": row[3],
                    "action": row[4],
                    "cosine_similarity": float(row[5]),
                }
            )

        recommendation = self.azure.chat_similarity_and_solution(current_text, candidates)
        return {
            "ok": True,
            "retrieved": len(candidates),
            "model": {
                "embedding": "text-embedding-3-small",
                "similarity_rerank": "gpt-5-mini",
            },
            "recommendation": recommendation,
            "candidates": candidates,
        }


ai_vector_store = SupabaseVectorStore()
