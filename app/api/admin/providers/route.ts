import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin-auth";
import {
  deleteModelProvider,
  saveModelProvider,
  setDefaultModelProvider,
} from "@/lib/database";
import { isSameOriginRequest } from "@/lib/http-security";

export const runtime = "nodejs";

const providerKindSchema = z.enum([
  "stepfun", "openai", "deepseek", "qwen", "moonshot", "zhipu", "custom",
]);

const saveSchema = z.object({
  action: z.literal("save"),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  providerKind: providerKindSchema,
  baseUrl: z.string().url().max(300),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().max(500).optional(),
  enabled: z.boolean(),
  setDefault: z.boolean(),
});

const defaultSchema = z.object({
  action: z.literal("set_default"),
  id: z.string().uuid(),
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  id: z.string().uuid(),
});

const importEnvironmentSchema = z.object({ action: z.literal("import_environment") });

const actionSchema = z.discriminatedUnion("action", [
  saveSchema,
  defaultSchema,
  deleteSchema,
  importEnvironmentSchema,
]);

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "管理员登录已失效。" }, { status: 401 });
  }

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "模型平台配置不完整，请检查名称、地址和模型。" }, { status: 400 });
  }

  try {
    if (parsed.data.action === "save") {
      const id = saveModelProvider(parsed.data);
      return NextResponse.json({ ok: true, id });
    }
    if (parsed.data.action === "set_default") {
      setDefaultModelProvider(parsed.data.id);
      return NextResponse.json({ ok: true });
    }
    if (parsed.data.action === "import_environment") {
      const apiKey = process.env.STEP_API_KEY?.trim();
      if (!apiKey) throw new Error("环境变量中没有可导入的阶跃星辰 Key。 ");
      const id = saveModelProvider({
        name: "阶跃星辰",
        providerKind: "stepfun",
        baseUrl: process.env.STEP_API_BASE_URL || "https://api.stepfun.com/v1",
        model: process.env.STEP_MODEL || "step-3.5-flash-2603",
        apiKey,
        enabled: true,
        setDefault: true,
      });
      return NextResponse.json({ ok: true, id });
    }
    deleteModelProvider(parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "模型平台配置保存失败。",
    }, { status: 400 });
  }
}
