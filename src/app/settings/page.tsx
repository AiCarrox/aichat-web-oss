"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModelPicker } from "@/components/chat/model-picker";
import { toast } from "sonner";
import { ArrowLeft, Copy, Eye, EyeOff, RefreshCw, Trash2 } from "lucide-react";

interface SelfInfo {
  userId: string | null;
  displayName: string | null;
  hasConfig: boolean;
  source: "self" | "share" | null;
  defaultChatModel: string | null;
  defaultImageModel: string | null;
  share: {
    id: string;
    kind: "owner" | "guest";
    expiresAt: string | null;
    isGuest: boolean;
  } | null;
}

interface ConfigInfo {
  hasSelf: boolean;
  baseUrl?: string;
  apiKeyMasked?: string;
  defaultChatModel?: string | null;
  defaultImageModel?: string | null;
}

interface ShareData {
  owner: { id: string; createdAt: string; lastAccessedAt: string | null; accessCount: number } | null;
  guests: {
    id: string;
    createdAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    cleanedAt: string | null;
    lastAccessedAt: string | null;
    accessCount: number;
  }[];
}

const HOUR_PRESETS = [
  { label: "1 小时", v: 1 },
  { label: "6 小时", v: 6 },
  { label: "24 小时", v: 24 },
  { label: "72 小时", v: 72 },
  { label: "7 天", v: 24 * 7 },
];

export default function SettingsPage() {
  const router = useRouter();
  const [self, setSelf] = useState<SelfInfo | null>(null);
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [shareData, setShareData] = useState<ShareData | null>(null);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [chat, setChat] = useState("");
  const [image, setImage] = useState("");
  const [needsConfig, setNeedsConfig] = useState(false);
  const [savingModels, setSavingModels] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [hours, setHours] = useState(24);
  const [customHours, setCustomHours] = useState("");
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  useEffect(() => {
    fetch("/api/self")
      .then((r) => r.json())
      .then(setSelf)
      .catch(() => {});
    // 加载已保存配置;hasSelf=true 时无条件以 cookie 中的值为准(包括空值),
    // 不再让随后的 /api/models defaults 覆盖用户的真实选择。
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: ConfigInfo) => {
        setConfig(c);
        if (c.hasSelf) {
          setBaseUrl(c.baseUrl ?? "");
          setChat(c.defaultChatModel ?? "");
          setImage(c.defaultImageModel ?? "");
        }
      })
      .catch(() => {});
    fetch("/api/share")
      .then((r) => r.json())
      .then(setShareData)
      .catch(() => {});
    // /api/models 仅用于决定是否需要"未配置"横幅 + 拉模型列表喂 datalist;
    // 不再用它的 defaults 去覆盖任何已保存或用户手动键入的值。
    fetch("/api/models")
      .then((r) => r.json())
      .then((j) => {
        setNeedsConfig(!!j?.needsConfig);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const isGuest = self?.share?.isGuest === true;

  async function saveConfig() {
    if (!baseUrl.trim() || !apiKey.trim()) {
      toast.error("URL 和 Key 都必填");
      return;
    }
    setSavingCfg(true);
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        defaultChatModel: chat.trim() || null,
        defaultImageModel: image.trim() || null,
      }),
    });
    setSavingCfg(false);
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success("已保存");
      setApiKey("");
      refresh();
      // 失效 / 路由的 Router Cache，避免返回首页时仍看到"未配置"横幅。
      router.refresh();
    } else {
      toast.error(j?.error ?? "保存失败");
    }
  }

  async function clearConfig() {
    if (!confirm("清除当前配置 cookie?自己的数据不会被删除,只是退出当前空间。")) return;
    await fetch("/api/config", { method: "DELETE" });
    toast.success("已清除");
    router.refresh();
    refresh();
  }

  async function saveModelsOnly() {
    if (!config?.hasSelf) {
      toast.error("请先完整保存一次 URL+Key");
      return;
    }
    if (!chat.trim() || !image.trim()) {
      toast.error("聊天和绘画模型都必填");
      return;
    }
    setSavingModels(true);
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defaultChatModel: chat.trim(),
        defaultImageModel: image.trim(),
      }),
    });
    setSavingModels(false);
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success("默认模型已保存");
      refresh();
    } else {
      toast.error(j?.error ?? "保存失败");
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success("已复制"));
  }

  async function newGuest() {
    const v = customHours.trim() ? Number(customHours) : hours;
    if (!Number.isFinite(v) || v <= 0) {
      toast.error("无效小时数");
      return;
    }
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresInHours: v }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success("已创建访客链接");
      refresh();
    } else {
      toast.error(j?.error ?? "失败");
    }
  }

  async function revoke(id: string, isOwner: boolean) {
    const text = isOwner
      ? "重置个人永久链接?旧链接立即失效,会重新生成一个新的。"
      : "撤销该访客链接?将立即清除此命名空间下所有对话和图片。";
    if (!confirm(text)) return;
    const res = await fetch(`/api/share/${id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success(isOwner ? `已重置,新链接已生成` : "已撤销并清理");
      refresh();
    } else {
      toast.error(j?.error ?? "失败");
    }
  }

  async function logout() {
    if (!confirm("退出当前 ID?会清除浏览器 cookie,但服务端数据保留(再次输入相同 ID 即可恢复)。")) return;
    await fetch("/api/identity", { method: "DELETE" });
    await fetch("/api/config", { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  function shareUrl(id: string) {
    if (typeof window === "undefined") return `/s/${id}`;
    return `${window.location.origin}/s/${id}`;
  }

  // 返回首页时强制失效 Router Cache，确保 / 重新读取 cookie 渲染最新的 hasConfig 状态。
  function goHome() {
    router.push("/");
    router.refresh();
  }

  // 访客视图:仅展示有效期
  if (isGuest) {
    return (
      <div className="min-h-dvh bg-muted/30">
        <div className="max-w-2xl mx-auto p-6 space-y-6">
          <button
            type="button"
            onClick={goHome}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> 返回
          </button>
          <h1 className="text-2xl font-semibold">设置</h1>
          <section className="bg-background border rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-medium">访客身份</h2>
            <p className="text-sm">
              当前 ID: <code className="font-mono">{self?.displayName}</code>
            </p>
            {self?.share?.expiresAt && (
              <p className="text-sm text-muted-foreground">
                该链接有效期至 {new Date(self.share.expiresAt).toLocaleString()}
              </p>
            )}
            <Button variant="outline" onClick={logout}>
              退出当前 ID
            </Button>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-muted/30">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <button
          type="button"
          onClick={goHome}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <h1 className="text-2xl font-semibold">设置</h1>

        <section className="bg-background border rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">身份 ID</h2>
            <Button variant="outline" size="sm" onClick={logout}>
              退出
            </Button>
          </div>
          <p className="text-sm">
            当前 ID: <code className="font-mono">{self?.displayName ?? "<未设置>"}</code>
          </p>
          <p className="text-xs text-muted-foreground">
            数据按 ID 隔离;同一 ID 在不同设备打开本人专属永久链接即可恢复历史。
          </p>
        </section>

        <section className="bg-background border rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">API URL & Key</h2>
            {config?.hasSelf ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                已配置
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                未配置
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            URL 与 Key 经 AES-256-GCM 加密后写入 cookie / 数据库;不做格式校验。首次保存会自动生成"个人永久链接",在新设备上打开它就能直接进入你的空间。
          </p>
          {/* honeypot:吸走浏览器对"账号/密码登录表单"的启发式识别,
              使真实的 baseUrl/apiKey 字段不再被弹"保存密码" / 自动填充。
              业内通用做法,无障碍工具会忽略 aria-hidden 内容。 */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", height: 0, width: 0, overflow: "hidden" }}>
            <input type="text" name="username" tabIndex={-1} autoComplete="username" defaultValue="" />
            <input type="password" name="password" tabIndex={-1} autoComplete="current-password" defaultValue="" />
          </div>
          <div className="space-y-2">
            <label className="text-xs" htmlFor="upstream-endpoint">API URL</label>
            <Input
              id="upstream-endpoint"
              name="upstream-endpoint"
              type="url"
              placeholder="https://api.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs" htmlFor="upstream-token">API Key</label>
            <div className="relative">
              <Input
                id="upstream-token"
                name="upstream-token"
                type="text"
                placeholder={config?.hasSelf ? `当前: ${config.apiKeyMasked} - 重新输入以修改` : "粘贴你的 key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                style={
                  showKey
                    ? undefined
                    : ({ WebkitTextSecurity: "disc", textSecurity: "disc" } as React.CSSProperties)
                }
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                title={showKey ? "隐藏" : "显示"}
                aria-label={showKey ? "隐藏" : "显示"}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={saveConfig} disabled={savingCfg || !baseUrl.trim() || !apiKey.trim()}>
              保存
            </Button>
            {config?.hasSelf && (
              <Button variant="outline" onClick={clearConfig}>
                清除
              </Button>
            )}
          </div>
        </section>

        <section className="bg-background border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-medium">默认模型 <span className="text-xs font-normal text-muted-foreground">(可选)</span></h2>
          <p className="text-xs text-muted-foreground">
            可从下拉中选择,也可直接键入任意模型 ID(上游存在即可)。留空则使用服务器 .env 中的默认模型;两者都没有时,聊天/绘画请求会提示未配置。
          </p>
          {needsConfig && (
            <div className="text-xs rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
              请先在上方配置 URL+Key,模型列表才会出现;暂时仍可手动键入模型 ID。
            </div>
          )}
          <div className="flex flex-col gap-3">
            <ModelPicker label="聊天" value={chat} onChange={setChat} placeholder="如 gpt-5.4 / gpt-4o" />
            <ModelPicker
              label="绘画"
              value={image}
              onChange={setImage}
              filter={(id) => /image|dall|draw|flux|sd|gpt-image/i.test(id)}
              placeholder="如 gpt-image-2 / gpt-image-1"
            />
          </div>
          <Button
            variant="default"
            onClick={saveModelsOnly}
            disabled={savingModels || !config?.hasSelf || !chat.trim() || !image.trim()}
          >
            保存默认模型
          </Button>
        </section>

        {config?.hasSelf && (
          <>
            <section className="bg-background border rounded-xl p-6 space-y-4">
              <h2 className="text-lg font-medium">个人永久链接</h2>
              <p className="text-xs text-muted-foreground">
                此链接绑定本人 ID,新设备打开它即可自动登录,不能再分享出去用作访客模式。
              </p>
              {shareData?.owner ? (
                <div className="flex items-center gap-2">
                  <Input readOnly value={shareUrl(shareData.owner.id)} className="font-mono text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copy(shareUrl(shareData.owner!.id))}
                    title="复制"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => revoke(shareData.owner!.id, true)}
                    title="重置(旧链接失效)"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">尚未生成,保存配置后自动生成。</p>
              )}
            </section>

            <section className="bg-background border rounded-xl p-6 space-y-4">
              <h2 className="text-lg font-medium">访客分享链接</h2>
              <p className="text-xs text-muted-foreground">
                给别人快速使用,使用你的 Key,但访客看不到 / 改不了 URL+Key。访客可以填自己的 id 创建独立空间。链接到期后,该访客的对话和图片都会自动清理。
              </p>
              <div className="flex flex-wrap gap-2">
                {HOUR_PRESETS.map((p) => (
                  <Button
                    key={p.v}
                    variant={hours === p.v && !customHours ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setHours(p.v);
                      setCustomHours("");
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
                <Input
                  placeholder="自定义小时"
                  value={customHours}
                  onChange={(e) => setCustomHours(e.target.value.replace(/\D/g, ""))}
                  className="w-32"
                />
                <Button onClick={newGuest}>生成</Button>
              </div>
              <div className="space-y-2">
                {shareData?.guests?.length ? (
                  shareData.guests.map((g) => {
                    const expired = g.expiresAt && new Date(g.expiresAt).getTime() <= Date.now();
                    const dead = !!g.revokedAt || !!g.cleanedAt || expired;
                    return (
                      <div
                        key={g.id}
                        className="flex items-center gap-2 border rounded-md p-2 text-xs"
                      >
                        <code className="flex-1 truncate font-mono">{shareUrl(g.id)}</code>
                        <span className="whitespace-nowrap text-muted-foreground">
                          {dead
                            ? g.cleanedAt
                              ? "已清理"
                              : g.revokedAt
                                ? "已撤销"
                                : "已过期"
                            : g.expiresAt
                              ? `至 ${new Date(g.expiresAt).toLocaleString()}`
                              : ""}
                        </span>
                        <span className="whitespace-nowrap text-muted-foreground">
                          访问 {g.accessCount}
                        </span>
                        {!dead && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copy(shareUrl(g.id))}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => revoke(g.id, false)}
                              title="撤销并清理"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-muted-foreground">暂无访客链接。</p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
