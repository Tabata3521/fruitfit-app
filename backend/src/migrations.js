export const migrations = [
  {
    id: "001_core_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        email text,
        name text,
        username text,
        photo_url text,
        role text NOT NULL DEFAULT 'user',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
        ON users (lower(email))
        WHERE email IS NOT NULL;

      CREATE TABLE IF NOT EXISTS auth_identities (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider text NOT NULL,
        provider_user_id text NOT NULL,
        profile jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_user_id)
      );

      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        profile jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS user_access (
        user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'free',
        plan text,
        premium_until timestamptz,
        is_vip boolean NOT NULL DEFAULT false,
        source text,
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS payments (
        id text PRIMARY KEY,
        user_id text REFERENCES users(id) ON DELETE SET NULL,
        provider text NOT NULL,
        provider_payment_id text,
        status text NOT NULL,
        amount numeric(12,2) NOT NULL DEFAULT 0,
        currency text NOT NULL DEFAULT 'RUB',
        product_code text,
        raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments (user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_unique
        ON payments (provider, provider_payment_id)
        WHERE provider_payment_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS conversions (
        id bigserial PRIMARY KEY,
        user_id text REFERENCES users(id) ON DELETE SET NULL,
        source text,
        campaign text,
        event text NOT NULL,
        value numeric(12,2),
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS referrals (
        id bigserial PRIMARY KEY,
        referrer_user_id text REFERENCES users(id) ON DELETE SET NULL,
        referred_user_id text REFERENCES users(id) ON DELETE SET NULL,
        code text,
        status text NOT NULL DEFAULT 'pending',
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS referrals_code_idx ON referrals (code);

      CREATE TABLE IF NOT EXISTS push_tokens (
        id bigserial PRIMARY KEY,
        user_id text REFERENCES users(id) ON DELETE CASCADE,
        platform text,
        token text NOT NULL UNIQUE,
        enabled boolean NOT NULL DEFAULT true,
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS vip_reports (
        id text PRIMARY KEY,
        user_id text REFERENCES users(id) ON DELETE SET NULL,
        status text NOT NULL DEFAULT 'draft',
        title text,
        report jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS measurements (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        measured_at timestamptz NOT NULL DEFAULT now(),
        values jsonb NOT NULL DEFAULT '{}'::jsonb,
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS measurements_user_time_idx
        ON measurements (user_id, measured_at DESC);

      CREATE TABLE IF NOT EXISTS progress_photos (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        taken_at timestamptz NOT NULL DEFAULT now(),
        storage_key text NOT NULL,
        public_url text,
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS progress_photos_user_time_idx
        ON progress_photos (user_id, taken_at DESC);

      CREATE TABLE IF NOT EXISTS trainer_notes (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        trainer_user_id text REFERENCES users(id) ON DELETE SET NULL,
        note text NOT NULL,
        visibility text NOT NULL DEFAULT 'trainer',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS user_program_progress (
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        program_id text NOT NULL,
        state jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, program_id)
      );
    `
  },
  {
    id: "002_catalog_and_nutrition",
    sql: `
      CREATE TABLE IF NOT EXISTS catalog_documents (
        key text PRIMARY KEY,
        data jsonb NOT NULL,
        source_path text,
        imported_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS products (
        id bigint PRIMARY KEY,
        name text NOT NULL,
        brand text,
        category text,
        kcal_per_100 numeric NOT NULL DEFAULT 0,
        protein_per_100 numeric NOT NULL DEFAULT 0,
        fat_per_100 numeric NOT NULL DEFAULT 0,
        carbs_per_100 numeric NOT NULL DEFAULT 0,
        serving_examples jsonb NOT NULL DEFAULT '[]'::jsonb,
        default_serving_grams numeric,
        source text,
        is_verified boolean NOT NULL DEFAULT false,
        country text NOT NULL DEFAULT 'RU',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS products_name_lower_idx ON products (lower(name));
      CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);

      CREATE TABLE IF NOT EXISTS product_aliases (
        id bigserial PRIMARY KEY,
        product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        alias text NOT NULL,
        UNIQUE (product_id, alias)
      );

      CREATE INDEX IF NOT EXISTS product_aliases_alias_lower_idx ON product_aliases (lower(alias));

      CREATE TABLE IF NOT EXISTS user_custom_products (
        id text PRIMARY KEY,
        user_id text REFERENCES users(id) ON DELETE CASCADE,
        name text NOT NULL,
        kcal_per_100 numeric NOT NULL DEFAULT 0,
        protein_per_100 numeric NOT NULL DEFAULT 0,
        fat_per_100 numeric NOT NULL DEFAULT 0,
        carbs_per_100 numeric NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `
  },
  {
    id: "003_push_notifications",
    sql: `
      ALTER TABLE push_tokens
        ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'fcm',
        ADD COLUMN IF NOT EXISTS device_id text,
        ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

      CREATE INDEX IF NOT EXISTS push_tokens_user_enabled_idx
        ON push_tokens (user_id, enabled);

      CREATE INDEX IF NOT EXISTS push_tokens_device_idx
        ON push_tokens (device_id)
        WHERE device_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS notification_events (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind text NOT NULL DEFAULT 'general',
        title text NOT NULL,
        body text NOT NULL DEFAULT '',
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'queued',
        scheduled_at timestamptz,
        sent_at timestamptz,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS notification_events_user_created_idx
        ON notification_events (user_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS notification_events_status_scheduled_idx
        ON notification_events (status, scheduled_at);

      CREATE UNIQUE INDEX IF NOT EXISTS notification_events_user_kind_schedule_unique
        ON notification_events (user_id, kind, scheduled_at)
        WHERE scheduled_at IS NOT NULL;
    `
  },
  {
    id: "004_push_admin_infra",
    sql: `
      CREATE TABLE IF NOT EXISTS push_campaigns (
        id text PRIMARY KEY,
        title text NOT NULL,
        body text NOT NULL DEFAULT '',
        audience text NOT NULL DEFAULT 'all',
        scheduled_at timestamptz,
        sent_at timestamptz,
        status text NOT NULL DEFAULT 'draft',
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS push_campaigns_status_scheduled_idx
        ON push_campaigns (status, scheduled_at);

      CREATE INDEX IF NOT EXISTS push_campaigns_created_idx
        ON push_campaigns (created_at DESC);

      CREATE TABLE IF NOT EXISTS push_logs (
        id bigserial PRIMARY KEY,
        campaign_id text REFERENCES push_campaigns(id) ON DELETE SET NULL,
        user_id text REFERENCES users(id) ON DELETE SET NULL,
        token_id bigint REFERENCES push_tokens(id) ON DELETE SET NULL,
        status text NOT NULL,
        provider_message_id text,
        error text,
        sent_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS push_logs_campaign_idx
        ON push_logs (campaign_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS push_logs_user_idx
        ON push_logs (user_id, created_at DESC);
    `
  },
  {
    id: "005_access_e2e_auth",
    sql: `
      ALTER TABLE user_access
        ADD COLUMN IF NOT EXISTS starts_at timestamptz,
        ADD COLUMN IF NOT EXISTS expires_at timestamptz,
        ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

      UPDATE user_access
      SET expires_at = premium_until
      WHERE expires_at IS NULL
        AND premium_until IS NOT NULL;

      CREATE INDEX IF NOT EXISTS user_access_status_idx
        ON user_access (status);

      CREATE INDEX IF NOT EXISTS user_access_active_expires_idx
        ON user_access (is_active, expires_at);
    `
  },
  {
    id: "006_auth_devices_and_identity_links",
    sql: `
      ALTER TABLE auth_identities
        ADD COLUMN IF NOT EXISTS provider_email text,
        ADD COLUMN IF NOT EXISTS provider_username text,
        ADD COLUMN IF NOT EXISTS linked_at timestamptz,
        ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
        ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

      UPDATE auth_identities
      SET provider_email = COALESCE(provider_email, profile->>'email'),
          provider_username = COALESCE(provider_username, profile->>'username', profile->>'login'),
          linked_at = COALESCE(linked_at, created_at),
          last_login_at = COALESCE(last_login_at, updated_at, created_at),
          metadata_json = COALESCE(metadata_json, '{}'::jsonb)
      WHERE provider_email IS NULL
         OR provider_username IS NULL
         OR linked_at IS NULL
         OR last_login_at IS NULL;

      ALTER TABLE auth_identities
        ALTER COLUMN linked_at SET DEFAULT now(),
        ALTER COLUMN last_login_at SET DEFAULT now();

      CREATE INDEX IF NOT EXISTS auth_identities_user_provider_idx
        ON auth_identities (user_id, provider);

      CREATE INDEX IF NOT EXISTS auth_identities_provider_email_idx
        ON auth_identities (provider, lower(provider_email))
        WHERE provider_email IS NOT NULL;

      CREATE TABLE IF NOT EXISTS user_devices (
        id bigserial PRIMARY KEY,
        user_id text REFERENCES users(id) ON DELETE SET NULL,
        installation_id text NOT NULL,
        device_id text,
        platform text,
        app_version text,
        manufacturer text,
        model text,
        os_version text,
        timezone text,
        language text,
        country text,
        region_source text,
        first_seen_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        push_token_id bigint REFERENCES push_tokens(id) ON DELETE SET NULL,
        UNIQUE (installation_id)
      );

      CREATE INDEX IF NOT EXISTS user_devices_user_idx
        ON user_devices (user_id);

      CREATE INDEX IF NOT EXISTS user_devices_device_id_idx
        ON user_devices (device_id)
        WHERE device_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS user_devices_country_idx
        ON user_devices (country)
        WHERE country IS NOT NULL;
    `
  },
  {
    id: "007_user_program_assignments",
    sql: `
      CREATE TABLE IF NOT EXISTS user_program_assignments (
        user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        program_id text NOT NULL,
        program_title text,
        assigned_by text,
        source text NOT NULL DEFAULT 'admin',
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS user_program_assignments_program_idx
        ON user_program_assignments (program_id);

      CREATE INDEX IF NOT EXISTS user_program_assignments_updated_idx
        ON user_program_assignments (updated_at DESC);
    `
  },
  {
    id: "008_lms_access_policy",
    sql: `
      CREATE TABLE IF NOT EXISTS app_settings (
        key text PRIMARY KEY,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      INSERT INTO app_settings (key, data)
      VALUES (
        'lecture_access_policy',
        '{"mode":"first_n","freeLectureCount":6,"freeLectureIds":[],"paidAccess":"all"}'::jsonb
      )
      ON CONFLICT (key) DO NOTHING;
    `
  },
  {
    id: "009_ai_usage_accounting",
    sql: `
      CREATE TABLE IF NOT EXISTS ai_usage_logs (
        id bigserial PRIMARY KEY,
        user_id text REFERENCES users(id) ON DELETE SET NULL,
        provider text NOT NULL DEFAULT 'openai',
        model text,
        request_id text,
        response_id text,
        prompt_tokens integer NOT NULL DEFAULT 0,
        completion_tokens integer NOT NULL DEFAULT 0,
        total_tokens integer NOT NULL DEFAULT 0,
        estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
        source text NOT NULL DEFAULT 'backend_log',
        status text NOT NULL DEFAULT 'completed',
        error text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS ai_usage_logs_created_idx
        ON ai_usage_logs (created_at DESC);

      CREATE INDEX IF NOT EXISTS ai_usage_logs_user_created_idx
        ON ai_usage_logs (user_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS ai_usage_logs_model_created_idx
        ON ai_usage_logs (model, created_at DESC);

      CREATE INDEX IF NOT EXISTS ai_usage_logs_response_idx
        ON ai_usage_logs (response_id)
        WHERE response_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS openai_webhook_events (
        webhook_id text PRIMARY KEY,
        event_id text,
        event_type text,
        response_id text,
        raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS openai_webhook_events_response_idx
        ON openai_webhook_events (response_id)
        WHERE response_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS openai_webhook_events_type_created_idx
        ON openai_webhook_events (event_type, created_at DESC);

      INSERT INTO app_settings (key, data)
      VALUES (
        'ai_budget',
        jsonb_build_object(
          'budgetUsd', 0,
          'manualBalanceUsd', 0,
          'billingProvider', 'manual',
          'updatedAt', now()
        )
      )
      ON CONFLICT (key) DO NOTHING;
    `
  },
  {
    id: "010_openai_webhook_usage_columns",
    sql: `
      ALTER TABLE openai_webhook_events
        ADD COLUMN IF NOT EXISTS user_id text,
        ADD COLUMN IF NOT EXISTS model text,
        ADD COLUMN IF NOT EXISTS prompt_tokens integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS completion_tokens integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_tokens integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS openai_webhook_events_user_created_idx
        ON openai_webhook_events (user_id, created_at DESC)
        WHERE user_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS openai_webhook_events_model_created_idx
        ON openai_webhook_events (model, created_at DESC)
        WHERE model IS NOT NULL;
    `
  },
  {
    id: "011_payment_sessions_robokassa",
    sql: `
      CREATE TABLE IF NOT EXISTS payment_sessions (
        id text PRIMARY KEY,
        user_id text REFERENCES users(id) ON DELETE SET NULL,
        product_code text,
        amount numeric(12,2) NOT NULL DEFAULT 0,
        currency text NOT NULL DEFAULT 'RUB',
        profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        program_params jsonb NOT NULL DEFAULT '{}'::jsonb,
        email text,
        telegram_id text,
        promo_code text,
        robokassa_inv_id bigint UNIQUE,
        status text NOT NULL DEFAULT 'draft',
        recurring_enabled boolean NOT NULL DEFAULT false,
        recurring_parent_inv_id bigint,
        recurring_next_charge_at timestamptz,
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz,
        paid_at timestamptz
      );

      CREATE INDEX IF NOT EXISTS payment_sessions_user_id_idx
        ON payment_sessions (user_id);

      CREATE INDEX IF NOT EXISTS payment_sessions_status_idx
        ON payment_sessions (status);

      CREATE INDEX IF NOT EXISTS payment_sessions_recurring_idx
        ON payment_sessions (recurring_enabled, recurring_next_charge_at)
        WHERE recurring_enabled = true;

      ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS payment_session_id text REFERENCES payment_sessions(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS robokassa_inv_id bigint,
        ADD COLUMN IF NOT EXISTS paid_at timestamptz,
        ADD COLUMN IF NOT EXISTS recurring_parent_inv_id bigint,
        ADD COLUMN IF NOT EXISTS recurring_child boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

      CREATE INDEX IF NOT EXISTS payments_session_id_idx
        ON payments (payment_session_id);

      CREATE UNIQUE INDEX IF NOT EXISTS payments_robokassa_inv_unique
        ON payments (robokassa_inv_id)
        WHERE robokassa_inv_id IS NOT NULL;
    `
  },
  {
    id: "012_program_assignment_payment_meta",
    sql: `
      ALTER TABLE user_program_assignments
        ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

      UPDATE user_program_assignments
      SET assigned_at = COALESCE(assigned_at, updated_at, created_at, now())
      WHERE assigned_at IS NULL;

      ALTER TABLE payment_sessions
        ADD COLUMN IF NOT EXISTS assignment_status text,
        ADD COLUMN IF NOT EXISTS assignment_due_at timestamptz,
        ADD COLUMN IF NOT EXISTS assignment_attempted_at timestamptz,
        ADD COLUMN IF NOT EXISTS assignment_error text,
        ADD COLUMN IF NOT EXISTS assigned_program_id text;

      CREATE INDEX IF NOT EXISTS payment_sessions_assignment_due_idx
        ON payment_sessions (assignment_status, assignment_due_at)
        WHERE assignment_status = 'scheduled';
    `
  },
  {
    id: "013_email_password_auth",
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

      CREATE TABLE IF NOT EXISTS user_credentials (
        user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        email text NOT NULL,
        email_normalized text NOT NULL UNIQUE,
        email_verified_at timestamptz,
        password_hash text NOT NULL,
        email_verification_token_hash text,
        email_verification_expires_at timestamptz,
        password_reset_token_hash text,
        password_reset_expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS user_credentials_email_verified_idx
        ON user_credentials (email_normalized, email_verified_at);

      CREATE INDEX IF NOT EXISTS user_credentials_verification_token_idx
        ON user_credentials (email_verification_token_hash)
        WHERE email_verification_token_hash IS NOT NULL;

      CREATE INDEX IF NOT EXISTS user_credentials_password_reset_token_idx
        ON user_credentials (password_reset_token_hash)
        WHERE password_reset_token_hash IS NOT NULL;
    `
  },
  {
    id: "014_referral_system_mvp",
    sql: `
      CREATE TABLE IF NOT EXISTS referral_codes (
        id bigserial PRIMARY KEY,
        code text NOT NULL UNIQUE,
        owner_user_id text REFERENCES users(id) ON DELETE SET NULL,
        kind text NOT NULL DEFAULT 'user_referral',
        status text NOT NULL DEFAULT 'active',
        discount_type text NOT NULL DEFAULT 'percent',
        discount_value numeric(12,2) NOT NULL DEFAULT 0,
        reward_type text,
        reward_value numeric(12,2) NOT NULL DEFAULT 0,
        applies_to_product_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
        max_uses integer,
        uses_count integer NOT NULL DEFAULT 0,
        expires_at timestamptz,
        created_by text REFERENCES users(id) ON DELETE SET NULL,
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_user_referral_owner_unique
        ON referral_codes (owner_user_id)
        WHERE kind = 'user_referral' AND owner_user_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS referral_codes_owner_idx
        ON referral_codes (owner_user_id);

      CREATE INDEX IF NOT EXISTS referral_codes_status_idx
        ON referral_codes (status);

      CREATE TABLE IF NOT EXISTS referral_uses (
        id bigserial PRIMARY KEY,
        referral_code_id bigint NOT NULL REFERENCES referral_codes(id) ON DELETE RESTRICT,
        code text NOT NULL,
        referrer_user_id text REFERENCES users(id) ON DELETE SET NULL,
        referred_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        payment_session_id text REFERENCES payment_sessions(id) ON DELETE SET NULL,
        payment_id text REFERENCES payments(id) ON DELETE SET NULL,
        product_code text,
        order_amount numeric(12,2) NOT NULL DEFAULT 0,
        discount_type text NOT NULL DEFAULT 'percent',
        discount_value numeric(12,2) NOT NULL DEFAULT 0,
        discount_amount numeric(12,2) NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'pending_payment',
        applied_at timestamptz NOT NULL DEFAULT now(),
        qualified_at timestamptz,
        refunded_at timestamptz,
        canceled_at timestamptz,
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS referral_uses_referred_user_unique
        ON referral_uses (referred_user_id);

      CREATE UNIQUE INDEX IF NOT EXISTS referral_uses_payment_session_unique
        ON referral_uses (payment_session_id)
        WHERE payment_session_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS referral_uses_payment_id_unique
        ON referral_uses (payment_id)
        WHERE payment_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS referral_uses_referrer_idx
        ON referral_uses (referrer_user_id, status);

      CREATE INDEX IF NOT EXISTS referral_uses_code_idx
        ON referral_uses (code);

      CREATE INDEX IF NOT EXISTS referral_uses_status_idx
        ON referral_uses (status);
    `
  },
  {
    id: "015_payment_amount_breakdown",
    sql: `
      ALTER TABLE payment_sessions
        ADD COLUMN IF NOT EXISTS base_amount numeric(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS final_amount numeric(12,2) NOT NULL DEFAULT 0;

      UPDATE payment_sessions
      SET base_amount = CASE WHEN base_amount = 0 THEN COALESCE(amount, 0) ELSE base_amount END,
          discount_amount = COALESCE(discount_amount, 0),
          final_amount = CASE WHEN final_amount = 0 THEN COALESCE(amount, 0) ELSE final_amount END,
          amount = CASE WHEN final_amount = 0 THEN COALESCE(amount, 0) ELSE final_amount END;

      ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS base_amount numeric(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS final_amount numeric(12,2) NOT NULL DEFAULT 0;

      UPDATE payments
      SET base_amount = CASE WHEN base_amount = 0 THEN COALESCE(amount, 0) ELSE base_amount END,
          discount_amount = COALESCE(discount_amount, 0),
          final_amount = CASE WHEN final_amount = 0 THEN COALESCE(amount, 0) ELSE final_amount END,
          amount = CASE WHEN final_amount = 0 THEN COALESCE(amount, 0) ELSE final_amount END;
    `
  }
];
