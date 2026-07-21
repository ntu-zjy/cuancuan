import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { opportunities as seedOpportunities } from "./data";
import type { ModelProviderKind } from "./model-presets";
import type {
  Channel,
  Opportunity,
  OpportunityRegistrationStatus,
  RoomFeedback,
  RoomLifecycleStatus,
  RoomWorkspace,
  TrustSummary,
} from "./types";
import { decryptSecret, encryptSecret, maskSecret } from "./secret-crypto";

const globalDatabase = globalThis as typeof globalThis & {
  __cuancuanDatabase?: DatabaseSync;
  __cuancuanSchemaVersion?: number;
};

const DATABASE_SCHEMA_VERSION = 2;

function now() {
  return new Date().toISOString();
}

function booleanValue(value: unknown) {
  return Number(value) === 1;
}

function ensureColumn(database: DatabaseSync, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function initializeDatabase(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      progress INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      max_uses INTEGER NOT NULL DEFAULT 50,
      used_count INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key_ciphertext TEXT,
      api_key_iv TEXT,
      api_key_tag TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS one_default_model_provider
      ON model_providers(is_default) WHERE is_default = 1;

    CREATE TABLE IF NOT EXISTS agent_logs (
      id TEXT PRIMARY KEY,
      request_type TEXT NOT NULL,
      provider_id TEXT,
      provider_name TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      error_message TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_registrations (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'waitlisted')),
      note TEXT NOT NULL DEFAULT '',
      joined_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(event_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS event_join_channels (
      event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      channel_type TEXT NOT NULL DEFAULT 'wecom',
      label TEXT NOT NULL DEFAULT '加入活动沟通群',
      join_url TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_states (
      event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      owner_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'recruiting' CHECK (status IN (
        'recruiting', 'pending_confirmation', 'formed', 'scheduled',
        'in_progress', 'completed', 'cancelled', 'follow_up'
      )),
      scheduled_at TEXT,
      location TEXT NOT NULL DEFAULT '',
      meeting_url TEXT NOT NULL DEFAULT '',
      objective TEXT NOT NULL DEFAULT '',
      roles_json TEXT NOT NULL DEFAULT '[]',
      deadline TEXT,
      completion_criteria TEXT NOT NULL DEFAULT '',
      continuation_decision TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_messages (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_feedback (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      attended INTEGER NOT NULL DEFAULT 1,
      outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'partial', 'not_started')),
      continue_interest TEXT NOT NULL CHECK (continue_interest IN ('yes', 'maybe', 'no')),
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(event_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS trust_profiles (
      user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      email_verified INTEGER NOT NULL DEFAULT 1,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      work_verified INTEGER NOT NULL DEFAULT 0,
      host_verified INTEGER NOT NULL DEFAULT 0,
      real_name_verified INTEGER NOT NULL DEFAULT 0,
      institution_verified INTEGER NOT NULL DEFAULT 0,
      credit_score INTEGER NOT NULL DEFAULT 80,
      completed_rooms INTEGER NOT NULL DEFAULT 0,
      no_show_count INTEGER NOT NULL DEFAULT 0,
      report_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trust_reports (
      id TEXT PRIMARY KEY,
      reporter_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      reported_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      evidence_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewing', 'resolved', 'rejected')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS relationship_spaces (
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      discoverable INTEGER NOT NULL DEFAULT 1,
      profile_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, channel)
    );

    CREATE TABLE IF NOT EXISTS user_restrictions (
      user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('none', 'limited', 'temporary', 'permanent')),
      reason TEXT NOT NULL DEFAULT '',
      restricted_until TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS agent_logs_created_at ON agent_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS event_registrations_by_event
      ON event_registrations(event_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS room_messages_by_event
      ON room_messages(event_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS trust_reports_by_status
      ON trust_reports(status, created_at DESC);
  `);

  ensureColumn(database, "app_users", "avatar", "TEXT NOT NULL DEFAULT '/avatars/avatar-01.png'");
  ensureColumn(database, "app_users", "city", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "app_users", "identity", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "app_users", "skills", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "app_users", "offer", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "app_users", "bio", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "app_users", "wechat", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "trust_profiles", "institution_verified", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "trust_reports", "reported_user_id", "TEXT");
  database.exec(`
    UPDATE app_users
    SET avatar = replace(avatar, '/avatars/line-avatar-', '/avatars/avatar-')
    WHERE avatar LIKE '/avatars/line-avatar-%.png';
  `);

  database.prepare(`
    INSERT OR IGNORE INTO invite_codes (code, max_uses, used_count, enabled, created_at)
    VALUES (?, ?, 0, 1, ?)
  `).run("CUANCUAN2026", 100, now());

  const seedEvent = database.prepare(`
    INSERT INTO events (id, payload_json, published, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload_json = excluded.payload_json,
      published = excluded.published,
      updated_at = excluded.updated_at
  `);
  const seedTimestamp = now();
  for (const event of seedOpportunities) {
    seedEvent.run(event.id, JSON.stringify(event), seedTimestamp, seedTimestamp);
    database.prepare(`
      INSERT OR IGNORE INTO room_states (
        event_id, status, scheduled_at, location, objective, roles_json,
        deadline, completion_criteria, updated_at
      ) VALUES (?, 'recruiting', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.startsAt,
      event.venue,
      event.trialPlan?.objective || event.summary,
      JSON.stringify(event.trialPlan?.roles || []),
      event.trialPlan?.deadline || event.endsAt,
      event.trialPlan?.completionCriteria || "完成一次真实见面，并共同确认是否进入下一步。",
      seedTimestamp,
    );
  }
}

export function getDatabase() {
  if (globalDatabase.__cuancuanDatabase) {
    if ((globalDatabase.__cuancuanSchemaVersion || 0) < DATABASE_SCHEMA_VERSION) {
      initializeDatabase(globalDatabase.__cuancuanDatabase);
      globalDatabase.__cuancuanSchemaVersion = DATABASE_SCHEMA_VERSION;
    }
    return globalDatabase.__cuancuanDatabase;
  }
  const databasePath = process.env.DATABASE_PATH?.trim()
    || path.join(process.cwd(), ".data", "cuancuan.db");
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  initializeDatabase(database);
  globalDatabase.__cuancuanDatabase = database;
  globalDatabase.__cuancuanSchemaVersion = DATABASE_SCHEMA_VERSION;
  return database;
}

export type AdminUserRecord = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  role: string;
  created_at: string;
  last_login_at: string | null;
};

export function findAdminByEmail(email: string) {
  return getDatabase().prepare(`
    SELECT id, email, password_hash, password_salt, role, created_at, last_login_at
    FROM admin_users WHERE lower(email) = lower(?)
  `).get(email) as AdminUserRecord | undefined;
}

export function createAdminUser(input: {
  email: string;
  passwordHash: string;
  passwordSalt: string;
}) {
  const id = randomUUID();
  getDatabase().prepare(`
    INSERT INTO admin_users (id, email, password_hash, password_salt, role, created_at)
    VALUES (?, ?, ?, ?, 'admin', ?)
  `).run(id, input.email.toLowerCase(), input.passwordHash, input.passwordSalt, now());
  return id;
}

export function touchAdminLogin(id: string) {
  getDatabase().prepare("UPDATE admin_users SET last_login_at = ? WHERE id = ?").run(now(), id);
}

export function createAdminSession(input: {
  adminUserId: string;
  tokenHash: string;
  expiresAt: string;
}) {
  const database = getDatabase();
  database.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now());
  database.prepare(`
    INSERT INTO admin_sessions (id, admin_user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), input.adminUserId, input.tokenHash, input.expiresAt, now());
}

export function deleteAdminSession(tokenHash: string) {
  getDatabase().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash);
}

export function findAdminSession(tokenHash: string) {
  return getDatabase().prepare(`
    SELECT a.id, a.email, a.role, s.expires_at
    FROM admin_sessions s
    JOIN admin_users a ON a.id = s.admin_user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, now()) as { id: string; email: string; role: string; expires_at: string } | undefined;
}

export type PublicProviderRecord = {
  id: string;
  name: string;
  providerKind: ModelProviderKind;
  baseUrl: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  apiKeyMasked: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProviderDatabaseRow = {
  id: string;
  name: string;
  provider_kind: ModelProviderKind;
  base_url: string;
  model: string;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  api_key_tag: string | null;
  enabled: number;
  is_default: number;
  created_at: string;
  updated_at: string;
};

function providerPublicRow(row: ProviderDatabaseRow): PublicProviderRecord {
  let masked = "未配置";
  const hasApiKey = Boolean(row.api_key_ciphertext && row.api_key_iv && row.api_key_tag);
  if (hasApiKey) {
    try {
      masked = maskSecret(decryptSecret({
        ciphertext: row.api_key_ciphertext!,
        iv: row.api_key_iv!,
        tag: row.api_key_tag!,
      }));
    } catch {
      masked = "已加密 · 无法读取";
    }
  }
  return {
    id: row.id,
    name: row.name,
    providerKind: row.provider_kind,
    baseUrl: row.base_url,
    model: row.model,
    enabled: booleanValue(row.enabled),
    isDefault: booleanValue(row.is_default),
    apiKeyMasked: masked,
    hasApiKey,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listModelProviders() {
  const rows = getDatabase().prepare(`
    SELECT * FROM model_providers ORDER BY is_default DESC, updated_at DESC
  `).all() as unknown as ProviderDatabaseRow[];
  return rows.map(providerPublicRow);
}

export function saveModelProvider(input: {
  id?: string;
  name: string;
  providerKind: ModelProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
  enabled: boolean;
  setDefault: boolean;
}) {
  const database = getDatabase();
  const id = input.id || randomUUID();
  const existing = input.id
    ? database.prepare("SELECT id FROM model_providers WHERE id = ?").get(input.id)
    : undefined;
  const encrypted = input.apiKey?.trim() ? encryptSecret(input.apiKey.trim()) : null;
  const timestamp = now();

  database.exec("BEGIN IMMEDIATE");
  try {
    if (input.setDefault) database.exec("UPDATE model_providers SET is_default = 0");
    if (existing) {
      if (encrypted) {
        database.prepare(`
          UPDATE model_providers SET
            name = ?, provider_kind = ?, base_url = ?, model = ?,
            api_key_ciphertext = ?, api_key_iv = ?, api_key_tag = ?,
            enabled = ?, is_default = ?, updated_at = ?
          WHERE id = ?
        `).run(
          input.name,
          input.providerKind,
          input.baseUrl.replace(/\/$/, ""),
          input.model,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.tag,
          input.enabled || input.setDefault ? 1 : 0,
          input.setDefault ? 1 : 0,
          timestamp,
          id,
        );
      } else {
        database.prepare(`
          UPDATE model_providers SET
            name = ?, provider_kind = ?, base_url = ?, model = ?,
            enabled = ?, is_default = ?, updated_at = ?
          WHERE id = ?
        `).run(
          input.name,
          input.providerKind,
          input.baseUrl.replace(/\/$/, ""),
          input.model,
          input.enabled || input.setDefault ? 1 : 0,
          input.setDefault ? 1 : 0,
          timestamp,
          id,
        );
      }
    } else {
      database.prepare(`
        INSERT INTO model_providers (
          id, name, provider_kind, base_url, model,
          api_key_ciphertext, api_key_iv, api_key_tag,
          enabled, is_default, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.name,
        input.providerKind,
        input.baseUrl.replace(/\/$/, ""),
        input.model,
        encrypted?.ciphertext ?? null,
        encrypted?.iv ?? null,
        encrypted?.tag ?? null,
        input.enabled || input.setDefault ? 1 : 0,
        input.setDefault ? 1 : 0,
        timestamp,
        timestamp,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return id;
}

export function setDefaultModelProvider(id: string) {
  const database = getDatabase();
  const candidate = database.prepare(`
    SELECT id FROM model_providers
    WHERE id = ? AND api_key_ciphertext IS NOT NULL AND api_key_iv IS NOT NULL AND api_key_tag IS NOT NULL
  `).get(id);
  if (!candidate) throw new Error("请先为该平台保存 API Key，再设为默认平台。 ");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("UPDATE model_providers SET is_default = 0");
    const result = database.prepare(`
      UPDATE model_providers SET is_default = 1, enabled = 1, updated_at = ? WHERE id = ?
    `).run(now(), id);
    if (result.changes !== 1) throw new Error("模型平台不存在");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function deleteModelProvider(id: string) {
  getDatabase().prepare("DELETE FROM model_providers WHERE id = ?").run(id);
}

export type ActiveModelConfiguration = {
  id: string | null;
  name: string;
  providerKind: ModelProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  source: "database" | "environment";
};

export function getActiveModelConfiguration(): ActiveModelConfiguration | null {
  const row = getDatabase().prepare(`
    SELECT * FROM model_providers
    WHERE enabled = 1 AND is_default = 1
      AND api_key_ciphertext IS NOT NULL
      AND api_key_iv IS NOT NULL
      AND api_key_tag IS NOT NULL
    LIMIT 1
  `).get() as ProviderDatabaseRow | undefined;

  if (row?.api_key_ciphertext && row.api_key_iv && row.api_key_tag) {
    try {
      return {
        id: row.id,
        name: row.name,
        providerKind: row.provider_kind,
        baseUrl: row.base_url,
        model: row.model,
        apiKey: decryptSecret({
          ciphertext: row.api_key_ciphertext,
          iv: row.api_key_iv,
          tag: row.api_key_tag,
        }),
        source: "database",
      };
    } catch (error) {
      console.error("[model-config] 无法解密默认模型平台", error);
    }
  }

  const environmentKey = process.env.STEP_API_KEY?.trim();
  if (!environmentKey) return null;
  return {
    id: null,
    name: "阶跃星辰 · 环境变量",
    providerKind: "stepfun",
    baseUrl: (process.env.STEP_API_BASE_URL || "https://api.stepfun.com/v1").replace(/\/$/, ""),
    model: process.env.STEP_MODEL || "step-3.5-flash-2603",
    apiKey: environmentKey,
    source: "environment",
  };
}

export function createInviteCode(code: string, maxUses: number) {
  getDatabase().prepare(`
    INSERT INTO invite_codes (code, max_uses, used_count, enabled, created_at)
    VALUES (?, ?, 0, 1, ?)
  `).run(code.toUpperCase(), maxUses, now());
}

export function updateInviteCode(code: string, enabled: boolean) {
  getDatabase().prepare("UPDATE invite_codes SET enabled = ? WHERE code = ?")
    .run(enabled ? 1 : 0, code.toUpperCase());
}

export function registerOrLoginUser(input: {
  mode: "register" | "login";
  email: string;
  nickname?: string;
  inviteCode?: string;
}) {
  const database = getDatabase();
  const email = input.email.toLowerCase();
  const existing = database.prepare(`
    SELECT id, email, nickname, avatar, city, identity, skills, offer, bio, wechat
    FROM app_users WHERE email = ?
  `).get(email) as UserProfileRecord | undefined;

  if (input.mode === "login") {
    if (!existing) throw new Error("账号不存在，请先使用内测码加入。 ");
    database.prepare("UPDATE app_users SET last_seen_at = ? WHERE id = ?").run(now(), existing.id);
    return existing;
  }

  const inviteCode = input.inviteCode?.trim().toUpperCase();
  if (!inviteCode) throw new Error("请填写内测码。 ");
  const code = database.prepare(`
    SELECT code, max_uses, used_count, enabled FROM invite_codes WHERE code = ?
  `).get(inviteCode) as { code: string; max_uses: number; used_count: number; enabled: number } | undefined;
  if (!code || !booleanValue(code.enabled) || code.used_count >= code.max_uses) {
    throw new Error("内测码无效、已停用或使用次数已满。 ");
  }

  if (existing) {
    database.prepare("UPDATE app_users SET nickname = ?, last_seen_at = ? WHERE id = ?")
      .run(input.nickname || existing.nickname, now(), existing.id);
    return { ...existing, nickname: input.nickname || existing.nickname };
  }

  const id = randomUUID();
  const timestamp = now();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      INSERT INTO app_users (id, email, nickname, avatar, role, progress, created_at, last_seen_at)
      VALUES (?, ?, ?, '/avatars/avatar-01.png', 'user', 0, ?, ?)
    `).run(id, email, input.nickname || email.split("@")[0], timestamp, timestamp);
    database.prepare("UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ?").run(inviteCode);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return getUserProfile(id)!;
}

export function createUserSession(input: { userId: string; tokenHash: string; expiresAt: string }) {
  const database = getDatabase();
  database.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").run(now());
  database.prepare(`
    INSERT INTO user_sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), input.userId, input.tokenHash, input.expiresAt, now());
}

export function deleteUserSession(tokenHash: string) {
  getDatabase().prepare("DELETE FROM user_sessions WHERE token_hash = ?").run(tokenHash);
}

export type UserSessionRecord = {
  id: string;
  email: string;
  nickname: string;
  expires_at: string;
  restriction_status?: "none" | "limited" | "temporary" | "permanent";
  restricted_until?: string | null;
};

export type UserProfileRecord = {
  id: string;
  email: string;
  nickname: string;
  avatar: string;
  city: string;
  identity: string;
  skills: string;
  offer: string;
  bio: string;
  wechat: string;
};

export function getUserProfile(userId: string) {
  return getDatabase().prepare(`
    SELECT id, email, nickname, avatar, city, identity, skills, offer, bio, wechat
    FROM app_users WHERE id = ?
  `).get(userId) as UserProfileRecord | undefined;
}

export function updateUserProfile(input: Omit<UserProfileRecord, "email">) {
  const timestamp = now();
  getDatabase().prepare(`
    UPDATE app_users SET
      nickname = ?, avatar = ?, city = ?, identity = ?, skills = ?, offer = ?, bio = ?, wechat = ?, last_seen_at = ?
    WHERE id = ?
  `).run(
    input.nickname,
    input.avatar,
    input.city,
    input.identity,
    input.skills,
    input.offer,
    input.bio,
    input.wechat,
    timestamp,
    input.id,
  );
  return getUserProfile(input.id)!;
}

type RelationshipSpaceProfile = Pick<UserProfileRecord, "identity" | "skills" | "offer" | "bio">;

function relationshipSpaceSnapshot(profile: UserProfileRecord): RelationshipSpaceProfile {
  return {
    identity: profile.identity,
    skills: profile.skills,
    offer: profile.offer,
    bio: profile.bio,
  };
}

function parseRelationshipSpaceProfile(value: string, fallback: UserProfileRecord): RelationshipSpaceProfile {
  try {
    const parsed = JSON.parse(value) as Partial<RelationshipSpaceProfile>;
    return {
      identity: typeof parsed.identity === "string" ? parsed.identity : fallback.identity,
      skills: typeof parsed.skills === "string" ? parsed.skills : fallback.skills,
      offer: typeof parsed.offer === "string" ? parsed.offer : fallback.offer,
      bio: typeof parsed.bio === "string" ? parsed.bio : fallback.bio,
    };
  } catch {
    return relationshipSpaceSnapshot(fallback);
  }
}

export function getUserProfileForSpace(userId: string, channel: Channel) {
  const base = getUserProfile(userId);
  if (!base) return undefined;
  ensureRelationshipSpace(userId, channel);
  const row = getDatabase().prepare(`
    SELECT profile_json FROM relationship_spaces WHERE user_id = ? AND channel = ?
  `).get(userId, channel) as { profile_json: string };
  return { ...base, ...parseRelationshipSpaceProfile(row.profile_json, base) };
}

export function updateUserProfileForSpace(input: Omit<UserProfileRecord, "email"> & { channel: Channel }) {
  const { channel, ...profileInput } = input;
  const base = updateUserProfile(profileInput);
  ensureRelationshipSpace(input.id, channel);
  getDatabase().prepare(`
    UPDATE relationship_spaces SET profile_json = ?, updated_at = ?
    WHERE user_id = ? AND channel = ?
  `).run(JSON.stringify(relationshipSpaceSnapshot(base)), now(), input.id, channel);
  return getUserProfileForSpace(input.id, channel)!;
}

type TrustRow = {
  email_verified: number;
  phone_verified: number;
  work_verified: number;
  host_verified: number;
  real_name_verified: number;
  institution_verified: number;
  credit_score: number;
  completed_rooms: number;
  no_show_count: number;
  report_count: number;
};

export function getTrustSummary(userId: string): TrustSummary {
  const database = getDatabase();
  database.prepare(`
    INSERT OR IGNORE INTO trust_profiles (user_id, updated_at) VALUES (?, ?)
  `).run(userId, now());
  const row = database.prepare(`
    SELECT email_verified, phone_verified, work_verified, host_verified,
      real_name_verified, institution_verified, credit_score, completed_rooms,
      no_show_count, report_count
    FROM trust_profiles WHERE user_id = ?
  `).get(userId) as TrustRow;
  return {
    emailVerified: booleanValue(row.email_verified),
    phoneVerified: booleanValue(row.phone_verified),
    workVerified: booleanValue(row.work_verified),
    hostVerified: booleanValue(row.host_verified),
    realNameVerified: booleanValue(row.real_name_verified),
    institutionVerified: booleanValue(row.institution_verified),
    creditScore: Number(row.credit_score),
    completedRooms: Number(row.completed_rooms),
    noShowCount: Number(row.no_show_count),
    reportCount: Number(row.report_count),
  };
}

export function ensureRelationshipSpace(userId: string, channel: Channel) {
  const database = getDatabase();
  const base = getUserProfile(userId);
  const snapshot = base ? JSON.stringify(relationshipSpaceSnapshot(base)) : "{}";
  database.prepare(`
    INSERT OR IGNORE INTO relationship_spaces (user_id, channel, discoverable, profile_json, updated_at)
    VALUES (?, ?, 1, ?, ?)
  `).run(userId, channel, snapshot, now());
  const existing = database.prepare(`
    SELECT profile_json FROM relationship_spaces WHERE user_id = ? AND channel = ?
  `).get(userId, channel) as { profile_json: string } | undefined;
  if (base && existing?.profile_json === "{}") {
    database.prepare(`
      UPDATE relationship_spaces SET profile_json = ?, updated_at = ? WHERE user_id = ? AND channel = ?
    `).run(snapshot, now(), userId, channel);
  }
}

export function listRelationshipSpaces(userId: string) {
  const channels: Channel[] = ["founder", "play", "love", "jobs", "capital", "travel"];
  channels.forEach((channel) => ensureRelationshipSpace(userId, channel));
  return getDatabase().prepare(`
    SELECT channel, discoverable, profile_json AS profileJson, updated_at AS updatedAt
    FROM relationship_spaces WHERE user_id = ? ORDER BY channel
  `).all(userId).map((row) => ({
    ...row,
    discoverable: booleanValue((row as { discoverable: number }).discoverable),
  }));
}

export function findUserSession(tokenHash: string) {
  return getDatabase().prepare(`
    SELECT u.id, u.email, u.nickname, s.expires_at,
      coalesce(r.status, 'none') AS restriction_status, r.restricted_until
    FROM user_sessions s
    JOIN app_users u ON u.id = s.user_id
    LEFT JOIN user_restrictions r ON r.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, now()) as UserSessionRecord | undefined;
}

export function setUserRestriction(input: {
  userId: string;
  status: "none" | "limited" | "temporary" | "permanent";
  reason: string;
  restrictedUntil?: string;
}) {
  const timestamp = now();
  getDatabase().prepare(`
    INSERT INTO user_restrictions (user_id, status, reason, restricted_until, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, reason = excluded.reason,
      restricted_until = excluded.restricted_until, updated_at = excluded.updated_at
  `).run(input.userId, input.status, input.reason.trim().slice(0, 500), input.restrictedUntil || null, timestamp);
}

export function setUserTrustVerification(input: {
  userId: string;
  field: "phone" | "work" | "host" | "real_name" | "institution";
  verified: boolean;
}) {
  getTrustSummary(input.userId);
  const columns = {
    phone: "phone_verified",
    work: "work_verified",
    host: "host_verified",
    real_name: "real_name_verified",
    institution: "institution_verified",
  } as const;
  const column = columns[input.field];
  getDatabase().prepare(`UPDATE trust_profiles SET ${column} = ?, updated_at = ? WHERE user_id = ?`)
    .run(input.verified ? 1 : 0, now(), input.userId);
  return getTrustSummary(input.userId);
}

type EventRow = {
  id: string;
  payload_json: string;
  published: number;
};

type RegistrationRow = {
  event_id: string;
  status: OpportunityRegistrationStatus;
  note: string;
  joined_at: string;
};

type JoinChannelRow = {
  event_id: string;
  channel_type: "wecom" | "wechat" | "none";
  label: string;
  join_url: string;
  instructions: string;
  enabled: number;
};

type RoomStateRow = {
  event_id: string;
  owner_user_id: string | null;
  status: RoomLifecycleStatus;
  scheduled_at: string | null;
  location: string;
  meeting_url: string;
  objective: string;
  roles_json: string;
  deadline: string | null;
  completion_criteria: string;
  continuation_decision: string;
  updated_at: string;
};

function roomStateFromRow(row: RoomStateRow) {
  return {
    eventId: row.event_id,
    status: row.status,
    scheduledAt: row.scheduled_at || undefined,
    location: row.location || undefined,
    meetingUrl: row.meeting_url || undefined,
    objective: row.objective || undefined,
    roles: JSON.parse(row.roles_json || "[]") as string[],
    deadline: row.deadline || undefined,
    completionCriteria: row.completion_criteria || undefined,
    continuationDecision: row.continuation_decision || undefined,
    updatedAt: row.updated_at,
  };
}

function parseEvent(row: EventRow) {
  return JSON.parse(row.payload_json) as Opportunity;
}

function synchronizeRoomLifecycle(eventId: string) {
  const database = getDatabase();
  const eventRow = database.prepare("SELECT payload_json FROM events WHERE id = ?").get(eventId) as { payload_json: string } | undefined;
  if (!eventRow) return;
  const state = ensureRoomState(eventId);
  if (!["recruiting", "pending_confirmation", "formed"].includes(state.status)) return;
  const event = JSON.parse(eventRow.payload_json) as Opportunity;
  const counts = database.prepare(`
    SELECT
      sum(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
      sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
    FROM event_registrations WHERE event_id = ?
  `).get(eventId) as { confirmed: number | null; pending: number | null };
  const confirmed = event.members + Number(counts.confirmed || 0);
  const nextStatus: RoomLifecycleStatus = confirmed >= event.minMembers
    ? "formed"
    : Number(counts.pending || 0) > 0 ? "pending_confirmation" : "recruiting";
  if (nextStatus !== state.status) {
    database.prepare("UPDATE room_states SET status = ?, updated_at = ? WHERE event_id = ?")
      .run(nextStatus, now(), eventId);
  }
}

function promoteWaitlistIfPossible(eventId: string) {
  const database = getDatabase();
  const eventRow = database.prepare("SELECT payload_json FROM events WHERE id = ?").get(eventId) as { payload_json: string } | undefined;
  if (!eventRow) return;
  const event = JSON.parse(eventRow.payload_json) as Opportunity;
  const confirmed = database.prepare(`
    SELECT count(*) AS count FROM event_registrations WHERE event_id = ? AND status = 'confirmed'
  `).get(eventId) as { count: number };
  let available = Math.max(0, event.maxMembers - event.members - Number(confirmed.count));
  if (available === 0) return;
  const waitlisted = database.prepare(`
    SELECT id FROM event_registrations WHERE event_id = ? AND status = 'waitlisted'
    ORDER BY joined_at ASC LIMIT ?
  `).all(eventId, available) as Array<{ id: string }>;
  const promote = database.prepare("UPDATE event_registrations SET status = 'confirmed', updated_at = ? WHERE id = ?");
  for (const item of waitlisted) {
    if (available <= 0) break;
    promote.run(now(), item.id);
    available -= 1;
  }
}

export function listEventsForUser(userId: string) {
  const database = getDatabase();
  const rows = database.prepare(`
    SELECT id, payload_json, published
    FROM events
    WHERE published = 1
    ORDER BY json_extract(payload_json, '$.startsAt') ASC
  `).all() as unknown as EventRow[];
  const registrations = database.prepare(`
    SELECT event_id, status, note, joined_at
    FROM event_registrations
    WHERE user_id = ?
  `).all(userId) as unknown as RegistrationRow[];
  const confirmedCounts = database.prepare(`
    SELECT event_id, count(*) AS count
    FROM event_registrations
    WHERE status = 'confirmed'
    GROUP BY event_id
  `).all() as unknown as Array<{ event_id: string; count: number }>;
  const channels = database.prepare(`
    SELECT event_id, channel_type, label, join_url, instructions, enabled
    FROM event_join_channels
  `).all() as unknown as JoinChannelRow[];
  const roomStates = database.prepare(`SELECT * FROM room_states`).all() as unknown as RoomStateRow[];

  const registrationByEvent = new Map(registrations.map((item) => [item.event_id, item]));
  const countByEvent = new Map(confirmedCounts.map((item) => [item.event_id, Number(item.count)]));
  const channelByEvent = new Map(channels.map((item) => [item.event_id, item]));
  const stateByEvent = new Map(roomStates.map((item) => [item.event_id, item]));

  return rows.map((row) => {
    const event = parseEvent(row);
    const registration = registrationByEvent.get(event.id);
    const channel = channelByEvent.get(event.id);
    const roomState = stateByEvent.get(event.id);
    return {
      ...event,
      members: event.members + (countByEvent.get(event.id) || 0),
      isHost: roomState?.owner_user_id === userId,
      lifecycleStatus: roomState?.status || event.lifecycleStatus || "recruiting",
      trialPlan: roomState ? {
        objective: roomState.objective || event.trialPlan?.objective || event.summary,
        roles: JSON.parse(roomState.roles_json || "[]") as string[],
        deadline: roomState.deadline || event.trialPlan?.deadline || event.endsAt,
        completionCriteria: roomState.completion_criteria || event.trialPlan?.completionCriteria || "完成一次真实见面，并确认是否继续。",
        continuationDecision: roomState.continuation_decision || undefined,
      } : event.trialPlan,
      registration: registration ? {
        opportunityId: event.id,
        status: registration.status,
        note: registration.note,
        joinedAt: registration.joined_at,
      } : undefined,
      joinChannel: registration?.status === "confirmed" && channel?.enabled ? {
        type: channel.channel_type,
        label: channel.label,
        href: channel.join_url || undefined,
        instructions: channel.instructions || undefined,
      } : undefined,
    };
  }).filter((event) => event.visibility !== "invite_only" || event.isHost || Boolean(event.registration));
}

export function createEventForUser(input: { userId: string; event: Opportunity }) {
  const database = getDatabase();
  const id = `room-${randomUUID()}`;
  const timestamp = now();
  const event: Opportunity = {
    ...input.event,
    id,
    members: 0,
    visibility: input.event.visibility || "public",
    lifecycleStatus: "recruiting",
  };
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      INSERT INTO events (id, payload_json, published, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)
    `).run(id, JSON.stringify(event), timestamp, timestamp);
    database.prepare(`
      INSERT INTO room_states (
        event_id, owner_user_id, status, scheduled_at, location, objective,
        roles_json, deadline, completion_criteria, updated_at
      ) VALUES (?, ?, 'recruiting', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.userId, event.startsAt, event.venue,
      event.trialPlan?.objective || event.summary,
      JSON.stringify(event.trialPlan?.roles || []),
      event.trialPlan?.deadline || event.endsAt,
      event.trialPlan?.completionCriteria || "完成一次真实见面，并确认是否进入下一步。",
      timestamp,
    );
    database.prepare(`
      INSERT INTO event_registrations (id, event_id, user_id, status, note, joined_at, updated_at)
      VALUES (?, ?, ?, 'confirmed', '发起人', ?, ?)
    `).run(randomUUID(), id, input.userId, timestamp, timestamp);
    database.prepare("INSERT OR IGNORE INTO trust_profiles (user_id, updated_at) VALUES (?, ?)")
      .run(input.userId, timestamp);
    database.prepare("UPDATE trust_profiles SET host_verified = 1, updated_at = ? WHERE user_id = ?")
      .run(timestamp, input.userId);
    database.exec("COMMIT");
    return event;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function submitEventRegistration(input: { eventId: string; userId: string; note: string }) {
  const database = getDatabase();
  const eventRow = database.prepare(`
    SELECT id, payload_json, published FROM events WHERE id = ? AND published = 1
  `).get(input.eventId) as EventRow | undefined;
  if (!eventRow) throw new Error("这个活动已经下线或不存在。 ");
  const event = parseEvent(eventRow);
  if (Date.now() > new Date(event.registrationDeadline).getTime()) {
    throw new Error("这个活动已经停止报名。 ");
  }

  const existing = database.prepare(`
    SELECT id, status, joined_at FROM event_registrations WHERE event_id = ? AND user_id = ?
  `).get(input.eventId, input.userId) as { id: string; status: OpportunityRegistrationStatus; joined_at: string } | undefined;
  if (event.visibility === "invite_only" && !existing) throw new Error("这个局仅向受邀成员开放。");
  const confirmed = database.prepare(`
    SELECT count(*) AS count FROM event_registrations WHERE event_id = ? AND status = 'confirmed'
  `).get(input.eventId) as { count: number };
  const confirmedWithoutSelf = Number(confirmed.count) - (existing?.status === "confirmed" ? 1 : 0);
  const isFull = event.members + confirmedWithoutSelf >= event.maxMembers;
  const status: OpportunityRegistrationStatus = isFull
    ? "waitlisted"
    : event.registrationMode === "approval" ? "pending" : "confirmed";
  const timestamp = now();
  const id = existing?.id || randomUUID();
  const joinedAt = existing?.joined_at || timestamp;
  database.prepare(`
    INSERT INTO event_registrations (id, event_id, user_id, status, note, joined_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET
      status = excluded.status,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run(id, input.eventId, input.userId, status, input.note.trim().slice(0, 600), joinedAt, timestamp);
  synchronizeRoomLifecycle(input.eventId);
  return { opportunityId: input.eventId, status, note: input.note.trim(), joinedAt };
}

export function cancelEventRegistration(input: { eventId: string; userId: string }) {
  const database = getDatabase();
  const eventRow = database.prepare(`
    SELECT id, payload_json, published FROM events WHERE id = ?
  `).get(input.eventId) as EventRow | undefined;
  if (!eventRow) throw new Error("这个活动已经不存在。 ");
  const event = parseEvent(eventRow);
  if (Date.now() > new Date(event.cancellationDeadline).getTime()) {
    throw new Error("已经超过可取消时间，请联系发起人处理。 ");
  }
  const existing = database.prepare("SELECT status FROM event_registrations WHERE event_id = ? AND user_id = ?")
    .get(input.eventId, input.userId) as { status: OpportunityRegistrationStatus } | undefined;
  database.prepare("DELETE FROM event_registrations WHERE event_id = ? AND user_id = ?").run(input.eventId, input.userId);
  if (existing?.status === "confirmed") promoteWaitlistIfPossible(input.eventId);
  synchronizeRoomLifecycle(input.eventId);
}

export function saveEventJoinChannel(input: {
  eventId: string;
  type: "wecom" | "wechat" | "none";
  label: string;
  href: string;
  instructions: string;
  enabled: boolean;
}) {
  const database = getDatabase();
  const exists = database.prepare("SELECT id FROM events WHERE id = ?").get(input.eventId);
  if (!exists) throw new Error("活动不存在。 ");
  database.prepare(`
    INSERT INTO event_join_channels (
      event_id, channel_type, label, join_url, instructions, enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      channel_type = excluded.channel_type,
      label = excluded.label,
      join_url = excluded.join_url,
      instructions = excluded.instructions,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    input.eventId,
    input.type,
    input.label.trim().slice(0, 80),
    input.href.trim().slice(0, 1000),
    input.instructions.trim().slice(0, 500),
    input.enabled ? 1 : 0,
    now(),
  );
}

export function setEventRegistrationStatus(input: {
  eventId: string;
  registrationId: string;
  status: OpportunityRegistrationStatus;
}) {
  const database = getDatabase();
  if (input.status === "confirmed") {
    const eventRow = database.prepare("SELECT payload_json FROM events WHERE id = ?").get(input.eventId) as { payload_json: string } | undefined;
    if (!eventRow) throw new Error("活动不存在。 ");
    const event = JSON.parse(eventRow.payload_json) as Opportunity;
    const current = database.prepare("SELECT status FROM event_registrations WHERE id = ? AND event_id = ?")
      .get(input.registrationId, input.eventId) as { status: OpportunityRegistrationStatus } | undefined;
    const confirmed = database.prepare("SELECT count(*) AS count FROM event_registrations WHERE event_id = ? AND status = 'confirmed'")
      .get(input.eventId) as { count: number };
    const confirmedWithoutCurrent = Number(confirmed.count) - (current?.status === "confirmed" ? 1 : 0);
    if (event.members + confirmedWithoutCurrent >= event.maxMembers) throw new Error("正式名额已满，可以先转入候补。");
  }
  const result = database.prepare(`
    UPDATE event_registrations SET status = ?, updated_at = ? WHERE id = ? AND event_id = ?
  `).run(input.status, now(), input.registrationId, input.eventId);
  if (result.changes !== 1) throw new Error("报名记录不存在。 ");
  synchronizeRoomLifecycle(input.eventId);
}

function ensureRoomState(eventId: string) {
  const database = getDatabase();
  const eventRow = database.prepare("SELECT payload_json FROM events WHERE id = ?").get(eventId) as { payload_json: string } | undefined;
  if (!eventRow) throw new Error("这个局不存在。");
  const event = JSON.parse(eventRow.payload_json) as Opportunity;
  database.prepare(`
    INSERT OR IGNORE INTO room_states (
      event_id, status, scheduled_at, location, objective, roles_json,
      deadline, completion_criteria, updated_at
    ) VALUES (?, 'recruiting', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    event.startsAt,
    event.venue,
    event.trialPlan?.objective || event.summary,
    JSON.stringify(event.trialPlan?.roles || []),
    event.trialPlan?.deadline || event.endsAt,
    event.trialPlan?.completionCriteria || "完成一次真实见面，并确认是否进入下一步。",
    now(),
  );
  return database.prepare("SELECT * FROM room_states WHERE event_id = ?").get(eventId) as unknown as RoomStateRow;
}

function roomAccess(userId: string, eventId: string) {
  const database = getDatabase();
  const state = ensureRoomState(eventId);
  const registration = database.prepare(`
    SELECT status FROM event_registrations WHERE event_id = ? AND user_id = ?
  `).get(eventId, userId) as { status: OpportunityRegistrationStatus } | undefined;
  const canManage = state.owner_user_id === userId;
  return { state, canManage, registrationStatus: registration?.status, canChat: canManage || registration?.status === "confirmed" };
}

export function getRoomWorkspace(userId: string, eventId: string): RoomWorkspace {
  const database = getDatabase();
  const access = roomAccess(userId, eventId);
  const eventRow = database.prepare("SELECT payload_json FROM events WHERE id = ?").get(eventId) as { payload_json: string };
  const event = JSON.parse(eventRow.payload_json) as Opportunity;
  if (event.visibility === "invite_only" && !access.canManage && !access.registrationStatus) {
    throw new Error("这个局仅向受邀成员开放。");
  }
  const channel = (event.channel || (event.scene === "love" ? "love" : "founder")) as Channel;
  const messages = access.canChat ? database.prepare(`
    SELECT m.id, m.event_id AS eventId, m.user_id AS userId, u.nickname AS author,
      u.avatar, m.content, m.created_at AS createdAt
    FROM room_messages m
    JOIN app_users u ON u.id = m.user_id
    WHERE m.event_id = ? ORDER BY m.created_at ASC LIMIT 120
  `).all(eventId) : [];
  const memberRows = database.prepare(`
    SELECT r.user_id AS userId, r.joined_at AS joinedAt, u.nickname AS name,
      u.avatar, u.identity, u.skills, u.offer, u.bio,
      coalesce(s.profile_json, '{}') AS spaceProfile
    FROM event_registrations r
    JOIN app_users u ON u.id = r.user_id
    LEFT JOIN relationship_spaces s ON s.user_id = u.id AND s.channel = ?
    WHERE r.event_id = ? AND r.status = 'confirmed'
    ORDER BY CASE WHEN r.user_id = ? THEN 0 ELSE 1 END, r.joined_at ASC
  `).all(channel, eventId, access.state.owner_user_id || "") as Array<{
    userId: string; joinedAt: string; name: string; avatar: string; identity: string;
    skills: string; offer: string; bio: string; spaceProfile: string;
  }>;
  const members: RoomWorkspace["members"] = memberRows.map((row) => {
    let space: Partial<RelationshipSpaceProfile> = {};
    try { space = JSON.parse(row.spaceProfile) as Partial<RelationshipSpaceProfile>; } catch { /* keep base profile */ }
    const identity = typeof space.identity === "string" ? space.identity : row.identity;
    const summary = typeof space.bio === "string" ? space.bio : row.bio;
    const offer = typeof space.offer === "string" ? space.offer : row.offer;
    return {
      userId: row.userId,
      name: row.name,
      avatar: row.avatar,
      identity,
      summary: summary || identity || "已确认成员",
      offer: offer || (typeof space.skills === "string" ? space.skills : row.skills) || "加入后再具体对齐",
      joinedAt: row.joinedAt,
      isHost: row.userId === access.state.owner_user_id,
    };
  });
  const applicationRows = access.canManage ? database.prepare(`
    SELECT r.id, r.user_id AS userId, u.nickname AS name, u.avatar,
      r.note, r.status, r.joined_at AS joinedAt
    FROM event_registrations r JOIN app_users u ON u.id = r.user_id
    WHERE r.event_id = ? AND r.user_id != ? AND r.status != 'confirmed'
    ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.joined_at ASC
  `).all(eventId, access.state.owner_user_id || "") : [];
  const applications = applicationRows as RoomWorkspace["applications"];
  const coordinationCounts = database.prepare(`
    SELECT
      sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      sum(CASE WHEN status = 'waitlisted' THEN 1 ELSE 0 END) AS waitlisted
    FROM event_registrations WHERE event_id = ?
  `).get(eventId) as { pending: number | null; waitlisted: number | null };
  const feedbackRow = database.prepare(`
    SELECT event_id, attended, outcome, continue_interest, rating, notes, created_at
    FROM room_feedback WHERE event_id = ? AND user_id = ?
  `).get(eventId, userId) as {
    event_id: string; attended: number; outcome: RoomFeedback["outcome"];
    continue_interest: RoomFeedback["continueInterest"]; rating: number; notes: string; created_at: string;
  } | undefined;
  const state = roomStateFromRow(access.state);
  const scheduledAt = state.scheduledAt ? Date.parse(state.scheduledAt) : Number.NaN;
  const hoursUntil = Number.isFinite(scheduledAt) ? Math.round((scheduledAt - Date.now()) / 3_600_000) : null;
  const reminder = hoursUntil === null
    ? "时间确认后，攒攒会在这里显示会前提醒。"
    : hoursUntil > 24 ? `距离约定还有约 ${Math.ceil(hoursUntil / 24)} 天；请提前确认地点和参与人。`
      : hoursUntil > 0 ? `距离约定还有约 ${Math.max(1, hoursUntil)} 小时；请确认是否按时参加。`
        : state.status === "completed" || state.status === "follow_up" ? "本次行动已结束，可以补充结果与下一步。" : "已到约定时间，请及时更新进行状态。";
  const nextAction = state.status === "recruiting"
    ? `继续招募，距离最低成局人数还差 ${Math.max(0, event.minMembers - event.members - members.length)} 位。`
    : state.status === "pending_confirmation" ? "先审核申请，确认目标与投入理解一致。"
      : state.status === "formed" ? "成员已齐，接下来确认时间、地点或会议链接。"
        : state.status === "scheduled" ? "会前确认成员摘要、分工与提醒。"
          : state.status === "in_progress" ? "按约定执行，并在结束后记录结果。"
            : state.status === "completed" ? "收集成员反馈，决定是否继续连接。"
              : state.status === "follow_up" ? "把下一次行动写清楚，避免关系停在口头意向。"
                : state.status === "cancelled" ? "如仍有需要，可重新发起一个边界更清楚的局。" : "继续推进当前行动。";
  const nextRelationshipSuggestion = feedbackRow
    ? feedbackRow.continue_interest === "yes" ? "双方若都愿意继续，建议现在约定下一次具体行动。"
      : feedbackRow.continue_interest === "maybe" ? "先交换本次真实感受，再决定是否安排一次低压力复盘。"
        : "尊重不继续的选择，保留反馈即可，不自动交换联系方式。"
    : "行动结束后填写到场、完成情况和继续意愿，攒攒再给出下一步建议。";
  return {
    currentUserId: userId,
    state,
    messages: messages as RoomWorkspace["messages"],
    members,
    applications,
    coordination: {
      pendingCount: Number(coordinationCounts.pending || 0),
      waitlistCount: Number(coordinationCounts.waitlisted || 0),
      nextAction,
      reminder,
      nextRelationshipSuggestion,
    },
    feedback: feedbackRow ? {
      eventId: feedbackRow.event_id,
      attended: booleanValue(feedbackRow.attended),
      outcome: feedbackRow.outcome,
      continueInterest: feedbackRow.continue_interest,
      rating: Number(feedbackRow.rating),
      notes: feedbackRow.notes,
      createdAt: feedbackRow.created_at,
    } : undefined,
    trust: getTrustSummary(userId),
    canManage: access.canManage,
    canChat: access.canChat,
  };
}

export function addRoomMessage(input: { eventId: string; userId: string; content: string }) {
  const access = roomAccess(input.userId, input.eventId);
  if (!access.canChat) throw new Error("报名确认后才能进入局内群聊。");
  const content = input.content.trim().slice(0, 1200);
  if (!content) throw new Error("消息不能为空。");
  getDatabase().prepare(`
    INSERT INTO room_messages (id, event_id, user_id, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), input.eventId, input.userId, content, now());
  return getRoomWorkspace(input.userId, input.eventId);
}

export function updateRoomState(input: {
  eventId: string;
  status: RoomLifecycleStatus;
  scheduledAt?: string;
  location?: string;
  meetingUrl?: string;
  objective?: string;
  roles?: string[];
  deadline?: string;
  completionCriteria?: string;
  continuationDecision?: string;
}) {
  ensureRoomState(input.eventId);
  getDatabase().prepare(`
    UPDATE room_states SET status = ?, scheduled_at = ?, location = ?, meeting_url = ?,
      objective = ?, roles_json = ?, deadline = ?, completion_criteria = ?,
      continuation_decision = ?, updated_at = ? WHERE event_id = ?
  `).run(
    input.status,
    input.scheduledAt || null,
    input.location?.trim().slice(0, 200) || "",
    input.meetingUrl?.trim().slice(0, 1000) || "",
    input.objective?.trim().slice(0, 500) || "",
    JSON.stringify((input.roles || []).map((item) => item.trim()).filter(Boolean).slice(0, 12)),
    input.deadline || null,
    input.completionCriteria?.trim().slice(0, 500) || "",
    input.continuationDecision?.trim().slice(0, 500) || "",
    now(),
    input.eventId,
  );
}

export function updateRoomStateForOwner(userId: string, input: Parameters<typeof updateRoomState>[0]) {
  const access = roomAccess(userId, input.eventId);
  if (!access.canManage) throw new Error("只有发起人可以更新这个局的行动安排。");
  updateRoomState(input);
  return getRoomWorkspace(userId, input.eventId);
}

export function setEventRegistrationStatusForOwner(input: {
  userId: string;
  eventId: string;
  registrationId: string;
  status: OpportunityRegistrationStatus;
}) {
  const access = roomAccess(input.userId, input.eventId);
  if (!access.canManage) throw new Error("只有发起人可以审核报名。");
  setEventRegistrationStatus(input);
  return getRoomWorkspace(input.userId, input.eventId);
}

export function saveEventSettingsForOwner(input: {
  userId: string;
  eventId: string;
  registrationMode: "instant" | "approval";
  visibility: "public" | "invite_only";
}) {
  const access = roomAccess(input.userId, input.eventId);
  if (!access.canManage) throw new Error("只有发起人可以修改加入规则。");
  saveEventSettings({
    eventId: input.eventId,
    registrationMode: input.registrationMode,
    visibility: input.visibility,
    lifecycleStatus: access.state.status,
  });
  return getRoomWorkspace(input.userId, input.eventId);
}

export function saveRoomFeedback(input: {
  eventId: string;
  userId: string;
  attended: boolean;
  outcome: RoomFeedback["outcome"];
  continueInterest: RoomFeedback["continueInterest"];
  rating: number;
  notes: string;
}) {
  const access = roomAccess(input.userId, input.eventId);
  if (!access.canChat) throw new Error("只有已确认成员可以提交反馈。");
  const database = getDatabase();
  const timestamp = now();
  const previous = database.prepare(`
    SELECT attended, outcome, rating FROM room_feedback WHERE event_id = ? AND user_id = ?
  `).get(input.eventId, input.userId) as { attended: number; outcome: RoomFeedback["outcome"]; rating: number } | undefined;
  database.prepare(`
    INSERT INTO room_feedback (
      id, event_id, user_id, attended, outcome, continue_interest, rating, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET attended = excluded.attended,
      outcome = excluded.outcome, continue_interest = excluded.continue_interest,
      rating = excluded.rating, notes = excluded.notes, updated_at = excluded.updated_at
  `).run(
    randomUUID(), input.eventId, input.userId, input.attended ? 1 : 0,
    input.outcome, input.continueInterest, Math.max(1, Math.min(5, input.rating)),
    input.notes.trim().slice(0, 800), timestamp, timestamp,
  );
  const wasCompleted = previous && booleanValue(previous.attended) && previous.outcome === "completed" ? 1 : 0;
  const isCompleted = input.attended && input.outcome === "completed" ? 1 : 0;
  const wasNoShow = previous && !booleanValue(previous.attended) ? 1 : 0;
  const isNoShow = !input.attended ? 1 : 0;
  const oldCreditEffect = previous ? (wasNoShow ? -8 : previous.rating >= 4 ? 2 : 0) : 0;
  const newCreditEffect = isNoShow ? -8 : input.rating >= 4 ? 2 : 0;
  database.prepare(`
    UPDATE trust_profiles SET completed_rooms = max(0, completed_rooms + ?),
      no_show_count = max(0, no_show_count + ?),
      credit_score = max(0, min(100, credit_score + ?)), updated_at = ? WHERE user_id = ?
  `).run(isCompleted - wasCompleted, isNoShow - wasNoShow, newCreditEffect - oldCreditEffect, timestamp, input.userId);
  return getRoomWorkspace(input.userId, input.eventId);
}

export function createTrustReport(input: {
  reporterUserId: string;
  reportedUserId?: string;
  eventId?: string;
  category: string;
  details: string;
  evidenceUrl?: string;
}) {
  if (input.eventId) roomAccess(input.reporterUserId, input.eventId);
  if (input.reportedUserId) {
    if (input.reportedUserId === input.reporterUserId) throw new Error("不能把自己设为被举报成员。");
    const member = getDatabase().prepare(`
      SELECT 1 FROM event_registrations WHERE event_id = ? AND user_id = ? AND status = 'confirmed'
    `).get(input.eventId || "", input.reportedUserId);
    if (!member) throw new Error("被举报用户不是这个局的已确认成员。");
  }
  const id = randomUUID();
  getDatabase().prepare(`
    INSERT INTO trust_reports (
      id, reporter_user_id, reported_user_id, event_id, category, details, evidence_url, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
  `).run(
    id, input.reporterUserId, input.reportedUserId || null, input.eventId || null, input.category.trim().slice(0, 80),
    input.details.trim().slice(0, 1500), input.evidenceUrl?.trim().slice(0, 1000) || "", now(), now(),
  );
  return id;
}

export function listTrustReports() {
  return getDatabase().prepare(`
    SELECT r.id, r.event_id AS eventId, e.payload_json AS eventPayload,
      r.category, r.details, r.evidence_url AS evidenceUrl, r.status,
      r.created_at AS createdAt, u.nickname AS reporterName, u.email AS reporterEmail,
      reported.nickname AS reportedUserName
    FROM trust_reports r
    JOIN app_users u ON u.id = r.reporter_user_id
    LEFT JOIN app_users reported ON reported.id = r.reported_user_id
    LEFT JOIN events e ON e.id = r.event_id
    ORDER BY CASE r.status WHEN 'submitted' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
      r.created_at DESC
  `).all().map((row) => {
    const item = row as Record<string, unknown> & { eventPayload?: string };
    let eventTitle = "相关局已删除";
    try {
      eventTitle = item.eventPayload ? (JSON.parse(item.eventPayload) as Opportunity).title : eventTitle;
    } catch { /* keep fallback title */ }
    const result = { ...item, eventTitle };
    delete result.eventPayload;
    return result;
  });
}

export function setTrustReportStatus(input: { reportId: string; status: "submitted" | "reviewing" | "resolved" | "rejected" }) {
  const database = getDatabase();
  const previous = database.prepare("SELECT status, reported_user_id FROM trust_reports WHERE id = ?")
    .get(input.reportId) as { status: "submitted" | "reviewing" | "resolved" | "rejected"; reported_user_id: string | null } | undefined;
  const result = database.prepare(`
    UPDATE trust_reports SET status = ?, updated_at = ? WHERE id = ?
  `).run(input.status, now(), input.reportId);
  if (result.changes !== 1) throw new Error("举报记录不存在。");
  if (previous?.reported_user_id && previous.status !== input.status) {
    getTrustSummary(previous.reported_user_id);
    const delta = input.status === "resolved" ? 1 : previous.status === "resolved" ? -1 : 0;
    if (delta !== 0) {
      database.prepare(`
        UPDATE trust_profiles SET report_count = max(0, report_count + ?),
          credit_score = max(0, min(100, credit_score - (? * 5))), updated_at = ? WHERE user_id = ?
      `).run(delta, delta, now(), previous.reported_user_id);
    }
  }
}

export function saveEventSettings(input: {
  eventId: string;
  registrationMode: "instant" | "approval";
  visibility: "public" | "invite_only";
  lifecycleStatus: RoomLifecycleStatus;
}) {
  const database = getDatabase();
  const row = database.prepare("SELECT payload_json FROM events WHERE id = ?").get(input.eventId) as { payload_json: string } | undefined;
  if (!row) throw new Error("活动不存在。");
  const event = JSON.parse(row.payload_json) as Opportunity;
  event.registrationMode = input.registrationMode;
  event.visibility = input.visibility;
  event.lifecycleStatus = input.lifecycleStatus;
  database.prepare("UPDATE events SET payload_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(event), now(), input.eventId);
  const state = ensureRoomState(input.eventId);
  updateRoomState({ ...roomStateFromRow(state), eventId: input.eventId, status: input.lifecycleStatus });
}

export function getAdminEvents() {
  const database = getDatabase();
  const rows = database.prepare(`
    SELECT id, payload_json, published FROM events
    ORDER BY json_extract(payload_json, '$.startsAt') ASC
  `).all() as unknown as EventRow[];
  const channels = database.prepare(`
    SELECT event_id, channel_type, label, join_url, instructions, enabled
    FROM event_join_channels
  `).all() as unknown as JoinChannelRow[];
  const registrations = database.prepare(`
    SELECT r.id, r.event_id AS eventId, r.status, r.note, r.joined_at AS joinedAt,
      u.nickname, u.email
    FROM event_registrations r
    JOIN app_users u ON u.id = r.user_id
    ORDER BY r.updated_at DESC
  `).all() as unknown as Array<Record<string, unknown> & { eventId: string }>;
  const roomStates = database.prepare("SELECT * FROM room_states").all() as unknown as RoomStateRow[];
  const channelByEvent = new Map(channels.map((item) => [item.event_id, item]));
  const stateByEvent = new Map(roomStates.map((item) => [item.event_id, item]));
  return rows.map((row) => {
    const event = parseEvent(row);
    const channel = channelByEvent.get(event.id);
    const state = stateByEvent.get(event.id);
    return {
      ...event,
      lifecycleStatus: state?.status || event.lifecycleStatus || "recruiting",
      published: booleanValue(row.published),
      joinChannel: channel ? {
        type: channel.channel_type,
        label: channel.label,
        href: channel.join_url,
        instructions: channel.instructions,
        enabled: booleanValue(channel.enabled),
      } : undefined,
      registrations: registrations.filter((item) => item.eventId === event.id),
    };
  });
}

export function updateUserProgress(email: string, progress: number) {
  getDatabase().prepare("UPDATE app_users SET progress = ?, last_seen_at = ? WHERE email = ?")
    .run(Math.max(0, Math.min(5, progress)), now(), email.toLowerCase());
}

export function logAgentRun(input: {
  requestType: "chat" | "event_match" | "recommendation";
  providerId?: string | null;
  providerName: string;
  model: string;
  status: "success" | "degraded" | "error";
  durationMs: number;
  errorMessage?: string;
  metadata?: Record<string, string | number | boolean>;
}) {
  getDatabase().prepare(`
    INSERT INTO agent_logs (
      id, request_type, provider_id, provider_name, model, status,
      duration_ms, error_message, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    input.requestType,
    input.providerId ?? null,
    input.providerName,
    input.model,
    input.status,
    input.durationMs,
    input.errorMessage?.slice(0, 500) ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    now(),
  );
}

export function getAdminDashboardData() {
  const database = getDatabase();
  const scalar = (sql: string) => Number((database.prepare(sql).get() as { count: number }).count);
  database.prepare(`
    INSERT OR IGNORE INTO trust_profiles (user_id, updated_at)
    SELECT id, ? FROM app_users
  `).run(now());
  const users = database.prepare(`
    SELECT u.id, u.email, u.nickname, u.role, u.progress, u.created_at AS createdAt,
      u.last_seen_at AS lastSeenAt, coalesce(r.status, 'none') AS restrictionStatus,
      r.reason AS restrictionReason, r.restricted_until AS restrictedUntil,
      t.email_verified AS emailVerified, t.phone_verified AS phoneVerified,
      t.work_verified AS workVerified, t.host_verified AS hostVerified,
      t.real_name_verified AS realNameVerified, t.institution_verified AS institutionVerified,
      t.credit_score AS creditScore, t.completed_rooms AS completedRooms,
      t.no_show_count AS noShowCount, t.report_count AS reportCount
    FROM app_users u
    LEFT JOIN user_restrictions r ON r.user_id = u.id
    LEFT JOIN trust_profiles t ON t.user_id = u.id
    ORDER BY u.last_seen_at DESC LIMIT 100
  `).all().map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      emailVerified: booleanValue(item.emailVerified),
      phoneVerified: booleanValue(item.phoneVerified),
      workVerified: booleanValue(item.workVerified),
      hostVerified: booleanValue(item.hostVerified),
      realNameVerified: booleanValue(item.realNameVerified),
      institutionVerified: booleanValue(item.institutionVerified),
    };
  });
  const inviteCodes = database.prepare(`
    SELECT code, max_uses AS maxUses, used_count AS usedCount, enabled, created_at AS createdAt
    FROM invite_codes ORDER BY created_at DESC
  `).all().map((row) => ({ ...row, enabled: booleanValue((row as { enabled: number }).enabled) }));
  const logs = database.prepare(`
    SELECT id, request_type AS requestType, provider_name AS providerName, model,
      status, duration_ms AS durationMs, error_message AS errorMessage, created_at AS createdAt
    FROM agent_logs ORDER BY created_at DESC LIMIT 100
  `).all();
  return {
    overview: {
      users: scalar("SELECT count(*) AS count FROM app_users"),
      activeInviteCodes: scalar("SELECT count(*) AS count FROM invite_codes WHERE enabled = 1 AND used_count < max_uses"),
      providers: scalar("SELECT count(*) AS count FROM model_providers WHERE enabled = 1"),
      agentRuns: scalar("SELECT count(*) AS count FROM agent_logs"),
      pendingReports: scalar("SELECT count(*) AS count FROM trust_reports WHERE status IN ('submitted', 'reviewing')"),
    },
    providers: listModelProviders(),
    inviteCodes,
    users,
    logs,
    events: getAdminEvents(),
    reports: listTrustReports(),
    environmentFallback: Boolean(process.env.STEP_API_KEY),
  };
}
