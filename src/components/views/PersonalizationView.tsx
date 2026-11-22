import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { buildMediaUrl } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type { ThemeId } from "../../types/mod";

const THEME_PRESETS: Array<{
  id: ThemeId;
  name: string;
  desc: string;
  previewBg: string;
  previewCard: string;
  previewAccent: string;
  dark: boolean;
}> = [
  {
    id: "rose-light",
    name: "樱粉浅色",
    desc: "柔和明亮 · 默认轻透玻璃感",
    previewBg: "#fbf8f9",
    previewCard: "#ffffff",
    previewAccent: "#efd0dc",
    dark: false,
  },
  {
    id: "midnight-dark",
    name: "午夜暗色",
    desc: "深蓝夜色 · 低眩光护眼",
    previewBg: "#0d111a",
    previewCard: "#151b28",
    previewAccent: "#f472b6",
    dark: true,
  },
  {
    id: "endfield-dark",
    name: "终末地工业暗",
    desc: "炭黑涂装 · 终末地标志明黄",
    previewBg: "#0b0e13",
    previewCard: "#141922",
    previewAccent: "#facc15",
    dark: true,
  },
  {
    id: "clean-light",
    name: "极简纯白",
    desc: "清爽克制 · 经典蓝色焦点",
    previewBg: "#f5f7fa",
    previewCard: "#ffffff",
    previewAccent: "#2563eb",
    dark: false,
  },
];

const ACCENT_SWATCHES = [
  "#d9a4b9",
  "#f43f5e",
  "#facc15",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#f97316",
];

const COMPAT_LEVELS = [
  { level: 0, title: "完整特效", desc: "全量毛玻璃模糊与细腻阴影动效" },
  { level: 1, title: "轻度磨砂", desc: "降低模糊半径，兼顾观感与流畅度" },
  { level: 2, title: "关闭磨砂", desc: "关闭 backdrop-filter，大幅减少 GPU 消耗" },
  { level: 3, title: "极速兼容", desc: "关闭全部模糊、阴影与过渡动画，低配/老显卡推荐" },
];

export function PersonalizationView() {
  const config = useAppStore((s) => s.config);
  const updateConfigPatch = useAppStore((s) => s.updateConfigPatch);
  const addToast = useAppStore((s) => s.addToast);

  if (!config) return null;

  const handleAddLocalBg = async () => {
    try {
      const picked = await openDialog({
        title: "添加本地背景图片",
        multiple: true,
        filters: [
          {
            name: "图片文件",
            extensions: ["png", "jpg", "jpeg", "webp", "bmp"],
          },
        ],
      });
      const files = Array.isArray(picked)
        ? picked
        : typeof picked === "string" && picked
          ? [picked]
          : [];
      if (files.length === 0) return;

      const merged = Array.from(new Set([...config.bgImages, ...files]));
      await updateConfigPatch({
        bgImages: merged,
        activeBgImage: files[0],
      });
      addToast("success", `已添加 ${files.length} 张本地背景图`);
    } catch (err) {
      addToast("error", `选择背景图片失败：${String(err)}`);
    }
  };

  const handleRemoveBg = async (target: string) => {
    const nextList = config.bgImages.filter((item) => item !== target);
    const nextActive = config.activeBgImage === target ? "" : config.activeBgImage;
    await updateConfigPatch({ bgImages: nextList, activeBgImage: nextActive });
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-4xl space-y-5 pb-8">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">个性化外观</h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            全部本地主题、自定义强调色与背景画廊永久免费开放，无需登录或赞助
          </p>
        </div>

        {/* Themes */}
        <section className="glass-card rounded-2xl p-5">
          <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">内置主题</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {THEME_PRESETS.map((t) => {
              const active = config.theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => updateConfigPatch({ theme: t.id })}
                  className={`flex flex-col rounded-2xl border p-3 text-left transition-all ${
                    active
                      ? "border-[var(--accent)] ring-2 ring-[var(--accent-soft)]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  <div
                    style={{ backgroundColor: t.previewBg }}
                    className="mb-2.5 flex h-16 w-full items-end justify-between rounded-xl border border-black/10 p-2"
                  >
                    <div
                      style={{ backgroundColor: t.previewCard }}
                      className="h-8 w-16 rounded-lg shadow-xs"
                    />
                    <div
                      style={{ backgroundColor: t.previewAccent }}
                      className="flex h-6 w-6 items-center justify-center rounded-full"
                    >
                      {active && <Check className="h-3.5 w-3.5 text-white" />}
                    </div>
                  </div>
                  <div className="text-xs font-semibold text-[var(--text-primary)]">{t.name}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{t.desc}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Custom Accent */}
        <section className="glass-card rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">自定义强调色</h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                覆盖当前主题的主按钮、选中框与高亮提示色
              </p>
            </div>
            <button
              type="button"
              onClick={() => updateConfigPatch({ customAccent: "" })}
              disabled={!config.customAccent}
              className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>恢复主题默认</span>
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            {ACCENT_SWATCHES.map((hex) => {
              const selected = config.customAccent.toLowerCase() === hex.toLowerCase();
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => updateConfigPatch({ customAccent: hex })}
                  style={{ backgroundColor: hex }}
                  aria-label={`选择强调色 ${hex}`}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-transform hover:scale-105 ${
                    selected ? "border-[var(--text-primary)] scale-110" : "border-white/40"
                  }`}
                >
                  {selected && <Check className="h-4 w-4 text-white drop-shadow" />}
                </button>
              );
            })}

            <label className="ml-2 flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-primary)]">
              <span>自定义取色</span>
              <input
                type="color"
                value={config.customAccent || THEME_PRESETS.find(({ id }) => id === config.theme)?.previewAccent || "#efd0dc"}
                onChange={(e) => updateConfigPatch({ customAccent: e.target.value })}
                className="h-5 w-7 cursor-pointer border-0 bg-transparent p-0"
              />
            </label>
          </div>
        </section>

        {/* Local Background Gallery */}
        <section className="glass-card space-y-4 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">本地背景图片</h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                支持从本机任意文件夹导入壁纸，搭配下方模糊与遮罩滑条调节可读性
              </p>
            </div>
            <div className="flex items-center gap-2">
              {config.activeBgImage && (
                <button
                  type="button"
                  onClick={() => updateConfigPatch({ activeBgImage: "" })}
                  className="rounded-xl border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  暂不使用背景图
                </button>
              )}
              <button
                type="button"
                onClick={handleAddLocalBg}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)]"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                <span>添加本地图片</span>
              </button>
            </div>
          </div>

          {config.bgImages.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {config.bgImages.map((imgPath) => {
                const active = config.activeBgImage === imgPath;
                const url = buildMediaUrl(imgPath);
                return (
                  <div
                    key={imgPath}
                    className={`group relative aspect-video overflow-hidden rounded-xl border transition-all ${
                      active
                        ? "border-[var(--accent)] ring-2 ring-[var(--accent-soft)]"
                        : "border-[var(--border-subtle)]"
                    }`}
                  >
                    {url && (
                      <img
                        src={url}
                        alt="背景缩略图"
                        onClick={() => updateConfigPatch({ activeBgImage: imgPath })}
                        className="h-full w-full cursor-pointer object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    )}
                    {active && (
                      <span className="absolute top-1.5 left-1.5 rounded-md bg-[var(--accent-fill)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-contrast)]">
                        当前使用
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveBg(imgPath)}
                      title="从画廊移除"
                      className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--danger)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-6 text-center text-xs text-[var(--text-muted)]">
              画廊暂无背景图，点击右上角「添加本地图片」即可导入
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-3">
            <label className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-secondary)]">背景模糊度</span>
                <span className="font-medium tabular-nums">{config.bgBlur} px</span>
              </div>
              <input
                type="range"
                min={0}
                max={32}
                step={1}
                value={config.bgBlur}
                onChange={(e) => updateConfigPatch({ bgBlur: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </label>

            <label className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-secondary)]">遮罩浓度</span>
                <span className="font-medium tabular-nums">{config.bgOverlay}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={85}
                step={1}
                value={config.bgOverlay}
                onChange={(e) => updateConfigPatch({ bgOverlay: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </label>

            <label className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-secondary)]">背景不透明度</span>
                <span className="font-medium tabular-nums">{config.bgOpacity}%</span>
              </div>
              <input
                type="range"
                min={40}
                max={100}
                step={1}
                value={config.bgOpacity}
                onChange={(e) => updateConfigPatch({ bgOpacity: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </label>
          </div>
        </section>

        {/* Sidebar zoom & compatibility level */}
        <section className="glass-card grid grid-cols-1 gap-5 rounded-2xl p-5 sm:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">侧边栏缩放比例</h2>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={85}
                max={120}
                step={5}
                value={config.sidebarZoom}
                onChange={(e) => updateConfigPatch({ sidebarZoom: Number(e.target.value) })}
                className="flex-1 accent-[var(--accent)]"
              />
              <span className="w-12 text-right text-xs font-semibold tabular-nums">
                {config.sidebarZoom}%
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              在高分屏（2K / 4K）或小窗口下调节展开态侧边栏宽度
            </p>
          </div>

          <div className="space-y-2.5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              性能与渲染兼容模式
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {COMPAT_LEVELS.map((item) => {
                const selected = config.compatLevel === item.level;
                return (
                  <button
                    key={item.level}
                    type="button"
                    onClick={() => updateConfigPatch({ compatLevel: item.level })}
                    className={`rounded-xl border p-2.5 text-left transition-colors ${
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <div
                      className={`text-xs font-semibold ${
                        selected ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                      }`}
                    >
                      {item.level} · {item.title}
                    </div>
                    <div className="mt-0.5 text-[10px] leading-snug text-[var(--text-secondary)]">
                      {item.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
