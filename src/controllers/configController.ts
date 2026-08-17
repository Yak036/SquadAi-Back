import type { NextFunction, Request, Response } from "express";
import {
  clearApiKey,
  getPublicConfig,
  patchSettings,
  upsertApiKey,
} from "../services/configService.js";
import type { ConfigPatch } from "../types.js";
import { AppError } from "../utils/errors.js";

export function getConfig(_req: Request, res: Response): void {
  res.json(getPublicConfig());
}

export function putConfig(req: Request, res: Response, next: NextFunction): void {
  try {
    const body = req.body as ConfigPatch | undefined;
    if (!body || typeof body !== "object") {
      throw new AppError("Body JSON requerido", 400);
    }
    if (body.settings) patchSettings(body.settings);
    if (Array.isArray(body.keys)) {
      for (const key of body.keys) {
        if (!key?.id) throw new AppError("keys[].id es obligatorio", 400);
        const patch: { id: string; label?: string; apiKey?: string; baseUrl?: string } = { id: key.id };
        if (typeof key.label === "string") patch.label = key.label;
        if (typeof key.apiKey === "string") patch.apiKey = key.apiKey;
        if (typeof key.baseUrl === "string") patch.baseUrl = key.baseUrl;
        upsertApiKey(patch);
      }
    }
    res.json(getPublicConfig());
  } catch (err) {
    next(err);
  }
}

export function listKeys(_req: Request, res: Response): void {
  res.json({ keys: getPublicConfig().keys });
}

export function putKey(req: Request, res: Response, next: NextFunction): void {
  try {
    const id = String(req.params.id ?? "");
    const body = (req.body ?? {}) as { label?: string; apiKey?: string; baseUrl?: string };
    const patch: { id: string; label?: string; apiKey?: string; baseUrl?: string } = { id };
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.apiKey === "string") patch.apiKey = body.apiKey;
    if (typeof body.baseUrl === "string") patch.baseUrl = body.baseUrl;
    res.json(upsertApiKey(patch));
  } catch (err) {
    next(err);
  }
}

export function deleteKey(req: Request, res: Response, next: NextFunction): void {
  try {
    res.json(clearApiKey(String(req.params.id ?? "")));
  } catch (err) {
    next(err);
  }
}
