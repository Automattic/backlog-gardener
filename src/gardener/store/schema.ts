export const MIGRATIONS: Array<{ id: number; name: string; sql: string }> = [
  {
    id: 1,
    name: 'initial',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        profile_slug TEXT NOT NULL,
        lane TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        summary_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS watermarks (
        profile_slug TEXT NOT NULL,
        source_key TEXT NOT NULL,
        last_seen_updated_at TEXT NOT NULL,
        cursor TEXT,
        PRIMARY KEY (profile_slug, source_key)
      );

      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        source_key TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        author TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        latest_snapshot_hash TEXT,
        reference_only INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        raw_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE (source_key, source_id)
      );

      CREATE TABLE IF NOT EXISTS replies (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        source_reply_id TEXT NOT NULL,
        author TEXT,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        raw_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE (item_id, source_reply_id)
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        snapshot_hash TEXT NOT NULL UNIQUE,
        body_hash TEXT NOT NULL,
        taken_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        vector_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (item_id, provider, model, body_hash)
      );

      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        item_a_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        item_b_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        verdict TEXT NOT NULL,
        score REAL,
        reason TEXT NOT NULL,
        review_policy_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (item_a_id, item_b_id, review_policy_hash)
      );

      CREATE TABLE IF NOT EXISTS clusters (
        id TEXT PRIMARY KEY,
        theme TEXT NOT NULL,
        representative_item_id TEXT,
        review_policy_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cluster_items (
        cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        PRIMARY KEY (cluster_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        review_policy_hash TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL DEFAULT '',
        recap_json TEXT NOT NULL,
        attention_facts_json TEXT NOT NULL,
        decision_json TEXT NOT NULL,
        surfacing_label TEXT,
        lifecycle_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
        verdict TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        reviewer TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (finding_id, reviewer)
      );

      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        kind TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS publications (
        id TEXT PRIMARY KEY,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        finding_id TEXT REFERENCES findings(id) ON DELETE CASCADE,
        publisher TEXT NOT NULL,
        destination TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (finding_id, publisher, destination)
      );
    `,
  },
  {
    id: 2,
    name: 'evaluation_and_verification',
    sql: `
      CREATE TABLE IF NOT EXISTS evaluations (
        id TEXT PRIMARY KEY,
        finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        action TEXT NOT NULL,
        confidence TEXT NOT NULL,
        reason TEXT NOT NULL,
        developer_summary TEXT NOT NULL,
        recommended_next_step TEXT NOT NULL,
        proposed_external_comment TEXT,
        requires_human_approval INTEGER NOT NULL DEFAULT 0,
        risk_flags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS verifications (
        id TEXT PRIMARY KEY,
        finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
        evaluation_id TEXT REFERENCES evaluations(id) ON DELETE SET NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        action TEXT NOT NULL,
        confidence TEXT NOT NULL,
        subsystem TEXT NOT NULL,
        likely_files_json TEXT NOT NULL DEFAULT '[]',
        hypotheses_json TEXT NOT NULL DEFAULT '[]',
        suggested_repro_steps_json TEXT NOT NULL DEFAULT '[]',
        suggested_tests_json TEXT NOT NULL DEFAULT '[]',
        developer_notes TEXT NOT NULL,
        requires_human_approval INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `,
  },
];
