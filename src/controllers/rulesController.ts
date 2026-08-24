import type { NextFunction, Request, Response } from "express";
import {
  createRule,
  deleteRule,
  getAllRules,
  getActiveRules,
  getRuleById,
  updateRule,
} from "../services/rulesService.js";
import type { RuleCreate, RulePatch, RuleScope } from "../types.js";
import { AppError } from "../utils/errors.js";

export function listRules(_req: Request, res: Response): void {
  res.json({ rules: getAllRules() });
}

export function listActiveRules(req: Request, res: Response, next: NextFunction): void {
  try {
    const scope = String(req.query.scope ?? "") as RuleScope;
    if (!scope || !["global", "boss", "worker", "qa", "chat"].includes(scope)) {
      throw new AppError("query param 'scope' requerido: global|boss|worker|qa|chat", 400);
    }
    res.json(getActiveRules(scope));
  } catch (err) {
    next(err);
  }
}

export function getRule(req: Request, res: Response, next: NextFunction): void {
  try {
    const rule = getRuleById(String(req.params.id ?? ""));
    if (!rule) throw new AppError("Regla no encontrada", 404);
    res.json(rule);
  } catch (err) {
    next(err);
  }
}

export function postRule(req: Request, res: Response, next: NextFunction): void {
  try {
    const body = req.body as RuleCreate | undefined;
    if (!body || typeof body !== "object") {
      throw new AppError("Body JSON requerido", 400);
    }
    if (!body.label?.trim()) throw new AppError("label es obligatorio", 400);
    if (!body.content?.trim()) throw new AppError("content es obligatorio", 400);
    const input: RuleCreate = {
      label: body.label,
      content: body.content,
    };
    if (body.scope) input.scope = body.scope;
    if (body.priority !== undefined) input.priority = body.priority;
    const rule = createRule(input);
    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
}

export function putRule(req: Request, res: Response, next: NextFunction): void {
  try {
    const id = String(req.params.id ?? "");
    const body = (req.body ?? {}) as RulePatch;
    const patch: RulePatch = {};
    if (body.scope !== undefined) patch.scope = body.scope;
    if (body.label !== undefined) patch.label = body.label;
    if (body.content !== undefined) patch.content = body.content;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.priority !== undefined) patch.priority = body.priority;
    res.json(updateRule(id, patch));
  } catch (err) {
    next(err);
  }
}

export function deleteRuleHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    deleteRule(String(req.params.id ?? ""));
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}
