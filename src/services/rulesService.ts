import { getDb } from "../db/sqlite.js";
import type { ActiveRules, Rule, RuleCreate, RulePatch, RuleScope } from "../types.js";
import { AppError } from "../utils/errors.js";

type RuleRow = {
  id: string;
  scope: string;
  label: string;
  content: string;
  enabled: number;
  priority: number;
  created_at: string;
  updated_at: string;
};

const VALID_SCOPES: RuleScope[] = ["global", "boss", "worker", "qa", "chat"];
const DEFAULT_MAX_RULES = 5;

function rowToRule(row: RuleRow): Rule {
  return {
    id: row.id,
    scope: row.scope as RuleScope,
    label: row.label,
    content: row.content,
    enabled: row.enabled === 1,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAllRules(): Rule[] {
  const rows = getDb()
    .prepare("SELECT * FROM rules ORDER BY priority DESC, created_at ASC")
    .all() as RuleRow[];
  return rows.map(rowToRule);
}

export function getActiveRules(scope: RuleScope): ActiveRules {
  if (!VALID_SCOPES.includes(scope)) {
    throw new AppError(`Scope inválido: ${scope}`, 400);
  }
  const rows = getDb()
    .prepare("SELECT * FROM rules WHERE enabled = 1 ORDER BY priority DESC, created_at ASC")
    .all() as RuleRow[];
  const rules = rows.map(rowToRule);
  return {
    global: rules.filter((r) => r.scope === "global"),
    scoped: rules.filter((r) => r.scope === scope),
  };
}

export function getRuleById(id: string): Rule | undefined {
  const row = getDb().prepare("SELECT * FROM rules WHERE id = ?").get(id) as RuleRow | undefined;
  return row ? rowToRule(row) : undefined;
}

export function createRule(input: RuleCreate): Rule {
  const scope = input.scope ?? "global";
  if (!VALID_SCOPES.includes(scope)) {
    throw new AppError(`Scope inválido: ${scope}. Usa: ${VALID_SCOPES.join(", ")}`, 400);
  }
  if (!input.label?.trim()) {
    throw new AppError("label es obligatorio", 400);
  }
  if (!input.content?.trim()) {
    throw new AppError("content es obligatorio", 400);
  }

  const id = crypto.randomUUID().slice(0, 12);
  const priority = typeof input.priority === "number" ? input.priority : 0;

  getDb()
    .prepare(
      `INSERT INTO rules (id, scope, label, content, enabled, priority, created_at, updated_at)
       VALUES (@id, @scope, @label, @content, 1, @priority, datetime('now'), datetime('now'))`,
    )
    .run({ id, scope, label: input.label.trim(), content: input.content.trim(), priority });

  const rule = getRuleById(id);
  if (!rule) throw new AppError("No se pudo crear la regla", 500);
  return rule;
}

export function updateRule(id: string, patch: RulePatch): Rule {
  const existing = getRuleById(id);
  if (!existing) throw new AppError(`Regla no encontrada: ${id}`, 404);

  if (patch.scope !== undefined && !VALID_SCOPES.includes(patch.scope)) {
    throw new AppError(`Scope inválido: ${patch.scope}`, 400);
  }

  const scope = patch.scope ?? existing.scope;
  const label = patch.label?.trim() ?? existing.label;
  const content = patch.content?.trim() ?? existing.content;
  const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);
  const priority = patch.priority !== undefined ? patch.priority : existing.priority;

  getDb()
    .prepare(
      `UPDATE rules SET scope = @scope, label = @label, content = @content,
       enabled = @enabled, priority = @priority, updated_at = datetime('now')
       WHERE id = @id`,
    )
    .run({ id, scope, label, content, enabled, priority });

  const rule = getRuleById(id);
  if (!rule) throw new AppError("No se pudo actualizar la regla", 500);
  return rule;
}

export function deleteRule(id: string): void {
  const existing = getRuleById(id);
  if (!existing) throw new AppError(`Regla no encontrada: ${id}`, 404);
  getDb().prepare("DELETE FROM rules WHERE id = ?").run(id);
}

export function toggleRule(id: string, enabled: boolean): Rule {
  const existing = getRuleById(id);
  if (!existing) throw new AppError(`Regla no encontrada: ${id}`, 404);
  return updateRule(id, { enabled });
}

/**
 * Construye el string de rules para inyectar en un system prompt.
 * @param maxRules Límite máximo de rules a incluir (default: 5). Solo se toman las de mayor prioridad.
 */
export function buildRulesBlock(rules: ActiveRules, maxRules = DEFAULT_MAX_RULES): string {
  const all = [...rules.global, ...rules.scoped]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxRules);

  if (all.length === 0) return "";

  const lines = all.map((r, i) => `${i + 1}. [${r.scope}] ${r.label}: ${r.content}`);
  return `\n\n--- REGLAS DEL PROYECTO ---\n${lines.join("\n")}\n--- FIN REGLAS ---`;
}
