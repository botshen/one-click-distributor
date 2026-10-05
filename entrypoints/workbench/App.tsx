import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clipboard,
  Clock,
  ExternalLink,
  Feather,
  FileText,
  FileUp,
  Info,
  Layers3,
  Loader2,
  Plus,
  Trash2,
  Type,
} from "lucide-react";
import MarkdownIt from "markdown-it";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import {
  createDistributionDraft,
  type DistributionDraft,
  deleteDistributionDraft,
  getDistributionDraft,
  listDistributionDrafts,
  saveDistributionDraft,
} from "@/packages/core/distribution/draft-store";
import { fillPlatformTab } from "@/packages/core/distribution/fill-tab";
import {
  hasRelativeMarkdownImages,
  parseImportedMarkdown,
} from "@/packages/core/distribution/markdown";
import { preparePlatformTabs } from "@/packages/core/distribution/platform-tabs";
import {
  DISTRIBUTION_PLATFORMS,
  findPlatformTab,
  getDistributionPlatform,
  isPlatformEditorUrl,
  type PlatformId,
} from "@/packages/core/distribution/platforms";

type WorkspaceStep = "drafts" | "edit" | "platforms";
type TargetTabState = "checking" | "missing" | "site" | "editor";
type PlatformTabStates = Record<PlatformId, TargetTabState>;
const numberFormatter = new Intl.NumberFormat("zh-CN");
const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const markdownRenderer = new MarkdownIt({ html: false, breaks: true, linkify: true });
markdownRenderer.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noreferrer noopener");
  return self.renderToken(tokens, index, options);
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

export default function App() {
  const [drafts, setDrafts] = useState<DistributionDraft[]>([]);
  const [draft, setDraft] = useState<DistributionDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState<"" | "open" | "prepare" | "fill" | "fill-all">("");
  const [fillProgress, setFillProgress] = useState("");
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [platform, setPlatform] = useState<PlatformId>("juejin");
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformId[]>(["juejin"]);
  const [step, setStep] = useState<WorkspaceStep>(() =>
    new URLSearchParams(location.search).get("view") === "drafts" ? "drafts" : "edit",
  );
  const [targetTabs, setTargetTabs] = useState<PlatformTabStates>({
    wechat: "checking",
    zhihu: "checking",
    juejin: "checking",
    zsxq: "checking",
  });
  const selectedPlatform = getDistributionPlatform(platform);
  const targetState = targetTabs[platform];
  const platformTabId =
    draft?.platformTabIds?.[platform] ?? (platform === "juejin" ? draft?.juejinTabId : undefined);
  const platformFill =
    draft?.platformFills?.[platform] ?? (platform === "juejin" ? draft?.lastFill : undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<DistributionDraft | null>(null);
  const deferredMarkdown = useDeferredValue(draft?.markdown ?? "");
  const previewHtml = useMemo(() => markdownRenderer.render(deferredMarkdown), [deferredMarkdown]);
  const titleReady = Boolean(draft?.title.trim());
  const bodyReady = Boolean(draft?.markdown.trim());
  const relativeImages = hasRelativeMarkdownImages(draft?.markdown ?? "");
  const fillStatus =
    busy === "fill"
      ? "正在填稿"
      : platformFill?.status === "filled"
        ? "已填入草稿"
        : platformFill?.status === "failed"
          ? "填稿未完成"
          : !titleReady || !bodyReady
            ? "待完善稿件"
            : relativeImages
              ? "待处理图片"
              : targetState === "checking"
                ? "正在检查标签页"
                : targetState === "editor"
                  ? "待填稿"
                  : "待打开编辑器";

  useEffect(() => {
    if (!draft?.id || step !== "platforms") return;
    let active = true;
    let checkVersion = 0;
    const refresh = async () => {
      const version = ++checkVersion;
      const states = {} as PlatformTabStates;
      await Promise.all(
        DISTRIBUTION_PLATFORMS.map(async (item) => {
          let state: TargetTabState = "missing";
          try {
            const storedId =
              draft.platformTabIds?.[item.id] ??
              (item.id === "juejin" ? draft.juejinTabId : undefined);
            const id = await findPlatformTab(item.id, storedId);
            if (id !== undefined) {
              const tab = await browser.tabs.get(id);
              state = isPlatformEditorUrl(item.id, tab.url) ? "editor" : "site";
            }
          } catch {
            // A tab can close while its metadata is being read; it is no longer a target.
          }
          states[item.id] = state;
        }),
      );
      if (active && version === checkVersion) setTargetTabs(states);
    };
    const refreshOnChange = () => void refresh();
    const refreshOnUpdate = (_id: number, change: { url?: string; status?: string }) => {
      if (change.url !== undefined || change.status === "complete") refreshOnChange();
    };
    setTargetTabs({ wechat: "checking", zhihu: "checking", juejin: "checking", zsxq: "checking" });
    refreshOnChange();
    browser.tabs.onUpdated.addListener(refreshOnUpdate);
    browser.tabs.onRemoved.addListener(refreshOnChange);
    browser.tabs.onActivated.addListener(refreshOnChange);
    window.addEventListener("focus", refreshOnChange);
    return () => {
      active = false;
      browser.tabs.onUpdated.removeListener(refreshOnUpdate);
      browser.tabs.onRemoved.removeListener(refreshOnChange);
      browser.tabs.onActivated.removeListener(refreshOnChange);
      window.removeEventListener("focus", refreshOnChange);
    };
  }, [step, draft?.id, draft?.platformTabIds, draft?.juejinTabId]);

  function togglePlatform(id: PlatformId) {
    if (busy) return;
    setPlatform(id);
    setSelectedPlatforms((current) => {
      if (!current.includes(id)) return [...current, id];
      return current.length === 1 ? current : current.filter((item) => item !== id);
    });
  }

  function rememberPlatformTabs(items: Array<{ platform: PlatformId; tabId: number }>) {
    const current = draftRef.current;
    if (!current) return;
    const next = {
      ...current,
      platformTabIds: {
        ...current.platformTabIds,
        ...Object.fromEntries(items.map((item) => [item.platform, item.tabId])),
      },
      updatedAt: Date.now(),
    };
    draftRef.current = next;
    setDraft(next);
  }

  async function prepareSelectedPlatforms() {
    if (!draft || busy) return;
    setBusy("prepare");
    try {
      const prepared = await preparePlatformTabs(selectedPlatforms, draft.platformTabIds);
      rememberPlatformTabs(prepared);
      const created = prepared.filter((item) => item.created).length;
      toast.success(
        created
          ? `已在“一键分发 · 待填稿”标签组中打开 ${created} 个平台，请完成登录并进入编辑页。`
          : "所选平台已整理到“一键分发 · 待填稿”标签组。",
      );
    } catch (error) {
      toast.error(`准备平台失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function fillSelectedPlatforms() {
    if (!draft || busy) return;
    if (!draft.title.trim() || !draft.markdown.trim()) {
      toast.error("请先填写标题和正文");
      return;
    }
    if (hasRelativeMarkdownImages(draft.markdown)) {
      toast.error("请先把相对路径图片改成可访问的图片 URL，再填稿。");
      return;
    }
    const readyPlatforms = selectedPlatforms.filter((id) => targetTabs[id] === "editor");
    if (!readyPlatforms.length) {
      toast.error("所选平台尚未进入编辑页，请先准备平台并完成登录。");
      return;
    }
    setBusy("fill-all");
    try {
      const current = await flushDraft();
      let successCount = 0;
      const records = { ...draftRef.current?.platformFills };
      const remembered: Array<{ platform: PlatformId; tabId: number }> = [];
      for (const [index, id] of readyPlatforms.entries()) {
        const item = getDistributionPlatform(id);
        setFillProgress(`正在填入 ${item.name}（${index + 1}/${readyPlatforms.length}）…`);
        const tabId = await findPlatformTab(id, current.platformTabIds?.[id]);
        if (tabId === undefined) continue;
        const result = await fillPlatformTab(id, tabId, {
          title: current.title.trim(),
          markdown: current.markdown,
        });
        remembered.push({ platform: id, tabId });
        records[id] = {
          at: Date.now(),
          status: result.success ? "filled" : "failed",
          message: result.message,
          warnings: result.warnings,
        };
        if (result.success) successCount++;
      }
      const latest = draftRef.current;
      if (latest) {
        updateDraft({
          platformTabIds: {
            ...latest.platformTabIds,
            ...Object.fromEntries(remembered.map((item) => [item.platform, item.tabId])),
          },
          platformFills: records,
        });
      }
      const skipped = selectedPlatforms.length - readyPlatforms.length;
      const message = `已填入 ${successCount}/${readyPlatforms.length} 个就绪平台${skipped ? `，${skipped} 个平台尚未就绪` : ""}。请到各平台检查并保存。`;
      if (successCount === readyPlatforms.length) toast.success(message);
      else toast.warning(message);
    } catch (error) {
      toast.error(`批量填稿中断：${errorMessage(error)}`);
    } finally {
      setBusy("");
      setFillProgress("");
    }
  }

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const all = await listDistributionDrafts();
        const requestedId = decodeURIComponent(location.hash.slice(1));
        const selected = requestedId ? await getDistributionDraft(requestedId) : (all[0] ?? null);
        if (!active) return;
        setDrafts(all);
        setDraft(selected);
        draftRef.current = selected;
      } catch (error) {
        if (active) toast.error(`稿件库读取失败：${errorMessage(error)}`);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!draft || loading) return;
    draftRef.current = draft;
    setSaving(true);
    const timer = window.setTimeout(async () => {
      try {
        await saveDistributionDraft(draft);
        setDrafts((current) =>
          [draft, ...current.filter((item) => item.id !== draft.id)].sort(
            (a, b) => b.updatedAt - a.updatedAt,
          ),
        );
        setSaveError("");
      } catch (error) {
        setSaveError(errorMessage(error));
      } finally {
        setSaving(false);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft, loading]);

  useEffect(() => {
    if (!saving && !saveError) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving, saveError]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        const current = draftRef.current;
        if (!current) return;
        void saveDistributionDraft(current)
          .then(() => {
            setSaveError("");
            toast.success("稿件已保存");
          })
          .catch((error) => toast.error(`保存失败：${errorMessage(error)}`));
      }
      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        setView((current) => (current === "edit" ? "preview" : "edit"));
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  function updateDraft(patch: Partial<DistributionDraft>) {
    const contentChanged = "title" in patch || "markdown" in patch;
    setDraft((current) => {
      if (!current) return null;
      const next = {
        ...current,
        ...patch,
        ...(contentChanged ? { lastFill: undefined, platformFills: undefined } : {}),
        updatedAt: Date.now(),
      };
      draftRef.current = next;
      return next;
    });
  }

  function changeView(next: "edit" | "preview") {
    setView(next);
    window.requestAnimationFrame(() => {
      document.getElementById(`distribution-${next}-tab`)?.focus();
    });
  }

  function handleViewKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    changeView(view === "edit" ? "preview" : "edit");
  }

  function handlePlatformKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (busy) return;
    if ((event.target as HTMLElement).getAttribute("role") === "checkbox") return;
    const index = DISTRIBUTION_PLATFORMS.findIndex((item) => item.id === platform);
    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        nextIndex = (index + 1) % DISTRIBUTION_PLATFORMS.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        nextIndex = (index - 1 + DISTRIBUTION_PLATFORMS.length) % DISTRIBUTION_PLATFORMS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = DISTRIBUTION_PLATFORMS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = DISTRIBUTION_PLATFORMS[nextIndex].id;
    setPlatform(next);
    document.getElementById(`distribution-platform-${next}`)?.focus();
  }

  async function flushDraft() {
    const current = draftRef.current;
    if (!current) throw new Error("请先创建或选择稿件");
    await saveDistributionDraft(current);
    setSaveError("");
    return current;
  }

  async function chooseDraft(item: DistributionDraft) {
    if (busy) return;
    try {
      if (draftRef.current) await flushDraft();
      setDraft(item);
      draftRef.current = item;
      location.hash = encodeURIComponent(item.id);
    } catch (error) {
      toast.error(`当前稿件保存失败：${errorMessage(error)}`);
    }
  }

  async function addDraft(
    input: Pick<DistributionDraft, "title" | "markdown" | "source" | "sourceUrl">,
  ) {
    if (busy) return;
    try {
      if (draftRef.current) await flushDraft();
      const next = createDistributionDraft(input);
      await saveDistributionDraft(next);
      setDrafts((current) => [next, ...current]);
      setDraft(next);
      draftRef.current = next;
      setView("edit");
      location.hash = encodeURIComponent(next.id);
    } catch (error) {
      toast.error(`创建稿件失败：${errorMessage(error)}`);
    }
  }

  async function importFile(file: File) {
    if (!/\.(md|markdown)$/i.test(file.name)) {
      toast.error("请选择 .md 或 .markdown 文件");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error("文件超过 4 MB，请先精简后导入");
      return;
    }
    const parsed = parseImportedMarkdown(await file.text(), file.name);
    await addDraft({ ...parsed, source: "file", sourceUrl: "" });
  }

  async function removeDraft() {
    if (!draft || busy || !window.confirm(`删除“${draft.title}”？此操作无法撤销。`)) return;
    const deleting = draft;
    draftRef.current = null;
    setDraft(null);
    setSaving(false);
    try {
      await deleteDistributionDraft(deleting.id);
      const remaining = drafts.filter((item) => item.id !== deleting.id);
      setDrafts(remaining);
      setDraft(remaining[0] ?? null);
      draftRef.current = remaining[0] ?? null;
      location.hash = remaining[0] ? encodeURIComponent(remaining[0].id) : "";
      toast.success("稿件已删除");
    } catch (error) {
      setDraft(deleting);
      draftRef.current = deleting;
      toast.error(`删除失败：${errorMessage(error)}`);
    }
  }

  async function openPlatform() {
    if (!draft || busy) return;
    setBusy("open");
    try {
      let tabId = await findPlatformTab(platform, platformTabId);
      if (tabId === undefined) {
        const opened = await browser.tabs.create({ url: selectedPlatform.editorUrl, active: true });
        tabId = opened.id;
      }
      if (tabId === undefined) throw new Error("浏览器未返回标签页 ID");
      updateDraft({ platformTabIds: { ...draft.platformTabIds, [platform]: tabId } });
      await browser.tabs.update(tabId, { active: true });
      toast.success(selectedPlatform.instructions);
    } catch (error) {
      toast.error(`打开${selectedPlatform.name}失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function fillPlatform() {
    if (!draft || busy) return;
    if (!draft.title.trim() || !draft.markdown.trim()) {
      toast.error("请先填写标题和正文");
      return;
    }
    if (hasRelativeMarkdownImages(draft.markdown)) {
      toast.error("请先把相对路径图片改成可访问的图片 URL，再填稿。");
      return;
    }
    setBusy("fill");
    setFillProgress("正在查找目标编辑器…");
    try {
      const current = await flushDraft();
      const tabId = await findPlatformTab(platform, platformTabId);
      if (tabId === undefined)
        throw new Error(`请先打开${selectedPlatform.name}编辑器并完成登录。`);
      const result = await fillPlatformTab(
        platform,
        tabId,
        {
          title: current.title.trim(),
          markdown: current.markdown,
        },
        setFillProgress,
      );
      // An in-flight fill belongs to the captured version, not to subsequent edits.
      if (draftRef.current?.id === current.id) {
        const unchanged =
          draftRef.current.title === current.title &&
          draftRef.current.markdown === current.markdown;
        updateDraft({
          platformTabIds: { ...draftRef.current.platformTabIds, [platform]: tabId },
          ...(unchanged
            ? {
                platformFills: {
                  ...draftRef.current.platformFills,
                  [platform]: {
                    at: Date.now(),
                    status: result.success ? "filled" : "failed",
                    message: result.message,
                    warnings: result.warnings,
                  },
                },
              }
            : {}),
        });
      }
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      if (result.warnings?.length) toast.warning(result.message);
      else toast.success(`内容已填入${selectedPlatform.name}编辑器，请检查后保存。`);
      await browser.tabs.update(tabId, { active: true });
    } catch (error) {
      if (
        draftRef.current?.id === draft.id &&
        draftRef.current.title === draft.title &&
        draftRef.current.markdown === draft.markdown
      )
        updateDraft({
          platformFills: {
            ...draftRef.current.platformFills,
            [platform]: { at: Date.now(), status: "failed", message: errorMessage(error) },
          },
        });
      toast.error(`填入失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
      setFillProgress("");
    }
  }

  async function copyMarkdown() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.markdown);
      toast.success("Markdown 已复制");
    } catch (error) {
      toast.error(`复制失败：${errorMessage(error)}`);
    }
  }

  return (
    <div className="distribution-app">
      <Toaster position="top-center" richColors />
      <a className="distribution-skip-link" href="#distribution-content">
        跳到主要内容
      </a>
      <header className="distribution-header">
        <div className="distribution-header-start">
          <BrandLogo className="size-10" />
          <div className="distribution-brand-copy">
            <span className="distribution-product">一键分发</span>
            <span className="distribution-tagline">Markdown 多平台草稿</span>
          </div>
        </div>
        <nav className="distribution-workflow" aria-label="工作台视图">
          <button
            type="button"
            aria-current={step === "drafts" ? "page" : undefined}
            disabled={busy !== ""}
            onClick={() => setStep("drafts")}
          >
            <span className="distribution-step-icon">
              <FileText aria-hidden="true" />
            </span>
            <strong>稿件</strong>
            <small>{numberFormatter.format(drafts.length)} 篇本地稿件</small>
          </button>
          <ChevronRight className="distribution-step-separator" aria-hidden="true" />
          <button
            type="button"
            aria-current={step === "edit" ? "page" : undefined}
            disabled={!draft || busy !== ""}
            onClick={() => setStep("edit")}
          >
            <span className="distribution-step-icon">
              <Feather aria-hidden="true" />
            </span>
            <strong>编辑母稿</strong>
            <small>{draft ? "编辑与预览" : "先选择稿件"}</small>
          </button>
          <ChevronRight className="distribution-step-separator" aria-hidden="true" />
          <button
            type="button"
            aria-current={step === "platforms" ? "page" : undefined}
            disabled={!draft || busy !== ""}
            onClick={() => setStep("platforms")}
          >
            <span className="distribution-step-icon">
              <ExternalLink aria-hidden="true" />
            </span>
            <strong>平台草稿</strong>
            <small>{step === "platforms" ? selectedPlatform.name : "选择发布平台"}</small>
          </button>
        </nav>
        <div className="distribution-header-actions">
          {draft && (
            <span
              className={`distribution-save-state${saveError ? " is-error" : ""}`}
              role="status"
              aria-live="polite"
            >
              {saveError ? (
                <CircleAlert aria-hidden="true" />
              ) : saving ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <CircleCheck aria-hidden="true" />
              )}
              {saveError ? "保存失败" : saving ? "保存中…" : "已保存"}
            </span>
          )}
          {step !== "platforms" && (
            <Button
              type="button"
              size="sm"
              disabled={!draft || busy !== ""}
              onClick={() => setStep(step === "drafts" ? "edit" : "platforms")}
            >
              下一步：{step === "drafts" ? "编辑母稿" : "选择平台"}
              <ChevronRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>
      <main id="distribution-content" className="distribution-main" tabIndex={-1}>
        {loading ? (
          <div className="distribution-empty">
            <Loader2 aria-hidden="true" className="animate-spin" />
            正在读取本地稿件…
          </div>
        ) : step === "drafts" || !draft ? (
          <section className="distribution-library" aria-labelledby="distribution-library-title">
            <header className="distribution-section-heading">
              <div>
                <h1 id="distribution-library-title">稿件库</h1>
                <p>选择已有稿件，或从 Markdown 和网页采集开始。</p>
              </div>
              <div className="distribution-library-actions">
                <Button
                  type="button"
                  onClick={() => {
                    void addDraft({
                      title: "未命名稿件",
                      markdown: "",
                      source: "manual",
                      sourceUrl: "",
                    });
                    setStep("edit");
                  }}
                >
                  <Plus aria-hidden="true" />
                  新建稿件
                </Button>
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                  <FileUp aria-hidden="true" />
                  导入 Markdown
                </Button>
              </div>
            </header>
            <button
              type="button"
              className={`distribution-dropzone${isDraggingFile ? " is-dragging" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDraggingFile(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDraggingFile(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDraggingFile(false);
                const file = event.dataTransfer.files[0];
                if (file) {
                  void importFile(file);
                  setStep("edit");
                }
              }}
            >
              <FileUp aria-hidden="true" className="distribution-dropzone-icon" />
              <span>
                <strong>拖入 Markdown 文件</strong>
                <small>支持 .md 和 .markdown，最大 4 MB</small>
              </span>
            </button>
            <div className="distribution-library-list">
              {drafts.length === 0 ? (
                <div className="distribution-list-empty">
                  <h2>还没有稿件</h2>
                  <p>新建空白稿件，或导入本地 Markdown。</p>
                </div>
              ) : (
                drafts.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={draft?.id === item.id ? "page" : undefined}
                    onClick={() => {
                      void chooseDraft(item);
                      setStep("edit");
                    }}
                  >
                    <span className="distribution-document-icon" aria-hidden="true">
                      MD
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {item.source === "capture"
                          ? "网页采集"
                          : item.source === "file"
                            ? "MD 文件"
                            : "手动新建"}{" "}
                        · {dateTimeFormatter.format(item.updatedAt)}
                      </small>
                    </span>
                    <span>编辑</span>
                  </button>
                ))
              )}
            </div>
          </section>
        ) : step === "platforms" ? (
          <section
            className="distribution-platform-workspace"
            aria-labelledby="distribution-platform-title"
          >
            <Card className="distribution-platform-sidebar">
              <CardHeader className="distribution-card-heading">
                <h1 id="distribution-platform-title">选择发布平台</h1>
                <p>选择平台并检查内容，再填入草稿。</p>
              </CardHeader>
              <CardContent className="distribution-sidebar-content">
                <div
                  className="distribution-platform-list"
                  role="tablist"
                  aria-label="目标平台"
                  aria-orientation="vertical"
                  onKeyDown={handlePlatformKeyDown}
                >
                  {DISTRIBUTION_PLATFORMS.map((item) => (
                    <div
                      id={`distribution-platform-${item.id}`}
                      key={item.id}
                      role="tab"
                      aria-selected={platform === item.id}
                      aria-controls="distribution-platform-panel"
                      tabIndex={platform === item.id ? 0 : -1}
                      aria-disabled={busy !== ""}
                      onClick={() => {
                        if (!busy) setPlatform(item.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        if (!busy) setPlatform(item.id);
                      }}
                    >
                      <PlatformLogo platform={item.id} />
                      <span className="distribution-platform-label">
                        <strong>{item.name}</strong>
                        <small>{item.description}</small>
                      </span>
                      <span className="distribution-platform-capability">
                        <button
                          type="button"
                          className={`distribution-platform-picker${selectedPlatforms.includes(item.id) ? " is-selected" : ""}`}
                          aria-pressed={selectedPlatforms.includes(item.id)}
                          aria-label={`${selectedPlatforms.includes(item.id) ? "取消选择" : "选择"}${item.name}`}
                          disabled={busy !== ""}
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePlatform(item.id);
                          }}
                        >
                          {selectedPlatforms.includes(item.id) && <Check aria-hidden="true" />}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="distribution-selection-hint">
                  点击平台切换详情；右侧勾选框选择批量填稿目标。
                </p>
                <div className="distribution-batch-actions">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy !== ""}
                    onClick={() => void prepareSelectedPlatforms()}
                  >
                    {busy === "prepare" ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <Layers3 aria-hidden="true" />
                    )}
                    准备所选平台
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      busy !== "" ||
                      !titleReady ||
                      !bodyReady ||
                      relativeImages ||
                      !selectedPlatforms.some((id) => targetTabs[id] === "editor")
                    }
                    onClick={() => void fillSelectedPlatforms()}
                  >
                    {busy === "fill-all" ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <Feather aria-hidden="true" />
                    )}
                    一键填入已就绪平台
                  </Button>
                </div>
              </CardContent>
            </Card>
            <div className="distribution-platform-main">
              <Card className="distribution-flow-card">
                <CardHeader className="distribution-card-heading distribution-flow-heading">
                  <div>
                    <h2>发布流程预览</h2>
                    <p>当前母稿通过一键分发适配，填入所选平台草稿。</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy !== ""}
                    onClick={() => setStep("edit")}
                  >
                    <ChevronLeft aria-hidden="true" />
                    返回编辑
                  </Button>
                </CardHeader>
                <CardContent className="distribution-flow-content">
                  <DistributionMap draft={draft} selectedPlatform={platform} />
                </CardContent>
              </Card>
              <Card
                id="distribution-platform-panel"
                className="distribution-platform-detail"
                role="tabpanel"
                aria-labelledby={`distribution-platform-${platform}`}
                tabIndex={0}
                aria-busy={busy === "fill"}
              >
                <CardHeader className="distribution-detail-heading">
                  <div className="distribution-detail-title">
                    <PlatformLogo platform={platform} />
                    <div>
                      <h2>{selectedPlatform.name}草稿</h2>
                      <p title={draft.title}>当前稿件：{draft.title || "未命名稿件"}</p>
                    </div>
                  </div>
                  <Badge
                    variant="secondary"
                    className={`distribution-fill-status${platformFill?.status === "filled" ? " is-ready" : platformFill?.status === "failed" ? " is-error" : ""}`}
                    role="status"
                  >
                    {busy === "fill" || targetState === "checking" ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : platformFill?.status === "filled" ? (
                      <CircleCheck aria-hidden="true" />
                    ) : (
                      <Clock aria-hidden="true" />
                    )}
                    {fillStatus}
                  </Badge>
                </CardHeader>
                <CardContent className="distribution-detail-content">
                  <div className="distribution-readiness" role="group" aria-label="稿件准备状态">
                    {[
                      { label: titleReady ? "标题已填写" : "待填写标题", ready: titleReady },
                      { label: bodyReady ? "正文已填写" : "待填写正文", ready: bodyReady },
                      {
                        label:
                          targetState === "editor"
                            ? "编辑页已打开"
                            : targetState === "site"
                              ? "请进入编辑页"
                              : targetState === "checking"
                                ? "检查标签页…"
                                : "待打开编辑器",
                        ready: targetState === "editor",
                      },
                    ].map((item) => (
                      <Badge
                        key={item.label}
                        variant="secondary"
                        className={item.ready ? "is-ready" : ""}
                      >
                        {item.ready ? (
                          <CircleCheck aria-hidden="true" />
                        ) : (
                          <Clock aria-hidden="true" />
                        )}
                        {item.label}
                      </Badge>
                    ))}
                  </div>
                  <div className="distribution-platform-summary">
                    <div className="distribution-summary-item">
                      <Type aria-hidden="true" />
                      <div>
                        <span>标题 · {numberFormatter.format(draft.title.length)} 字符</span>
                        <strong title={draft.title}>{draft.title.trim() || "尚未填写"}</strong>
                      </div>
                      <Badge variant="secondary" className={titleReady ? "is-ready" : "is-pending"}>
                        {titleReady ? "已填写" : "待填写"}
                      </Badge>
                    </div>
                    <div className="distribution-summary-item">
                      <FileText aria-hidden="true" />
                      <div>
                        <span>正文 · {numberFormatter.format(draft.markdown.length)} 字符</span>
                        <strong>
                          {relativeImages
                            ? "有相对路径图片"
                            : bodyReady
                              ? platform === "juejin"
                                ? "Markdown 正文"
                                : "将转换为富文本"
                              : "尚未填写"}
                        </strong>
                      </div>
                      <Badge
                        variant="secondary"
                        className={bodyReady && !relativeImages ? "is-ready" : "is-pending"}
                      >
                        {relativeImages ? "需处理" : bodyReady ? "已填写" : "待填写"}
                      </Badge>
                    </div>
                  </div>
                  <Alert className="distribution-platform-help" role="note">
                    <Info aria-hidden="true" />
                    <AlertDescription>
                      <p>{selectedPlatform.instructions}</p>
                      <p>
                        填入标题和{selectedPlatform.contentLabel}，请在平台检查图片、格式并保存。
                      </p>
                    </AlertDescription>
                  </Alert>
                  {relativeImages && (
                    <Alert variant="destructive">
                      <CircleAlert aria-hidden="true" />
                      <AlertDescription>
                        请将相对路径图片改成可访问的图片 URL，再填稿。
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="distribution-platform-actions">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy !== ""}
                      onClick={() => void openPlatform()}
                    >
                      {busy === "open" ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <ExternalLink aria-hidden="true" />
                      )}
                      打开{selectedPlatform.name}编辑器
                    </Button>
                    <Button
                      type="button"
                      disabled={busy !== "" || !titleReady || !bodyReady || relativeImages}
                      onClick={() => void fillPlatform()}
                    >
                      {busy === "fill" ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Feather aria-hidden="true" />
                      )}
                      {busy === "fill" ? "正在填稿…" : "一键填稿"}
                    </Button>
                  </div>
                  {fillProgress && (
                    <p className="distribution-fill-progress" role="status">
                      <Loader2 className="animate-spin" aria-hidden="true" />
                      {fillProgress}
                    </p>
                  )}
                  {platformFill && busy !== "fill" && (
                    <Alert
                      variant={platformFill.status === "failed" ? "destructive" : "default"}
                      className="distribution-fill-result"
                      role="status"
                    >
                      {platformFill.status === "failed" ? (
                        <CircleAlert aria-hidden="true" />
                      ) : (
                        <CircleCheck aria-hidden="true" />
                      )}
                      <AlertDescription>
                        <p>{platformFill.message}</p>
                        {!!platformFill.warnings?.length && (
                          <ul>
                            {platformFill.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>
        ) : (
          <section className="distribution-editor-workspace" aria-label="编辑母稿">
            <div className="distribution-editor-toolbar">
              <div role="tablist" aria-label="正文视图" onKeyDown={handleViewKeyDown}>
                <button
                  id="distribution-edit-tab"
                  type="button"
                  role="tab"
                  aria-selected={view === "edit"}
                  aria-controls="distribution-edit-panel"
                  tabIndex={view === "edit" ? 0 : -1}
                  onClick={() => changeView("edit")}
                >
                  编辑
                </button>
                <button
                  id="distribution-preview-tab"
                  type="button"
                  role="tab"
                  aria-selected={view === "preview"}
                  aria-controls="distribution-preview-panel"
                  tabIndex={view === "preview" ? 0 : -1}
                  onClick={() => changeView("preview")}
                >
                  预览
                </button>
              </div>
              <div className="distribution-editor-meta">
                <span>{numberFormatter.format(draft.markdown.length)} 字符</span>
                {draft.sourceUrl && (
                  <a href={draft.sourceUrl} target="_blank" rel="noreferrer noopener">
                    查看来源 <ExternalLink aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
            <div className="distribution-editor-scroll">
              <div className="distribution-editor-surface">
                <label className="sr-only" htmlFor="distribution-title">
                  标题
                </label>
                <input
                  id="distribution-title"
                  name="title"
                  autoComplete="off"
                  value={draft.title}
                  onChange={(event) => updateDraft({ title: event.target.value })}
                  maxLength={120}
                  placeholder="输入稿件标题…"
                />
                {view === "edit" ? (
                  <div
                    id="distribution-edit-panel"
                    role="tabpanel"
                    aria-labelledby="distribution-edit-tab"
                    className="distribution-edit-panel"
                  >
                    <label className="sr-only" htmlFor="distribution-markdown">
                      Markdown 正文
                    </label>
                    <textarea
                      id="distribution-markdown"
                      name="markdown"
                      autoComplete="off"
                      value={draft.markdown}
                      onChange={(event) => updateDraft({ markdown: event.target.value })}
                      spellCheck={false}
                      placeholder="开始写作，或粘贴 Markdown…"
                    />
                  </div>
                ) : (
                  <MarkdownPreview html={previewHtml} />
                )}
                {hasRelativeMarkdownImages(draft.markdown) && (
                  <p className="distribution-warning" role="note">
                    <CircleAlert aria-hidden="true" />
                    检测到相对路径图片，请在分发前改成可访问的图片 URL。
                  </p>
                )}
              </div>
            </div>
            <footer className="distribution-editor-footer">
              <span>本地自动保存 · ⌘/Ctrl + S 保存 · ⌘/Ctrl + P 预览</span>
              <div>
                <Button type="button" size="sm" variant="ghost" onClick={() => void copyMarkdown()}>
                  <Clipboard aria-hidden="true" />
                  复制
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => void removeDraft()}>
                  <Trash2 aria-hidden="true" />
                  删除
                </Button>
              </div>
            </footer>
          </section>
        )}
      </main>
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept=".md,.markdown,text/markdown"
        aria-label="导入 Markdown 文件"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void importFile(file);
            setStep("edit");
          }
          event.target.value = "";
        }}
      />
    </div>
  );
}

function MarkdownPreview({ html }: { html: string }) {
  const className = "distribution-preview clipper-markdown";
  // markdown-it runs with html:false, so source HTML cannot become executable preview markup.
  return (
    <article
      id="distribution-preview-panel"
      role="tabpanel"
      aria-labelledby="distribution-preview-tab"
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is rendered from Markdown with raw HTML disabled.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function DistributionMap({
  draft,
  selectedPlatform,
}: {
  draft: DistributionDraft;
  selectedPlatform: PlatformId;
}) {
  return (
    <figure className="distribution-map" aria-labelledby="distribution-map-caption">
      <div className="distribution-map-node is-draft">
        <span className="distribution-document-icon" aria-hidden="true">
          <FileText />
        </span>
        <div>
          <strong title={draft.title}>{draft.title || "未命名稿件"}</strong>
          <small>{numberFormatter.format(draft.markdown.length)} 字符 · Markdown</small>
        </div>
      </div>
      <div className="distribution-map-arrow" aria-hidden="true">
        <span />
        <ChevronRight />
      </div>
      <div className="distribution-map-hub">
        <BrandLogo className="size-8" />
        <div>
          <strong>内容适配</strong>
          <small>格式转换</small>
        </div>
      </div>
      <div className="distribution-map-arrow" aria-hidden="true">
        <span />
        <ChevronRight />
      </div>
      <div className="distribution-map-targets">
        <div className="distribution-map-node is-selected">
          <PlatformLogo platform={selectedPlatform} />
          <div>
            <strong>{getDistributionPlatform(selectedPlatform).name}</strong>
            <small>当前选择 · 填入草稿</small>
          </div>
        </div>
      </div>
      <figcaption id="distribution-map-caption" className="sr-only">
        {draft.title || "未命名稿件"}经过内容适配，将填入
        {getDistributionPlatform(selectedPlatform).name}草稿。
      </figcaption>
    </figure>
  );
}

function PlatformLogo({ platform }: { platform: PlatformId }) {
  const item = getDistributionPlatform(platform);
  return (
    <img
      className="distribution-platform-mark"
      src={item.icon}
      width={34}
      height={34}
      alt={`${item.name} Logo`}
    />
  );
}
