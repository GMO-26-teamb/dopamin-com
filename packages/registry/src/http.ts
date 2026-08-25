import { randomUUID } from "node:crypto";
import type { OperationCommand, RegistryId } from "@dopamin/shared";
import type { z } from "zod";
import {
  type EppEnvelope,
  interpretEppResponse,
  parseResData,
} from "./envelope";
import { RegistryError } from "./errors";

/** タイムアウト: 参照系 5 秒 / 更新系 15 秒（docs/requirements.md §11.1）。 */
const READ_TIMEOUT_MS = 5_000;
const WRITE_TIMEOUT_MS = 15_000;

export interface KitaqAdapterConfig {
  id: Exclude<RegistryId, "mock">;
  /** 例: https://epp.kitaqsign.com（docs.* は Swagger UI であって API ホストではない）。 */
  baseUrl: string;
  gateUser: string;
  gatePassword: string;
  registrarId: string;
  apiKey: string;
}

interface CommandOptions<T> {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** `/api/v1/epp` からの相対パス（例: `/domains/check`）。 */
  path: string;
  body?: unknown;
  /** 参照系 read（5s）/ 更新系 write（15s）。 */
  kind: "read" | "write";
  /**
   * コマンドの正準名（`packages/shared` の `OPERATION_COMMANDS`）。
   * エラーメッセージと `operation_logs.command`（§9.1）で同じ値を使う。
   */
  command: OperationCommand;
  resDataSchema: z.ZodType<T>;
}

/** clTRID（トレース ID）。毎回一意な値を採番する（64 文字以内）。 */
function newClTrid(): string {
  return `dp-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

/**
 * レジストリの EPP-over-REST API を呼ぶ薄い HTTP クライアント。
 * 2 段認証（Basic ゲート + X-Registrar-Id / X-Api-Key）と
 * 2 段判定（HTTP ステータス + result.code）をここで行う。
 */
export class KitaqHttpClient {
  private readonly authorization: string;

  constructor(private readonly config: KitaqAdapterConfig) {
    const basic = Buffer.from(
      `${config.gateUser}:${config.gatePassword}`,
    ).toString("base64");
    this.authorization = `Basic ${basic}`;
  }

  get registry(): Exclude<RegistryId, "mock"> {
    return this.config.id;
  }

  async command<T>(
    options: CommandOptions<T>,
  ): Promise<{ resData: T; envelope: EppEnvelope }> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/api/v1/epp${options.path}`;
    const timeoutMs =
      options.kind === "read" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;

    const headers: Record<string, string> = {
      Authorization: this.authorization,
      "X-Registrar-Id": this.config.registrarId,
      "X-Api-Key": this.config.apiKey,
      "X-Cl-TRID": newClTrid(),
      Accept: "application/json",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(timeoutMs),
        // EPP API は 3xx を返さない。追従すると認証ヘッダが別ホストに転送されうるため拒否する
        redirect: "error",
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "TimeoutError") {
        throw new RegistryError({
          code: "REGISTRY_TIMEOUT",
          registry: this.config.id,
          message: `${options.command}: レジストリが ${timeoutMs}ms 以内に応答しませんでした`,
          cause,
        });
      }
      throw new RegistryError({
        code: "REGISTRY_UNAVAILABLE",
        registry: this.config.id,
        message: `${options.command}: レジストリに接続できませんでした`,
        reason: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
    }

    // ボディ読込中のタイムアウト・切断も RegistryError に正規化する
    let rawBody: string;
    try {
      rawBody = await response.text();
    } catch (cause) {
      if (cause instanceof Error && cause.name === "TimeoutError") {
        throw new RegistryError({
          code: "REGISTRY_TIMEOUT",
          registry: this.config.id,
          message: `${options.command}: レジストリが ${timeoutMs}ms 以内に応答しませんでした`,
          cause,
        });
      }
      throw new RegistryError({
        code: "REGISTRY_UNAVAILABLE",
        registry: this.config.id,
        message: `${options.command}: レジストリ応答の読み込みに失敗しました`,
        reason: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      json = undefined;
    }

    const { envelope } = interpretEppResponse({
      registry: this.config.id,
      command: options.command,
      httpStatus: response.status,
      json,
      rawSnippet: json === undefined ? rawBody.slice(0, 200) : undefined,
    });

    const resData = parseResData(
      this.config.id,
      options.command,
      envelope,
      options.resDataSchema,
    );
    return { resData, envelope };
  }
}
