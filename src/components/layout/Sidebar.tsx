import { useState } from "react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Layers,
  Loader2,
  Palette,
  Play,
  Settings,
  Users,
} from "lucide-react";
import { api } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type { LaunchMode, NavTab } from "../../types/mod";

const LAUNCH_MODES: Array<{ value: LaunchMode; label: string }> = [
  { value: "EFMI", label: "EFMI" },
  { value: "XXMI", label: "XXMI" },
  { value: "VANILLA", label: "原版" },
];

export function Sidebar() {
  const config = useAppStore((s) => s.config);
  const activeTab = useAppStore((s) => s.activeTab);
  const selectedCharacter = useAppStore((s) => s.selectedCharacter);
  const presetCount = useAppStore((s) => s.presetCount);
  const rabbitFxStatus = useAppStore((s) => s.rabbitFxStatus);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setSelectedCharacter = useAppStore((s) => s.setSelectedCharacter);
  const updateConfigPatch = useAppStore((s) => s.updateConfigPatch);
  const addToast = useAppStore((s) => s.addToast);

  const [launching, setLaunching] = useState(false);

  const collapsed = config?.sidebarCollapsed ?? false;
  const launchMode: LaunchMode = config?.launchMode ?? "EFMI";

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: typeof Users;
    badge?: number;
  }> = [
    { id: "characters", label: "角色", icon: Users },
    { id: "presets", label: "预设", icon: Layers, badge: presetCount },
    { id: "personalization", label: "个性化", icon: Palette },
    { id: "settings", label: "设置", icon: Settings },
  ];

  const handleNavClick = (tab: NavTab) => {
    if (tab === "characters" && activeTab === "characters" && selectedCharacter) {
      setSelectedCharacter(null);
      return;
    }
    setActiveTab(tab);
  };

  const handleToggleCollapse = async () => {
    try {
      await updateConfigPatch({ sidebarCollapsed: !collapsed });
    } catch (err) {
      addToast("error", `保存侧边栏状态失败：${String(err)}`);
    }
  };

  const handleSelectMode = async (mode: LaunchMode) => {
    try {
      await updateConfigPatch({ launchMode: mode });
    } catch (err) {
      addToast("error", `切换启动模式失败：${String(err)}`);
    }
  };

  const handleLaunchGame = async () => {
    if (launching) return;
    setLaunching(true);
    try {
      await api.launchGame(launchMode);
      addToast(
        "success",
        launchMode === "VANILLA" ? "已尝试启动原版《明日方舟：终末地》" : `已通过 ${launchMode} 启动游戏`
      );
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setLaunching(false);
    }
  };

  const handleClickRabbitFx = () => {
    setActiveTab("characters");
    setSelectedCharacter("功能");
  };

  const rfxState = rabbitFxStatus?.status ?? "missing";
  const rfxCount = rabbitFxStatus?.enabledCount ?? 0;

  return (
    <motion.aside
      initial={false}
      animate={{
        width: collapsed ? 72 : Math.round(224 * ((config?.sidebarZoom ?? 100) / 100)),
      }}
      transition={{ type: "spring", stiffness: 440, damping: 36 }}
      className="glass-surface relative z-20 flex shrink-0 flex-col border-y-0 border-l-0"
    >
      {/* Top toggle row */}
      <div
        className={`flex items-center px-3 pt-3 pb-2 ${
          collapsed ? "justify-center" : "justify-between"
        }`}
      >
        {!collapsed && (
          <span className="truncate text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
            导航菜单
          </span>
        )}
        <button
          type="button"
          onClick={handleToggleCollapse}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--accent)]"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Navigation items */}
      <nav className="flex-1 space-y-1.5 px-2.5 py-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              title={collapsed ? item.label : undefined}
              className={`group relative flex w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                collapsed ? "justify-center px-0" : "justify-between"
              } ${
                active
                  ? "text-[var(--accent-contrast)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active-pill"
                  transition={{ type: "spring", stiffness: 520, damping: 38 }}
                  className="absolute inset-0 rounded-xl bg-[var(--accent)] shadow-sm"
                />
              )}
              <span className="relative z-10 flex items-center gap-2.5 whitespace-nowrap">
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </span>
              {!collapsed && typeof item.badge === "number" && item.badge > 0 && (
                <span
                  className={`relative z-10 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                    active
                      ? "bg-black/15 text-[var(--accent-contrast)]"
                      : "bg-[var(--accent-soft)] text-[var(--accent)]"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom status + launch section */}
      <div className="space-y-2.5 border-t border-[var(--border-subtle)] p-2.5">
        {rabbitFxStatus && (
          <button
            type="button"
            onClick={handleClickRabbitFx}
            title={
              rfxState === "ok"
                ? "RabbitFX 已启用且仅存在 1 个实例（点击查看功能分类）"
                : rfxState === "multiple"
                  ? `检测到 ${rfxCount} 个 RabbitFX 同时启用，请立即排查（点击处理）`
                  : "未启用 RabbitFX（点击查看功能分类）"
            }
            className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs transition-colors ${
              collapsed ? "justify-center px-0" : ""
            } ${
              rfxState === "ok"
                ? "border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]"
                : rfxState === "multiple"
                  ? "border-[var(--danger)]/40 bg-[var(--danger-soft)] text-[var(--danger)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
            }`}
          >
            {rfxState === "ok" ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            )}
            {!collapsed && (
              <span className="truncate font-medium">
                {rfxState === "ok"
                  ? "RabbitFX 正常"
                  : rfxState === "multiple"
                    ? `RabbitFX 冲突 (${rfxCount})`
                    : "RabbitFX 未启用"}
              </span>
            )}
          </button>
        )}

        {!collapsed && (
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1">
            {LAUNCH_MODES.map((m) => {
              const selected = launchMode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => handleSelectMode(m.value)}
                  className={`rounded-lg py-1 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    selected
                      ? "bg-[var(--accent)] text-[var(--accent-contrast)] shadow-xs"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={handleLaunchGame}
          disabled={launching}
          title={collapsed ? `启动游戏 (${launchMode})` : undefined}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-2.5 text-sm font-semibold whitespace-nowrap text-[var(--accent-contrast)] shadow-sm transition-all hover:bg-[var(--accent-hover)] active:scale-[0.99] disabled:opacity-60"
        >
          {launching ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Play className="h-4 w-4 shrink-0 fill-current" />
          )}
          {!collapsed && <span className="whitespace-nowrap">启动终末地</span>}
        </button>
      </div>
    </motion.aside>
  );
}
