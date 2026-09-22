const state = {
  projects: [],
  project: null,
  capabilities: null,
  view: "home",
  selectedShotId: "",
  selectedTakeId: "",
  search: "",
  generationCount: 2,
  resolution: "720p",
  allowTextOnly: false,
  changeRequest: "",
  saving: false,
  roughItems: [],
  roughIndex: 0,
  assembledUrl: "",
  activeEpisode: 0,
  roughEpisode: 0,
  transitionEpisode: 0,
  transitionFilter: "all",
  assetBatch: { running: false, total: 0, done: 0, failed: 0, current: "" },
  assetSections: {
    character_identity: false,
    scene_identity: false,
    prop_identity: false,
    character_view: false,
    scene_view: false
  },
};

const app = document.querySelector("#app");
const createDialog = document.querySelector("#createDialog");
const createForm = document.querySelector("#createForm");
const deleteDialog = document.querySelector("#deleteDialog");
const deleteForm = document.querySelector("#deleteForm");
const deleteProjectName = document.querySelector("#deleteProjectName");
const roughCutDialog = document.querySelector("#roughCutDialog");
const roughCutContent = document.querySelector("#roughCutContent");
const promptDialog = document.querySelector("#promptDialog");
const promptDialogContent = document.querySelector("#promptDialogContent");
const transitionDialog = document.querySelector("#transitionDialog");
const transitionDialogContent = document.querySelector("#transitionDialogContent");
const sourceImportZone = document.querySelector("#sourceImportZone");
const sourceFileInput = document.querySelector("#sourceFileInput");
const sourceFolderInput = document.querySelector("#sourceFolderInput");
const sourcePathInput = document.querySelector("#sourcePathInput");
const sourceImportStatus = document.querySelector("#sourceImportStatus");
const sourceList = document.querySelector("#sourceList");
const sourcePreview = document.querySelector("#sourcePreview");
const createDialogKicker = document.querySelector("#createDialogKicker");
const createDialogTitle = document.querySelector("#createDialogTitle");
const createDialogDescription = document.querySelector("#createDialogDescription");
const createSubmit = document.querySelector("#createSubmit");
const maxSourceFileBytes = 6 * 1024 * 1024;
let refreshTimer = null;
let sourcePreviewTimer = null;
let importedSources = [];
let createMode = "project";
let lastSourceDescription = "手动输入内容";
let sourceTextDirty = false;
let pendingProjectDelete = null;
const saveTimers = new Map();
const pendingShotChanges = new Map();

const sampleSource = `# 《雾港来信》第一集

## 故事梗概
失踪三年的姐姐突然给林澈寄来一盘旧录像，画面中的港口时钟永远停在凌晨两点十七分。林澈来到废弃灯塔，发现管理员竟和录像里三年前的人一模一样。

## 人物
- 林澈：27岁女性纪录片导演，黑色短发，深灰风衣，冷静但执拗。
- 周默：32岁男性灯塔管理员，旧蓝色工装，寡言，似乎隐藏秘密。

## 场景
- 雾港码头：凌晨，冷蓝雾气，湿润石板路，远处锈蚀吊机。
- 废弃灯塔：旋转铁梯，斑驳白墙，顶部红色信号灯缓慢扫过。

### 镜头 01｜停住的港口钟
- 时长：5秒
- 场景：雾港码头
- 出场角色：林澈
- 画面：冷蓝浓雾中的废弃码头，摄影机贴近湿润地面缓慢前推，林澈的黑色皮靴进入画面，她停在一只锈蚀港口钟下，钟面指向凌晨两点十七分。

### 镜头 02｜录像里的人
- 时长：5秒
- 场景：雾港码头
- 出场角色：林澈、周默
- 画面：林澈举起旧录像机看屏幕，屏幕里三年前的周默站在灯塔门口；焦点从屏幕转到她身后，现实中的周默正沉默地看着她。

### 镜头 03｜灯塔门自行打开
- 时长：5秒
- 场景：废弃灯塔
- 出场角色：林澈、周默
- 画面：灯塔锈蚀铁门在无人触碰时缓慢打开，暖红信号灯从门缝扫过两人的脸，林澈向前一步，周默伸手拦住她，低声说“进去的人，都没有回来”。`;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(name) {
  const paths = {
    projects: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M11 8h6M11 12h6"/>',
    cut: '<path d="M4 7h16M4 17h16M7 4v6M17 14v6"/><circle cx="12" cy="12" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    play: '<path d="m9 7 8 5-8 5V7Z"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    video: '<rect x="3" y="5" width="14" height="14" rx="3"/><path d="m17 10 4-2v8l-4-2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.video}</svg>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

function toast(message, type = "", action = null) {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  const copy = document.createElement("span");
  copy.textContent = message;
  item.append(copy);
  if (action?.label && typeof action.onClick === "function") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await action.onClick(); item.remove(); }
      catch (error) { button.disabled = false; toast(error.message, "error"); }
    });
    item.append(button);
  }
  document.querySelector("#toastRoot").append(item);
  setTimeout(() => item.remove(), action ? 8000 : 3600);
}

function sourceFileAllowed(name = "") {
  return /\.(?:docx|md|markdown|mdown|txt)$/i.test(String(name));
}

function bufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function currentSourceMode() {
  return createForm.elements.sourceMergeMode?.value || "replace";
}

function sourceKey(item) {
  return String(item.path || item.relativePath || item.name || "");
}

function combineSources(items) {
  return items.map((item) => `<!-- 来源：${item.relativePath || item.name} -->\n${String(item.text || "").replace(/^\uFEFF/, "")}`).join("\n\n---\n\n");
}

function setSourceStatus(message, type = "") {
  sourceImportStatus.textContent = message;
  sourceImportStatus.classList.toggle("ready", type === "ready");
  sourceImportStatus.classList.toggle("error", type === "error");
}

function renderSourceList() {
  sourceList.hidden = !importedSources.length;
  sourceList.innerHTML = importedSources.map((item, index) => `<div class="source-list-item">
    <span><strong>${escapeHtml(item.relativePath || item.name)}</strong><small>${Math.max(1, Math.round((item.size || item.text.length) / 1024))} KB · ${item.kind === "path" ? "本机路径" : "已选择"}</small></span>
    <button type="button" data-remove-source="${index}" aria-label="移除 ${escapeHtml(item.name)}" ${sourceTextDirty ? 'disabled title="已手动编辑，请直接在编辑区调整"' : ""}>×</button>
  </div>`).join("");
}

function manifestFromSources() {
  return importedSources.map(({ name, path, relativePath, size, kind }) => ({ name, path: path || "", relativePath: relativePath || name, size: Number(size) || 0, kind }));
}

function applyImportedSources(items, label) {
  const cleanItems = items.filter((item) => String(item.text || "").trim());
  if (!cleanItems.length) throw new Error("没有可导入的文本内容");
  const totalSize = cleanItems.reduce((sum, item) => sum + Number(item.size || item.text.length), 0);
  if (totalSize > maxSourceFileBytes) throw new Error("导入文件总计超过 6MB，请减少文件后再试");
  const mode = currentSourceMode();
  const textarea = createForm.elements.sourceText;
  if (mode === "replace") {
    importedSources = cleanItems;
    textarea.value = combineSources(cleanItems);
  } else {
    const known = new Set(importedSources.map(sourceKey));
    const additions = cleanItems.filter((item) => {
      const key = sourceKey(item);
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
    if (!additions.length) throw new Error("这些文件已经在当前导入列表中");
    importedSources = [...importedSources, ...additions];
    const addition = combineSources(additions);
    textarea.value = [textarea.value.trim(), addition].filter(Boolean).join("\n\n---\n\n");
  }
  sourceTextDirty = false;
  if (createMode === "project" && !createForm.elements.name.value.trim()) {
    createForm.elements.name.value = (cleanItems[0].name || "新短剧").replace(/\.(?:docx|md|markdown|mdown|txt)$/i, "");
  }
  lastSourceDescription = `${label}（${cleanItems.length} 个文件）`;
  setSourceStatus(`${lastSourceDescription} · 正在解析…`, "ready");
  renderSourceList();
  scheduleSourcePreview();
}

async function loadSourceFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  const unsupported = files.filter((file) => !sourceFileAllowed(file.name));
  const valid = files.filter((file) => sourceFileAllowed(file.name));
  if (!valid.length) throw new Error("没有找到 .docx、.md、.markdown、.mdown 或 .txt 文件");
  if (valid.length > 80) throw new Error("一次最多导入 80 个文本文件");
  if (valid.reduce((sum, file) => sum + file.size, 0) > maxSourceFileBytes) throw new Error("导入文件总计超过 6MB，请减少文件后再试");
  const items = await Promise.all(valid.map(async (file) => {
    if (/\.docx$/i.test(file.name)) {
      const data = await api("/api/source-files/upload", {
        method: "POST",
        body: JSON.stringify({ name: file.name, dataBase64: bufferToBase64(await file.arrayBuffer()) })
      });
      return { ...data.files[0], name: file.name, relativePath: file.webkitRelativePath || file.name, size: file.size, kind: "upload" };
    }
    return { name: file.name, relativePath: file.webkitRelativePath || file.name, size: file.size, text: await file.text(), kind: "upload" };
  }));
  applyImportedSources(items, fileList.length > 1 ? "批量文件" : valid[0].name);
  if (unsupported.length) toast(`已跳过 ${unsupported.length} 个不支持的文件`, "error");
}

async function loadSourcePath() {
  const sourcePath = sourcePathInput.value.trim();
  if (!sourcePath) return toast("请先粘贴本地文件或文件夹路径", "error");
  const button = document.querySelector("#loadSourcePath");
  const retained = lastSourceDescription;
  try {
    button.disabled = true;
    button.textContent = "读取中…";
    const data = await api("/api/source-files/read", { method: "POST", body: JSON.stringify({ path: sourcePath }) });
    applyImportedSources(data.files.map((file) => ({ ...file, kind: "path" })), data.name);
  } catch (error) {
    setSourceStatus(`读取失败 · 当前仍保留：${retained}`, "error");
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "读取路径";
  }
}

async function refreshSourcePreview() {
  const text = createForm.elements.sourceText.value.trim();
  if (!text) {
    sourcePreview.hidden = true;
    sourcePreview.innerHTML = "";
    return null;
  }
  try {
    const preview = await api("/api/source/preview", { method: "POST", body: JSON.stringify({ sourceText: text }) });
    const warnings = preview.warnings.length
      ? `<div class="preview-warnings"><strong>${preview.warnings.length} 项需要确认</strong>${preview.warnings.slice(0, 12).map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}${preview.warnings.length > 12 ? `<span>另有 ${preview.warnings.length - 12} 项逐镜提示，创建后可在工作台继续处理。</span>` : ""}</div>`
      : '<div class="preview-ok">未发现明显格式问题</div>';
    const assetGroups = [["character", "人物"], ["scene", "场景"], ["prop", "道具"]].map(([type, label]) => {
      const names = (preview.assets || []).filter((asset) => asset.type === type && asset.role !== "view").map((asset) => asset.name);
      return names.length ? `<span><b>${label}</b>${names.map(escapeHtml).join("、")}</span>` : "";
    }).join("");
    const production = preview.production || {};
    const productionSummary = ["composite", "series_bible"].includes(production.mode)
      ? `<div class="preview-production"><strong>制作清单</strong><span>${production.voices?.length || 0} 配音角色</span><span>${production.bgm?.length || 0} 段 BGM</span><span>${production.sfx?.length || 0} 条音效</span><span>${production.grading?.length || 0} 组调色</span><span>${production.effects?.length || 0} 项特效</span></div>`
      : "";
    const seriesPlan = production.mode === "series_bible"
      ? `<div class="preview-series"><div><strong>${escapeHtml(production.series?.title || "系列完稿")}</strong><span>${production.episodes?.length || 0} 集可执行内容 · ${production.transitions?.length || 0} 个转场关系</span></div><div class="preview-episodes">${(production.episodes || []).map((episode) => `<span><b>第${episode.number}集</b>${escapeHtml(episode.title)}<i>${episode.shotCount} 镜 · ${episode.editDuration}s · ${episode.transitionCount} 转场</i></span>`).join("")}</div></div>`
      : "";
    const healthIssues = preview.importHealth?.issues || [];
    const health = production.mode === "series_bible"
      ? `<div class="preview-health ${preview.requiresConfirmation ? "blocking" : "ready"}"><div><strong>完稿体检</strong><span>${preview.requiresConfirmation ? `${preview.importHealth.blockingIssues.length} 类严重问题，创建前需要确认` : "结构检查通过"}</span></div>${healthIssues.map((issue) => `<p class="${escapeHtml(issue.level)}"><b>${issue.level === "error" ? "阻断" : "提醒"}</b>${escapeHtml(issue.message)}</p>`).join("")}${preview.requiresConfirmation ? '<label class="risk-confirm"><input type="checkbox" name="confirmSourceRisks" />我已查看问题，同意使用系统修复后的提示词和转场分类创建项目</label>' : ""}</div>`
      : "";
    sourcePreview.innerHTML = `<div class="preview-head"><strong>解析预览</strong><span>${preview.shotCount} 镜头 · ${preview.characterCount} 人物 · ${preview.sceneCount} 场景 · ${preview.propCount || 0} 道具</span></div>
      <div class="preview-kb"><span>知识库体检 ${escapeHtml(preview.knowledge.version)}</span><b>平均 ${preview.knowledge.averageScore} 分</b><small>${preview.knowledge.reviewCount} 镜需确认${preview.knowledge.blockedCount ? ` · ${preview.knowledge.blockedCount} 镜缺关键内容` : ""}</small></div>
      ${seriesPlan}
      ${health}
      ${assetGroups ? `<div class="preview-assets">${assetGroups}</div>` : ""}
      ${preview.characterViewCount || preview.sceneViewCount ? `<div class="preview-views">另生成 ${preview.characterViewCount || 0} 个人物逐镜视觉和 ${preview.sceneViewCount || 0} 个场景逐镜视觉，不计入人物/场景基准。</div>` : ""}
      ${productionSummary}
      <div class="preview-shots">${preview.shots.slice(0, 8).map((shot) => `<span><b>${String(shot.no).padStart(2, "0")}</b>${escapeHtml(shot.title || "未命名镜头")}<i>${shot.editDuration || shot.duration}s 剪辑${shot.postOnly ? " · 后期" : ` / ${shot.duration}s 生成`}</i></span>`).join("")}${preview.shots.length > 8 ? `<small>另有 ${preview.shots.length - 8} 个镜头</small>` : ""}</div>${warnings}`;
    sourcePreview.hidden = false;
    setSourceStatus(`${lastSourceDescription} · ${preview.shotCount} 个镜头`, "ready");
    return preview;
  } catch (error) {
    sourcePreview.hidden = false;
    sourcePreview.innerHTML = `<div class="preview-warnings"><strong>无法解析</strong><span>${escapeHtml(error.message)}</span></div>`;
    setSourceStatus("解析失败 · 编辑区内容未被修改", "error");
    return null;
  }
}

function scheduleSourcePreview() {
  clearTimeout(sourcePreviewTimer);
  sourcePreviewTimer = setTimeout(refreshSourcePreview, 260);
}

function resetSourceImport() {
  importedSources = [];
  lastSourceDescription = "手动输入内容";
  sourceTextDirty = false;
  sourcePathInput.value = "";
  sourceFileInput.value = "";
  sourceFolderInput.value = "";
  sourceList.hidden = true;
  sourceList.innerHTML = "";
  sourcePreview.hidden = true;
  sourcePreview.innerHTML = "";
  setSourceStatus("支持多文件 / 文件夹 / 本机路径");
}

function openCreateDialog(mode = "project") {
  createMode = mode;
  createForm.reset();
  resetSourceImport();
  const append = mode === "append";
  document.querySelectorAll("[data-create-only]").forEach((node) => { node.hidden = append; });
  createForm.elements.name.required = !append;
  createDialogKicker.textContent = append ? "IMPORT SHOTS" : "NEW PROJECT";
  createDialogTitle.textContent = append ? "向当前项目追加分镜" : "把制作资料一次放进来";
  createDialogDescription.textContent = append
    ? `导入的新镜头会接在《${state.project?.name || "当前项目"}》末尾，已有镜头和候选不会被修改。`
    : "故事、人物、场景、分镜和提示词可以混合粘贴，系统会先整理成可编辑镜头。";
  createSubmit.textContent = append ? "确认追加分镜" : "创建并准备资产";
  createDialog.showModal();
}

function flattenShots(project = state.project) {
  return (project?.sequences || []).flatMap((sequence) => sequence.shots.map((shot) => ({ ...shot, sequenceName: sequence.name })));
}

function seriesEpisodes(project = state.project) {
  return project?.production?.mode === "series_bible" ? (project.production.episodes || []) : [];
}

function shotEpisodeNumber(shot) {
  return Number(shot?.generationMeta?.episodeNumber || 0);
}

function workspaceShots(project = state.project) {
  const shots = flattenShots(project);
  return state.activeEpisode ? shots.filter((shot) => shotEpisodeNumber(shot) === state.activeEpisode) : shots;
}

function episodeLabel(project = state.project, episodeNumber = state.activeEpisode) {
  if (!episodeNumber) return "全季";
  const episode = seriesEpisodes(project).find((item) => Number(item.number) === Number(episodeNumber));
  return episode?.title && episode.title !== `第${episodeNumber}集` ? `第${episodeNumber}集 · ${episode.title}` : `第${episodeNumber}集`;
}

function renderEpisodeNavigator(project, activeEpisode = state.activeEpisode, attribute = "data-episode-number", includeAll = true) {
  const episodes = seriesEpisodes(project);
  if (!episodes.length) return "";
  const allCount = flattenShots(project).length;
  return `<div class="episode-nav" aria-label="剧集导航">
    ${includeAll ? `<button class="${activeEpisode === 0 ? "active" : ""}" ${attribute}="0"><span>全部</span><small>${allCount}</small></button>` : ""}
    ${episodes.map((episode) => `<button class="${Number(activeEpisode) === Number(episode.number) ? "active" : ""}" ${attribute}="${Number(episode.number)}" title="${escapeHtml(episode.title || `第${episode.number}集`)}"><span>第${Number(episode.number)}集</span><small>${Number(episode.shotCount || 0)}</small></button>`).join("")}
  </div>`;
}

function selectedShot() {
  return flattenShots().find((shot) => shot.id === state.selectedShotId) || flattenShots()[0] || null;
}

function selectedTake(shot = selectedShot()) {
  if (!shot) return null;
  return shot.takes.find((take) => take.id === state.selectedTakeId)
    || shot.takes.find((take) => take.id === shot.preferredTakeId)
    || shot.takes.find((take) => take.status === "succeeded" && !take.rejected)
    || shot.takes[0]
    || null;
}

function preferredTake(shot = selectedShot()) {
  if (!shot?.preferredTakeId) return null;
  return shot.takes.find((take) => take.id === shot.preferredTakeId) || null;
}

function clearActiveProject(projectId = "") {
  if (projectId && state.project?.id !== projectId) return;
  const clearedId = state.project?.id || projectId;
  state.project = null;
  state.selectedShotId = "";
  state.selectedTakeId = "";
  state.roughItems = [];
  state.roughIndex = 0;
  state.assembledUrl = "";
  state.activeEpisode = 0;
  state.roughEpisode = 0;
  state.transitionEpisode = 0;
  state.transitionFilter = "all";
  state.view = "home";
  if (!clearedId || localStorage.getItem("novelcut:lastProject") === clearedId) localStorage.removeItem("novelcut:lastProject");
  localStorage.removeItem("novelcut:lastShot");
  if (roughCutDialog.open) roughCutDialog.close();
  if (transitionDialog.open) transitionDialog.close();
}

async function loadProjects() {
  state.projects = await api("/api/projects");
  if (state.project && !state.projects.some((project) => project.id === state.project.id)) clearActiveProject(state.project.id);
}

function openDeleteProject(projectId, projectName, updatedAt) {
  pendingProjectDelete = { id: projectId, name: projectName, updatedAt };
  deleteProjectName.textContent = `《${projectName}》`;
  deleteDialog.showModal();
}

async function deletePendingProject() {
  if (!pendingProjectDelete) return;
  const project = pendingProjectDelete;
  const submit = deleteForm.querySelector('[type="submit"]');
  try {
    submit.disabled = true;
    submit.textContent = "正在删除…";
    await api(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: "DELETE",
      body: JSON.stringify({ expectedUpdatedAt: project.updatedAt })
    });
    deleteDialog.close();
    pendingProjectDelete = null;
    if (localStorage.getItem("novelcut:lastProject") === project.id) {
      localStorage.removeItem("novelcut:lastProject");
      localStorage.removeItem("novelcut:lastShot");
    }
    await loadProjects();
    render();
    toast(`已删除《${project.name}》`, "", {
      label: "撤销",
      onClick: async () => {
        await api(`/api/projects/${encodeURIComponent(project.id)}/restore`, { method: "POST", body: "{}" });
        await loadProjects();
        render();
        toast(`已恢复《${project.name}》`);
      }
    });
  } catch (error) {
    toast(error.message, "error");
  } finally {
    submit.disabled = false;
    submit.textContent = "删除项目";
  }
}

async function openProject(projectId, preserveSelection = false, destination = "auto") {
  const previousProjectId = state.project?.id || "";
  const previous = preserveSelection ? state.selectedShotId : "";
  state.project = await api(`/api/projects/${encodeURIComponent(projectId)}`);
  state.view = destination === "auto" ? (projectAssetReadiness(state.project).complete ? "workspace" : "assets") : destination;
  const episodes = seriesEpisodes();
  if (previousProjectId !== projectId || !preserveSelection) state.activeEpisode = episodes[0] ? Number(episodes[0].number) : 0;
  if (state.activeEpisode && !episodes.some((episode) => Number(episode.number) === state.activeEpisode)) state.activeEpisode = episodes[0] ? Number(episodes[0].number) : 0;
  if (previousProjectId !== projectId || !preserveSelection) state.roughEpisode = state.activeEpisode;
  const shots = workspaceShots();
  state.selectedShotId = shots.some((shot) => shot.id === previous) ? previous : shots[0]?.id || "";
  const shot = selectedShot();
  if (!shot?.takes.some((take) => take.id === state.selectedTakeId)) state.selectedTakeId = shot?.preferredTakeId || shot?.takes[0]?.id || "";
  state.resolution = state.project.resolution || "720p";
  state.allowTextOnly = false;
  localStorage.setItem("novelcut:lastProject", state.project.id);
  localStorage.setItem("novelcut:lastShot", state.selectedShotId);
  render();
}

async function init() {
  try {
    [state.capabilities] = await Promise.all([api("/api/capabilities"), loadProjects()]);
    const lastProject = localStorage.getItem("novelcut:lastProject");
    if (lastProject && state.projects.some((project) => project.id === lastProject)) {
      await openProject(lastProject);
      const lastShot = localStorage.getItem("novelcut:lastShot");
      const restoredShot = flattenShots().find((shot) => shot.id === lastShot);
      if (restoredShot) {
        if (shotEpisodeNumber(restoredShot)) state.activeEpisode = shotEpisodeNumber(restoredShot);
        state.selectedShotId = lastShot;
        render();
      }
    } else {
      if (lastProject) {
        localStorage.removeItem("novelcut:lastProject");
        localStorage.removeItem("novelcut:lastShot");
      }
      render();
    }
  } catch (error) {
    app.innerHTML = `<div class="home-main"><div class="error-box">无法连接 NovelCut 服务：${escapeHtml(error.message)}</div></div>`;
  }
  refreshTimer = setInterval(refreshActiveProject, 7000);
}

function rail(active = "") {
  const projectUnavailable = !state.project;
  return `<aside class="rail">
    <button class="logo" data-action="home" title="项目列表">NC</button>
    <nav class="rail-nav">
      <button class="rail-button ${active === "assets" ? "active" : ""}" data-action="assets" title="${projectUnavailable ? "先打开一个项目" : "人物与场景资产"}" ${projectUnavailable ? "disabled" : ""}>${icon("layers")}</button>
      <button class="rail-button ${active === "workspace" ? "active" : ""}" data-action="workspace" title="${projectUnavailable ? "先打开一个项目" : "工作台"}" ${projectUnavailable ? "disabled" : ""}>${icon("projects")}</button>
      <button class="rail-button ${active === "cut" ? "active" : ""}" data-action="rough-cut" title="${projectUnavailable ? "先打开一个项目" : "粗剪与导出"}" ${projectUnavailable ? "disabled" : ""}>${icon("cut")}</button>
      <button class="rail-button" data-action="new-project" title="新建项目">${icon("plus")}</button>
    </nav>
    <div class="rail-bottom">
      <button class="rail-button" data-action="capabilities" title="能力状态">${icon("settings")}</button>
    </div>
  </aside>`;
}

function renderHome() {
  const totalShots = state.projects.reduce((sum, project) => sum + Number(project.shotCount || 0), 0);
  const cards = state.projects.map((project, index) => `<article class="project-card">
    <button class="project-card-open" data-project-id="${escapeHtml(project.id)}">
      <span class="project-index">${index === 0 ? "最近编辑" : `项目 ${String(index + 1).padStart(2, "0")}`}</span>
      <strong>${escapeHtml(project.name)}</strong>
      <small>${project.shotCount} 个镜头 · ${escapeHtml(project.aspectRatio)} · ${escapeHtml(project.resolution)}</small>
      <footer><span>${relativeTime(project.updatedAt)}</span><span>打开 →</span></footer>
    </button>
    <button class="project-delete" data-delete-project="${escapeHtml(project.id)}" data-project-name="${escapeHtml(project.name)}" data-project-updated-at="${escapeHtml(project.updatedAt)}" title="删除项目">删除</button>
  </article>`).join("");
  app.innerHTML = `<div class="empty-home">
    ${rail("")}
    <main class="home-main">
      <div class="home-content">
        <header class="project-dashboard-head">
          <div><h1>项目</h1><p>${state.projects.length} 个项目 · ${totalShots} 个镜头</p></div>
          <button class="button primary" data-action="new-project">＋ 新建项目</button>
        </header>
        <div class="project-list">${cards || `<div class="empty-projects"><strong>还没有项目</strong><span>导入分镜资料即可开始制作。</span><button class="button primary" data-action="new-project">创建第一个项目</button></div>`}</div>
      </div>
    </main>
  </div>`;
}

function projectAssetReadiness(project = state.project) {
  const shots = flattenShots(project);
  const requiredIds = new Set(shots.flatMap((shot) => (shot.assetReadiness?.matched || []).map((asset) => asset.id)));
  const required = (project?.assets || []).filter((asset) => requiredIds.has(asset.id));
  const ready = required.filter((asset) => asset.status === "approved" && asset.referenceUrl);
  return {
    required,
    ready,
    missing: required.filter((asset) => !ready.includes(asset)),
    complete: shots.length > 0 && shots.every((shot) => shot.assetReadiness?.ready)
  };
}

function renderAssets() {
  const project = state.project;
  const readiness = projectAssetReadiness(project);
  const activeAssets = project.assets.filter((asset) => asset.status !== "deprecated");
  const missingImages = activeAssets.filter((asset) => !asset.referenceUrl);
  const identityAssets = activeAssets.filter((asset) => asset.role !== "view");
  const viewAssets = activeAssets.filter((asset) => asset.role === "view");
  const characterCount = identityAssets.filter((asset) => asset.type === "character").length;
  const sceneCount = identityAssets.filter((asset) => asset.type === "scene").length;
  const characterViewCount = viewAssets.filter((asset) => asset.type === "character").length;
  const sceneViewCount = viewAssets.filter((asset) => asset.type === "scene").length;
  const propCount = identityAssets.filter((asset) => asset.type === "prop").length;
  const batch = state.assetBatch;
  const batchLabel = batch.running ? `生成中 ${batch.done}/${batch.total} · ${batch.current}` : `一键生成全部缺失（${missingImages.length}）`;
  const groups = [
    { key: "character_identity", type: "character", role: "identity", title: "人物基准", description: "锁定五官、发型、体型和基础服装" },
    { key: "scene_identity", type: "scene", role: "identity", title: "空间基准", description: "锁定空间结构、材质、陈设和主光方向" },
    { key: "prop_identity", type: "prop", role: "identity", title: "道具基准", description: "锁定形态、比例、材质和关键细节" },
    { key: "character_view", type: "character", role: "view", title: "人物逐镜视觉", description: "每个镜头独立的人物角度、姿态、服装状态与受光" },
    { key: "scene_view", type: "scene", role: "view", title: "场景逐镜视觉", description: "每个镜头独立的机位、景别、时间、天气与场景状态" }
  ];
  const cards = groups.map(({ key, type, role, title, description }) => {
    const assets = project.assets.filter((asset) => asset.type === type && (asset.role || "identity") === role && asset.status !== "deprecated");
    if (!assets.length) return "";
    const expanded = Boolean(state.assetSections[key]);
    const approved = assets.filter((asset) => asset.status === "approved" && asset.referenceUrl).length;
    const pending = assets.filter((asset) => asset.referenceUrl && asset.status !== "approved").length;
    const missing = assets.filter((asset) => !asset.referenceUrl).length;
    const grid = expanded ? `<div class="asset-grid">${assets.map((asset) => `<article class="asset-card ${asset.status === "approved" ? "approved" : ""}">
        <div class="asset-image">${asset.referenceUrl ? `<img src="${escapeHtml(asset.referenceUrl)}" alt="${escapeHtml(asset.name)}" />` : `<span>${asset.type === "character" ? "人物" : asset.type === "scene" ? "场景" : "道具"}</span>`}<i>${asset.status === "approved" ? "已批准" : asset.referenceUrl ? "待确认" : "缺参考图"}</i></div>
        <div class="asset-card-body"><div class="asset-name"><strong>${escapeHtml(asset.name)}</strong><small>${asset.role === "view" ? "逐镜视觉" : "基础基准"} · v${asset.version || 1}</small></div>
          <label class="field"><span>设定</span><textarea rows="4" data-asset-field="description" data-asset-id="${escapeHtml(asset.id)}" placeholder="补充不会随镜头改变的外观或空间设定">${escapeHtml(asset.description || "")}</textarea></label>
          <label class="field"><span>别名</span><input data-asset-field="aliases" data-asset-id="${escapeHtml(asset.id)}" value="${escapeHtml((asset.aliases || []).join("、"))}" placeholder="例如：孙悟空、斗战胜佛" /></label>
          <label class="field"><span>生成图补充要求</span><input data-asset-field="prompt" data-asset-id="${escapeHtml(asset.id)}" value="${escapeHtml(asset.prompt || "")}" placeholder="可选，例如：深灰风衣保持不变" /></label>
          <div class="asset-actions">
            <label class="button ghost">上传参考图<input type="file" accept="image/png,image/jpeg,image/webp" data-asset-upload="${escapeHtml(asset.id)}" hidden /></label>
            <button class="button ghost" data-action="generate-asset" data-asset-id="${escapeHtml(asset.id)}" ${state.capabilities?.imageGenerator?.available && !batch.running ? "" : "disabled"}>${asset.referenceUrl ? "重新生成" : "AI 生成"}</button>
            <button class="button ${asset.status === "approved" ? "primary" : ""}" data-action="approve-asset" data-asset-id="${escapeHtml(asset.id)}" ${asset.referenceUrl ? "" : "disabled"}>${asset.status === "approved" ? "已批准" : "确认使用"}</button>
          </div>
          ${!state.capabilities?.imageGenerator?.available ? '<p class="asset-note">图片模型未配置；可直接上传你已有的定妆图或场景图。</p>' : ""}
        </div>
      </article>`).join("")}</div>` : "";
    return `<section class="asset-group ${expanded ? "expanded" : "collapsed"}">
      <button class="asset-group-toggle" type="button" data-action="toggle-asset-group" data-group-key="${key}" aria-expanded="${expanded}">
        <span class="asset-group-chevron">›</span>
        <span class="asset-group-title"><strong>${title}</strong><small>${description}</small></span>
        <span class="asset-group-stats"><b>${assets.length} 项</b><i class="missing">${missing} 缺图</i><i>${pending} 待确认</i><i class="ready">${approved} 已批准</i></span>
      </button>
      ${grid}
    </section>`;
  }).join("");
  app.innerHTML = `<div class="app-shell">
    ${rail("assets")}
    <main class="assets-workspace">
      <header class="assets-topbar"><div><span class="kicker">STEP 2 / 3</span><h1>人物与场景资产</h1><p>分镜已经解析。先生成并确认跨镜复用的参考图，再进入镜头生成。</p></div><div class="asset-progress"><b>${readiness.ready.length}/${readiness.required.length}</b><span>关键资产已批准</span></div><div class="asset-top-actions"><button class="button ghost" data-action="reparse-assets" ${batch.running ? "disabled" : ""}>重新识别</button><button class="button batch-generate" data-action="generate-all-assets" ${state.capabilities?.imageGenerator?.available && missingImages.length && !batch.running ? "" : "disabled"} title="只生成尚无参考图的资产；生成后仍需逐张确认">${batch.running ? '<span class="spinner"></span>' : "✦"} ${escapeHtml(batchLabel)}</button><button class="button primary" data-action="enter-workspace">${readiness.complete ? "进入镜头生成" : "查看分镜（生成将受限）"}</button></div></header>
      <div class="workflow-steps"><span class="done">1 分镜解析 ✓</span><span class="active">2 资产准备</span><span>3 镜头生成与抽卡</span></div>
      <div class="asset-audit"><span><b>${characterCount}</b> 人物基准</span><span><b>${sceneCount}</b> 空间基准</span><span><b>${characterViewCount}</b> 人物逐镜视觉</span><span><b>${sceneViewCount}</b> 场景逐镜视觉</span><span><b>${propCount}</b> 道具基准</span><small>资产数量不设上限：先用基础图锁定身份与空间，再按每个镜头的机位、角度、服装状态、光线和场景状态生成独立视觉参考。</small></div>
      ${batch.running ? `<div class="batch-progress"><i style="width:${Math.round((batch.done / Math.max(1, batch.total)) * 100)}%"></i><span>${escapeHtml(batch.current)}${batch.failed ? ` · ${batch.failed} 个失败将保留为缺失，可再次重试` : ""}</span></div>` : ""}
      <div class="assets-content">
        <div class="asset-section-tools"><div><strong>资产分类</strong><span>点击分类展开；折叠状态会在数据刷新时保留</span></div><div><button class="button ghost compact" data-action="expand-asset-groups">全部展开</button><button class="button ghost compact" data-action="collapse-asset-groups">全部收起</button></div></div>
        ${cards || '<div class="empty-projects"><strong>没有识别到人物、场景或关键道具资产</strong><span>请回到分镜资料中补充角色表、场景表和关键道具。</span></div>'}
      </div>
    </main>
  </div>`;
}

function renderWorkspace() {
  const project = state.project;
  const shot = selectedShot();
  const take = selectedTake(shot);
  const shots = workspaceShots();
  const activeJobs = flattenShots().flatMap((item) => item.takes).filter((item) => ["queued", "submitting", "submitted", "processing"].includes(item.status)).length;
  const transitions = project.production?.transitions || [];
  app.innerHTML = `<div class="app-shell">
    ${rail("workspace")}
    <main class="workspace">
      <header class="topbar">
        <div class="project-switcher">
          <div class="project-title"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(episodeLabel())} · ${shots.length} 个镜头 · ${countReady(shots)} 个可用</span></div>
        </div>
        <div class="spacer"></div>
        <span class="autosave"><i></i>${state.saving ? "保存中…" : "已保存"}</span>
        ${activeJobs ? `<button class="task-pill" data-action="show-tasks"><span class="spinner"></span><b>${activeJobs}</b> 进行中</button>` : ""}
        ${transitions.length ? `<button class="button ghost compact transition-queue-button" data-action="transitions">转场清单 <b>${transitions.length}</b></button>` : ""}
        <button class="button primary compact" data-action="next-action">${nextActionLabel(shots)}</button>
      </header>
      <section class="studio">
        ${renderShotPanel(project, shot)}
        ${renderStage(project, shot, take)}
        ${renderInspector(project, shot, take)}
      </section>
      ${renderTimeline(shots, shot)}
    </main>
  </div>`;
}

function renderShotPanel(project, activeShot) {
  const search = state.search.trim().toLowerCase();
  const groups = project.sequences.map((sequence) => {
    const shots = sequence.shots.filter((shot) => (!state.activeEpisode || shotEpisodeNumber(shot) === state.activeEpisode)
      && (!search || `${shot.no}${shot.title}${shot.prompt}${shot.scene}${shot.characters}`.toLowerCase().includes(search)));
    if (!shots.length) return "";
    return `<section class="sequence">
      <div class="sequence-head"><span>S${String(sequence.sortOrder + 1).padStart(2, "0")}</span><span>${escapeHtml(sequence.name)}</span></div>
      ${shots.map((shot) => `<button class="shot-item ${shot.id === activeShot?.id ? "active" : ""}" data-shot-id="${escapeHtml(shot.id)}">
        <span class="shot-number">${String(shot.no).padStart(2, "0")}</span>
        <span class="shot-copy"><strong>${escapeHtml(shot.title)}</strong><small>${escapeHtml(shot.scene || shot.characters || `${shot.duration} 秒`)}</small></span>
        <i class="status-dot ${escapeHtml(shot.status)}"></i>
      </button>`).join("")}
    </section>`;
  }).join("");
  return `<aside class="shot-panel">
    <div class="panel-head"><h2>分镜</h2><span class="count">${workspaceShots(project).length}</span><span class="spacer"></span><button class="icon-button" data-action="append-shots" title="向当前项目追加分镜">+</button></div>
    <div class="shot-filters">${renderEpisodeNavigator(project)}<label class="search">${icon("search")}<input id="shotSearch" value="${escapeHtml(state.search)}" placeholder="搜索当前范围" /></label></div>
    <div class="shot-tree">${groups || '<div class="hint" style="padding:20px">没有匹配的镜头</div>'}</div>
  </aside>`;
}

function renderStage(project, shot, take) {
  if (!shot) return `<section class="stage"><div class="viewer"><div class="error-box">项目里还没有镜头。</div></div></section>`;
  const aspectClass = project.aspectRatio === "16:9" ? "landscape" : "";
  const video = take?.status === "succeeded" && take.videoUrl
    ? `<video src="${escapeHtml(take.videoUrl)}" controls playsinline></video>`
    : `<div class="empty-frame ${shot.postOnly ? "post-frame" : ""}"><span class="frame-no">${String(shot.no).padStart(2, "0")}</span><div><div class="empty-icon">${take && take.status !== "failed" ? '<span class="spinner" style="width:24px;height:24px"></span>' : icon("video")}</div><h3>${shot.postOnly ? "等待制作后期字幕卡" : take ? statusLabel(take.status) : "等待生成第一条候选"}</h3><p>${take?.error ? escapeHtml(take.error) : shot.postOnly ? "这个镜头由本机 FFmpeg 制作，不会调用 Seedance 或消耗生成额度。" : "当前镜头准备完成后，点击右侧生成。生成结果会自动出现在这里。"}</p></div></div>`;
  return `<section class="stage">
    <div class="viewer">
      <div class="viewer-tools"><span class="viewer-chip">${escapeHtml(project.aspectRatio)}</span><span class="viewer-chip">剪辑 ${shot.editDuration || shot.duration}s</span><span class="viewer-chip">${shot.postOnly ? "本地后期" : `${shot.duration}s · ${escapeHtml(state.resolution)}`}</span></div>
      <div class="video-shell ${aspectClass}">${video}<div class="shot-caption"><strong>${String(shot.no).padStart(2,"0")} · ${escapeHtml(shot.title)}</strong><span>${escapeHtml(shot.sequenceName)} · ${escapeHtml(shot.scene || "未指定场景")}</span></div></div>
    </div>
    <div class="takes">
      ${shot.takes.map((item) => renderTakeCard(item, shot)).join("")}
      ${shot.postOnly ? "" : '<button class="take-add" data-action="focus-generate">＋<br>再抽一组</button>'}
    </div>
  </section>`;
}

function renderTakeCard(take, shot) {
  const preview = take.status === "succeeded" && take.videoUrl
    ? `<video class="take-preview" src="${escapeHtml(take.videoUrl)}" muted preload="metadata"></video>`
    : `<div class="take-loading">${take.status !== "failed" ? '<span class="spinner" style="width:18px;height:18px"></span>' : "!"}<span>${statusLabel(take.status)}</span></div>`;
  return `<button class="take-card ${take.id === state.selectedTakeId ? "active" : ""} ${take.id === shot.preferredTakeId ? "preferred" : ""}" data-take-id="${escapeHtml(take.id)}">
    ${preview}<span class="take-label">TAKE ${String(take.no).padStart(2, "0")}${take.resolution ? ` · ${escapeHtml(take.resolution)}` : ""}</span>${take.approved ? '<span class="take-state">✓</span>' : ""}
  </button>`;
}

function productionTargetIncludes(value, shotNo) {
  const text = String(value || "");
  const range = text.match(/镜?\s*(\d+)\s*[-–—~至]\s*(\d+)/);
  if (range) return Number(shotNo) >= Number(range[1]) && Number(shotNo) <= Number(range[2]);
  return [...text.matchAll(/镜?\s*(\d+)/g)].some((match) => Number(match[1]) === Number(shotNo));
}

function renderShotProduction(project, shot) {
  const production = project.production || {};
  if (production.mode === "series_bible") {
    const sourceShotId = String(shot.generationMeta?.sourceShotId || "");
    const episodeNumber = shotEpisodeNumber(shot);
    const transitions = (production.transitions || []).filter((item) => Number(item.episodeNumber) === episodeNumber
      && [item.fromShot, item.toShot].some((value) => String(value || "") === sourceShotId));
    if (!transitions.length) return "";
    const executionLabels = { generate: "生成空镜", edit: "剪辑衔接", audio: "声音桥", local_effect: "本地特效" };
    return `<details class="inspector-section compact-details production-plan" open>
      <summary><span>相邻转场</span><small>${transitions.length} 项</small></summary>
      <div class="production-rows">${transitions.map((item) => `<span><b>${escapeHtml(String(item.fromShot || "") === sourceShotId ? "镜后" : "镜前")}</b>${escapeHtml(item.title || item.method || item.type || "转场")}<small>${escapeHtml(executionLabels[item.execution] || item.execution || "剪辑衔接")} · ${escapeHtml(item.fromShot || "片头")} → ${escapeHtml(item.toShot || "片尾")}</small></span>`).join("")}</div>
      <button class="button ghost compact production-open-transitions" data-action="transitions">打开本集转场清单</button>
    </details>`;
  }
  if (production.mode !== "composite") return "";
  const bgm = (production.bgm || []).filter((item) => Number(shot.no) >= Number(item.shotStart) && Number(shot.no) <= Number(item.shotEnd));
  const sfx = (production.sfx || []).filter((item) => Number(item.shotNo) === Number(shot.no));
  const grading = (production.grading || []).filter((item) => productionTargetIncludes(item.target, shot.no));
  const voices = (production.voiceLines || []).filter((item) => Number(item.shotNo) === Number(shot.no));
  const rows = [
    ...voices.map((item) => `<span><b>配音</b>${escapeHtml(item.dialect || item.standard)}${item.dialect && item.standard && item.dialect !== item.standard ? `<small>${escapeHtml(item.standard)}</small>` : ""}</span>`),
    ...bgm.map((item) => `<span><b>BGM</b>${escapeHtml(item.style)}<small>${escapeHtml(item.time || item.source || "")}</small></span>`),
    ...sfx.map((item) => `<span><b>音效</b>${escapeHtml(item.description)}</span>`),
    ...grading.map((item) => `<span><b>调色</b>${escapeHtml([item.primary, item.secondary].filter(Boolean).join(" · "))}<small>${escapeHtml(item.target)}</small></span>`)
  ];
  return `<details class="inspector-section compact-details production-plan" ${shot.postOnly ? "open" : ""}>
    <summary><span>本镜后期清单</span><small>${rows.length} 项</small></summary>
    <div class="production-rows">${rows.length ? rows.join("") : '<span class="hint">这份制作包没有为本镜指定单独的配音、音乐、音效或调色。</span>'}</div>
  </details>`;
}

function renderInspector(project, shot, take) {
  if (!shot) return `<aside class="inspector"></aside>`;
  const productionPanel = renderShotProduction(project, shot);
  if (shot.postOnly) {
    const titleCardStyle = {
      backgroundColor: "#090b0e",
      titleColor: "#db3029",
      bodyColor: "#f5f5f5",
      captionColor: "#a6a6a6",
      alignment: "center",
      titleScale: "standard",
      ...(shot.generationMeta?.titleCard || {})
    };
    return `<aside class="inspector">
      <div class="panel-head"><h2>后期镜头</h2></div>
      <section class="inspector-section post-production-editor">
        <div class="post-only-badge">不调用 Seedance</div>
        <label class="field"><span>镜头标题</span><input data-shot-field="title" value="${escapeHtml(shot.title)}" /></label>
        <label class="field"><span>剪辑时长</span><input type="number" min="1" max="60" step="0.5" data-shot-field="editDuration" value="${escapeHtml(shot.editDuration || shot.duration)}" /></label>
        <label class="field"><span>字幕卡内容</span><textarea data-shot-field="prompt">${escapeHtml(shot.prompt)}</textarea></label>
        <details class="compact-details title-card-settings" open>
          <summary><span>字幕卡样式</span><small>本地渲染</small></summary>
          <div class="title-card-style-grid">
            <label class="field color-field"><span>背景</span><input type="color" data-title-card-style="backgroundColor" value="${escapeHtml(titleCardStyle.backgroundColor)}" /></label>
            <label class="field color-field"><span>主标题</span><input type="color" data-title-card-style="titleColor" value="${escapeHtml(titleCardStyle.titleColor)}" /></label>
            <label class="field color-field"><span>副标题</span><input type="color" data-title-card-style="bodyColor" value="${escapeHtml(titleCardStyle.bodyColor)}" /></label>
            <label class="field color-field"><span>底部文字</span><input type="color" data-title-card-style="captionColor" value="${escapeHtml(titleCardStyle.captionColor)}" /></label>
            <label class="field"><span>对齐</span><select data-title-card-style="alignment"><option value="center" ${titleCardStyle.alignment === "center" ? "selected" : ""}>居中</option><option value="left" ${titleCardStyle.alignment === "left" ? "selected" : ""}>左对齐</option></select></label>
            <label class="field"><span>标题字号</span><select data-title-card-style="titleScale"><option value="compact" ${titleCardStyle.titleScale === "compact" ? "selected" : ""}>紧凑</option><option value="standard" ${titleCardStyle.titleScale === "standard" ? "selected" : ""}>标准</option><option value="large" ${titleCardStyle.titleScale === "large" ? "selected" : ""}>大标题</option></select></label>
          </div>
        </details>
        <button class="button primary" data-action="render-post" ${state.capabilities?.ffmpeg?.available ? "" : "disabled"}>${take ? "重新制作字幕卡" : "制作字幕卡"}</button>
        <p class="hint">按当前颜色、对齐与字号制作文字视频并自动设为主选；不消耗生成额度。</p>
      </section>
      ${productionPanel}
      ${take ? `<section class="inspector-section"><div class="section-title"><h3>当前后期版本</h3><span class="spacer"></span><span class="hint">TAKE ${String(take.no).padStart(2,"0")}</span></div><p class="hint">${escapeHtml(take.changeRequest || "本地后期字幕卡")}</p></section>` : ""}
    </aside>`;
  }
  const bindings = shot.assetReadiness?.bindings || { mode: "auto", characterIds: [], sceneId: "", propIds: [] };
  // 使用后端已排好的顺序：人物 → 场景 → 道具，与实际提交给模型的参考图顺序一致。
  const assets = shot.assetReadiness?.matched || [];
  const characterAssets = project.assets.filter((asset) => asset.type === "character" && asset.status !== "deprecated");
  const sceneAssets = project.assets.filter((asset) => asset.type === "scene" && asset.status !== "deprecated");
  const propAssets = project.assets.filter((asset) => asset.type === "prop" && asset.status !== "deprecated");
  const assetReady = Boolean(shot.assetReadiness?.ready);
  const activeStatuses = ["queued", "submitting", "submitted", "processing"];
  const hasActiveJob = shot.takes.some((item) => activeStatuses.includes(item.status));
  const generateDisabled = !state.capabilities?.seedance?.available || hasActiveJob || (!assetReady && !state.allowTextOnly);
  const mainTake = preferredTake(shot);
  const existing1080 = shot.takes.find((item) => item.status === "succeeded" && !item.rejected && item.resolution === "1080p");
  const canUpgradeModel = state.capabilities?.seedance?.resolutions?.includes("1080p");
  const upgradeDisabled = !mainTake || mainTake.status !== "succeeded" || hasActiveJob || !state.capabilities?.seedance?.available || !canUpgradeModel || Boolean(existing1080);
  const upgradeLabel = !mainTake
    ? "先设为主选"
    : existing1080
      ? "已有 1080p 候选"
      : hasActiveJob
        ? "生成任务进行中"
        : !canUpgradeModel
          ? "当前模型不支持 1080p"
          : "生成 1080p 定稿";
  const review = shot.promptReview || { score: 0, status: "review", detected: {}, issues: [] };
  const reviewLabel = review.status === "ready" ? "可直接生成" : review.status === "blocked" ? "缺少关键内容" : "建议确认";
  const reviewTags = [review.detected?.primaryRecipe, review.detected?.shotSize, review.detected?.angle, review.detected?.camera, ...(review.detected?.patterns || [])].filter(Boolean);
  return `<aside class="inspector">
    <div class="panel-head"><h2>镜头设置</h2></div>
    <section class="inspector-section">
      <label class="field"><span>镜头标题</span><input data-shot-field="title" value="${escapeHtml(shot.title)}" /></label>
      <div class="field-row">
        <label class="field"><span>生成时长</span><select data-shot-field="duration">${[5,10,15].map((value) => `<option value="${value}" ${shot.duration === value ? "selected" : ""}>${value} 秒</option>`).join("")}</select></label>
        <label class="field"><span>剪辑时长</span><input type="number" min="0.5" max="60" step="0.5" data-shot-field="editDuration" value="${escapeHtml(shot.editDuration || shot.duration)}" /></label>
      </div>
      <div class="field-row">
        <label class="field"><span>场景</span><input data-shot-field="scene" value="${escapeHtml(shot.scene)}" placeholder="当前场景" /></label>
      </div>
      <label class="field"><span>出场角色</span><input data-shot-field="characters" value="${escapeHtml(shot.characters)}" placeholder="角色之间用、分隔" /></label>
      <label class="field"><span>镜头内容与提示词</span><textarea data-shot-field="prompt">${escapeHtml(shot.prompt)}</textarea></label>
      <div class="prompt-review ${escapeHtml(review.status)}">
        <div class="prompt-review-head"><span>知识库体检</span><b>${review.score} 分 · ${reviewLabel}</b></div>
        ${reviewTags.length ? `<div class="prompt-review-tags">${reviewTags.slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        ${review.issues?.length ? `<div class="prompt-review-issues">${review.issues.slice(0, 3).map((issue) => `<span class="${escapeHtml(issue.level)}">${escapeHtml(issue.message)}</span>`).join("")}</div>` : '<p>主体、动作、场景与镜头信息完整。</p>'}
        <button type="button" class="button ghost prompt-preview-button" data-action="preview-prompt">查看实际生成提示词</button>
      </div>
    </section>
    <section class="inspector-section">
      <div class="section-title"><h3>本镜资产</h3><span class="spacer"></span><span class="hint">${bindings.mode === "manual" ? "手动关联" : "自动识别"} · ${assetReady ? "已就绪" : "未完成"}</span></div>
      <div class="asset-chips">${assets.length ? assets.map((asset) => `<span class="asset-chip ${asset.status === "approved" && asset.referenceUrl ? "ready" : ""}"><i></i>${escapeHtml(asset.name)}${asset.status === "approved" && asset.referenceUrl ? " ✓" : " !"}</span>`).join("") : '<span class="hint">当前镜头没有匹配到人物或场景资产。</span>'}</div>
      ${!assetReady ? `<div class="asset-gate"><span>缺少已批准参考图：${escapeHtml(shot.assetReadiness?.missing?.join("、") || "人物/场景")}</span><button class="button ghost compact" data-action="assets">去准备资产</button></div>` : ""}
      ${shot.assetReadiness?.ignored?.length ? `<p class="asset-ignored">不作为跨镜资产：${escapeHtml(shot.assetReadiness.ignored.map((item) => item.name).join("、"))}（群演/临时主体）</p>` : ""}
      <details class="shot-binding-editor">
        <summary>调整本镜关联</summary>
        <div class="binding-editor-body">
          <span class="binding-label">人物（可多选）</span>
          <div class="binding-options">${characterAssets.map((asset) => `<label><input type="checkbox" data-binding-character value="${escapeHtml(asset.id)}" ${(bindings.characterIds || []).includes(asset.id) ? "checked" : ""} /><span>${escapeHtml(asset.name)}</span></label>`).join("") || '<span class="hint">暂无人物资产</span>'}</div>
          <label class="field"><span>场景（单选）</span><select data-binding-scene><option value="">不关联场景</option>${sceneAssets.map((asset) => `<option value="${escapeHtml(asset.id)}" ${bindings.sceneId === asset.id ? "selected" : ""}>${escapeHtml(asset.name)}</option>`).join("")}</select></label>
          ${propAssets.length ? `<span class="binding-label">道具（可多选）</span><div class="binding-options">${propAssets.map((asset) => `<label><input type="checkbox" data-binding-prop value="${escapeHtml(asset.id)}" ${(bindings.propIds || []).includes(asset.id) ? "checked" : ""} /><span>${escapeHtml(asset.name)}</span></label>`).join("")}</div>` : ""}
          <div class="binding-actions"><button class="button ghost compact" data-action="auto-bindings">重新自动识别</button><button class="button primary compact" data-action="save-bindings">保存手动关联</button></div>
          <p class="hint">保存后记录的是资产 ID；即使资产改名，本镜仍然关联同一资产。</p>
        </div>
      </details>
    </section>
    ${project.sourceManifest?.length ? `<details class="inspector-section compact-details">
      <summary><span>资料来源</span><small>${project.sourceManifest.length} 个文件</small></summary>
      <div class="source-records">${project.sourceManifest.slice(-4).map((item) => `<span title="${escapeHtml(item.path || item.relativePath || item.name)}">${escapeHtml(item.relativePath || item.name)}</span>`).join("")}</div>
      <p class="hint">来源只用于追溯；本机文件变化不会自动覆盖当前项目。</p>
    </details>` : ""}
    ${productionPanel}
    <section class="inspector-section" id="generateSection">
      <div class="section-title"><h3>快速生成</h3><span class="spacer"></span><span class="hint">知识库增强 · Seedance 2.0</span></div>
      <label class="field"><span>这次想改什么</span><textarea id="changeRequest" rows="3" placeholder="例如：表情更克制，推镜再慢一点，其他保持不变">${escapeHtml(state.changeRequest)}</textarea></label>
      <div class="field-row">
        <div class="field"><span>候选数量</span><div class="segmented">${[1,2,4].map((value) => `<button class="${state.generationCount === value ? "active" : ""}" data-count="${value}">${value} 个</button>`).join("")}</div></div>
        <label class="field"><span>清晰度</span><select id="resolutionSelect"><option value="720p" ${state.resolution === "720p" ? "selected" : ""}>720p 快速</option><option value="1080p" ${state.resolution === "1080p" ? "selected" : ""}>1080p</option></select></label>
      </div>
      ${!state.capabilities?.seedance?.available ? '<div class="error-box" style="margin-top:12px">未配置 Seedance Key，可以继续编辑项目，但暂时不能提交视频。</div>' : ""}
      ${!assetReady ? `<label class="text-only-switch"><input id="allowTextOnly" type="checkbox" ${state.allowTextOnly ? "checked" : ""} /><span><b>仅做纯文本试片</b><small>不使用人物/场景参考图，一致性风险高，默认关闭。</small></span></label>` : ""}
      <div class="generate-actions"><button class="button primary" data-action="generate" ${generateDisabled ? "disabled" : ""}>${state.changeRequest.trim() ? "按修改生成" : shot.takes.length ? "再抽一组" : "生成当前镜头"}</button><button class="button" data-action="generate-next" title="生成后进入下一镜" ${generateDisabled ? "disabled" : ""}>生成并下一镜</button></div>
      <p class="hint">提交后可继续处理其他镜头，任务会在后台自动查询和下载。</p>
    </section>
    ${mainTake ? `<section class="inspector-section delivery-upgrade">
      <div class="section-title"><h3>主选定稿</h3><span class="spacer"></span><span class="quality-badge">1080p</span></div>
      <p class="upgrade-copy">以 TAKE ${String(mainTake.no).padStart(2,"0")} 的提示词和镜头设定重新生成 1 个 1080p 候选。</p>
      <button class="button upgrade-button" data-action="upgrade-1080" ${upgradeDisabled ? "disabled" : ""}>${upgradeLabel}</button>
      <p class="hint">这是高分辨率重新生成，不是无损放大；原主选会保留，完成后对比并手动切换。</p>
    </section>` : ""}
    ${take ? `<section class="inspector-section"><div class="section-title"><h3>当前候选</h3><span class="spacer"></span><span class="hint">TAKE ${String(take.no).padStart(2,"0")}</span></div>
      <div class="take-actions"><button class="button ${take.approved ? "primary" : ""}" data-action="approve-take" ${take.status !== "succeeded" ? "disabled" : ""}>${take.approved ? "已通过" : "质量通过"}</button><button class="button ${shot.preferredTakeId === take.id ? "primary" : ""}" data-action="prefer-take" ${take.status !== "succeeded" ? "disabled" : ""}>${shot.preferredTakeId === take.id ? "当前主选" : "设为主选"}</button><button class="button danger" data-action="reject-take" ${take.status === "failed" ? "disabled" : ""}>淘汰</button></div>
      ${take.error ? `<div class="error-box" style="margin-top:10px">${escapeHtml(take.error)}</div>` : ""}
      <p class="hint">${escapeHtml(take.changeRequest || "原始镜头生成")}</p>
    </section>` : ""}
  </aside>`;
}

function renderTimeline(shots, activeShot) {
  const total = shots.reduce((sum, shot) => sum + Number(shot.editDuration || shot.duration || 0), 0);
  return `<section class="timeline"><div class="timeline-head"><strong>实时粗剪</strong><span>${formatDuration(total)}</span><span>·</span><span>${countReady(shots)}/${shots.length} 可播放</span><span class="spacer"></span><button class="button ghost compact" data-action="rough-cut">打开粗剪</button></div><div class="timeline-track">
    ${shots.map((shot) => `<button class="timeline-shot ${shot.id === activeShot?.id ? "active" : ""} ${shot.takes.some((take) => take.status === "succeeded") ? "has-video" : ""} ${shot.postOnly ? "post-only" : ""}" data-shot-id="${escapeHtml(shot.id)}" style="width:${Math.max(72, Number(shot.editDuration || shot.duration) * 13)}px"><span>${String(shot.no).padStart(2,"0")} · ${shot.editDuration || shot.duration}s${shot.postOnly ? " · 后期" : ""}</span><strong>${escapeHtml(shot.title)}</strong><i></i></button>`).join("")}
  </div></section>`;
}

async function openPromptPreview() {
  const shot = selectedShot();
  if (!shot) return;
  try {
    await flushShotInputs(shot);
    const query = state.changeRequest.trim() ? `?changeRequest=${encodeURIComponent(state.changeRequest.trim())}` : "";
    const data = await api(`/api/shots/${encodeURIComponent(shot.id)}/prompt-preview${query}`);
    const tags = [data.review.detected?.primaryRecipe, data.review.detected?.shotSize, data.review.detected?.angle, data.review.detected?.camera, ...(data.review.detected?.patterns || [])].filter(Boolean);
    promptDialogContent.innerHTML = `<header class="modal-head"><div><span class="kicker">PROMPT COMPILER</span><h2>实际生成提示词</h2><p>知识库 ${escapeHtml(data.knowledgeVersion)} · 原分镜不会被改写</p></div><button class="icon-button" data-action="close-prompt" aria-label="关闭">×</button></header>
      <div class="prompt-preview-body">
        <div class="prompt-preview-meta"><b>${data.review.score} 分</b>${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="prompt-asset-summary ${data.blocked ? "blocked" : "ready"}">${data.blocked ? `尚未绑定完整参考图：${escapeHtml(data.assetReadiness?.missing?.join("、") || "人物/场景")}` : `已绑定 ${data.referenceAssets?.length || 0} 张已批准参考图`}</div>
        ${data.submissionPlan?.referenceImages?.length ? `<div class="reference-plan">${data.submissionPlan.referenceImages.map((item) => `<span><b>图片${item.position}</b>${item.type === "character" ? "人物" : item.type === "scene" ? "场景" : "道具"}·${escapeHtml(item.name)}·v${item.version}</span>`).join("")}</div>` : ""}
        <pre>${escapeHtml(data.prompt)}</pre>
        <p>这是提交给 Seedance 的完整文本；已批准的人物和场景图会作为独立参考图同时提交。原始分镜不改写，知识库只补齐执行、时序和约束。</p>
      </div>
      <footer class="modal-actions"><span class="spacer"></span><button class="button primary" data-action="close-prompt">知道了</button></footer>`;
    promptDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("参考图读取失败"));
    reader.readAsDataURL(file);
  });
}

async function uploadAssetReference(assetId, file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return toast("参考图不能超过 8MB", "error");
  try {
    toast("正在保存参考图…");
    const dataUrl = await fileAsDataUrl(file);
    await api(`/api/assets/${encodeURIComponent(assetId)}/reference`, { method: "POST", body: JSON.stringify({ dataUrl, name: file.name }) });
    await openProject(state.project.id, false, "assets");
    toast("参考图已保存，请确认后锁定使用");
  } catch (error) { toast(error.message, "error"); }
}

async function updateAsset(assetId, field, value) {
  try {
    await api(`/api/assets/${encodeURIComponent(assetId)}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) });
    const asset = state.project.assets.find((item) => item.id === assetId);
    if (asset) asset[field] = value;
  } catch (error) { toast(error.message, "error"); }
}

async function generateAsset(assetId) {
  try {
    const button = document.querySelector(`[data-action="generate-asset"][data-asset-id="${CSS.escape(assetId)}"]`);
    if (button) { button.disabled = true; button.textContent = "生成中…"; }
    await api(`/api/assets/${encodeURIComponent(assetId)}/generate`, { method: "POST", body: "{}" });
    await openProject(state.project.id, false, "assets");
    toast("参考图已生成，请检查后点击确认使用");
  } catch (error) { toast(error.message, "error"); render(); }
}

async function generateAllAssets() {
  if (state.assetBatch.running || !state.project) return;
  const targets = state.project.assets
    .filter((asset) => asset.status !== "deprecated" && !asset.referenceUrl)
    .sort((left, right) => Number(left.role === "view") - Number(right.role === "view"));
  if (!targets.length) return toast("所有资产都已经有参考图");
  if (!window.confirm(`将调用 ${state.capabilities?.imageGenerator?.model || "Seedream"} 依次生成 ${targets.length} 张缺失资产图。基础图会先生成，逐镜视觉图会继承基础图；生成会产生模型费用。是否继续？`)) return;
  state.assetBatch = { running: true, total: targets.length, done: 0, failed: 0, current: targets[0].name };
  render();
  const failures = [];
  try {
    for (const asset of targets) {
      state.assetBatch.current = `正在生成：${asset.name}`;
      render();
      try {
        const generated = await api(`/api/assets/${encodeURIComponent(asset.id)}/generate`, { method: "POST", body: "{}" });
        const index = state.project.assets.findIndex((item) => item.id === asset.id);
        if (index >= 0) state.project.assets[index] = generated;
      } catch (error) {
        failures.push({ name: asset.name, message: error.message });
        state.assetBatch.failed += 1;
      }
      state.assetBatch.done += 1;
      render();
    }
  } finally {
    state.assetBatch.running = false;
    state.assetBatch.current = "";
    await openProject(state.project.id, false, "assets").catch(() => render());
  }
  if (failures.length) {
    toast(`已完成 ${targets.length - failures.length}/${targets.length} 个；失败：${failures.map((item) => item.name).join("、")}。可再次点击重试缺失项。`, "error");
  } else {
    toast(`已生成 ${targets.length} 张参考图，请逐张检查后点击“确认使用”`);
  }
}

async function approveAsset(assetId) {
  try {
    await api(`/api/assets/${encodeURIComponent(assetId)}/approve`, { method: "POST", body: "{}" });
    await openProject(state.project.id, false, "assets");
    toast("资产已批准，后续相关镜头会自动绑定这张参考图");
  } catch (error) { toast(error.message, "error"); }
}

async function reparseAssets() {
  try {
    const button = document.querySelector('[data-action="reparse-assets"]');
    if (button) { button.disabled = true; button.textContent = "识别中…"; }
    await api(`/api/projects/${encodeURIComponent(state.project.id)}/reparse-assets`, { method: "POST", body: "{}" });
    await openProject(state.project.id, false, "assets");
    toast("已按原始分镜重新识别人物和场景；已批准的同名参考图已保留");
  } catch (error) { toast(error.message, "error"); render(); }
}

async function saveShotAssetBindings() {
  const shot = selectedShot();
  if (!shot) return;
  const characterIds = [...document.querySelectorAll("[data-binding-character]:checked")].map((input) => input.value);
  const sceneId = document.querySelector("[data-binding-scene]")?.value || "";
  const propIds = [...document.querySelectorAll("[data-binding-prop]:checked")].map((input) => input.value);
  try {
    await api(`/api/shots/${encodeURIComponent(shot.id)}/assets`, {
      method: "PATCH",
      body: JSON.stringify({ characterIds, sceneId, propIds })
    });
    await openProject(state.project.id, true, "workspace");
    toast("已保存本镜的稳定资产关联");
  } catch (error) { toast(error.message, "error"); }
}

async function autoBindShotAssets() {
  const shot = selectedShot();
  if (!shot) return;
  try {
    await api(`/api/shots/${encodeURIComponent(shot.id)}/assets/auto`, { method: "POST", body: "{}" });
    await openProject(state.project.id, true, "workspace");
    toast("已根据出场角色、场景、道具别名重新识别");
  } catch (error) { toast(error.message, "error"); }
}

function render() {
  if (state.view === "assets" && state.project) renderAssets();
  else if (state.view === "workspace" && state.project) renderWorkspace();
  else renderHome();
}

function statusLabel(status) {
  return ({ queued: "等待提交", submitting: "正在提交", submitted: "已提交", processing: "生成中", succeeded: "生成完成", failed: "生成失败" })[status] || "等待生成";
}

function relativeTime(value) {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function countReady(shots) {
  return shots.filter((shot) => shot.takes.some((take) => take.status === "succeeded")).length;
}

function nextActionLabel(shots) {
  const unfinished = shots.filter((shot) => !shot.takes.some((take) => take.status === "succeeded"));
  if (unfinished.length && !unfinished.some((shot) => shot.assetReadiness?.ready)) return "继续准备资产";
  if (!shots.some((shot) => shot.takes.length)) return "生成第一个试片";
  if (unfinished.length) return "处理下一个未完成";
  if (shots.some((shot) => !shot.preferredTakeId)) return "选择下一个主选";
  return "播放完整粗剪";
}

function scheduleSave(field, value) {
  state.saving = true;
  const shot = selectedShot();
  if (!shot) return;
  shot[field] = field === "duration" || field === "editDuration" ? Number(value) : value;
  const changes = pendingShotChanges.get(shot.id) || {};
  changes[field] = shot[field];
  pendingShotChanges.set(shot.id, changes);
  clearTimeout(saveTimers.get(shot.id));
  const timer = setTimeout(async () => {
    try {
      const payload = { ...(pendingShotChanges.get(shot.id) || {}) };
      pendingShotChanges.delete(shot.id);
      saveTimers.delete(shot.id);
      await api(`/api/shots/${encodeURIComponent(shot.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
      state.saving = pendingShotChanges.size > 0;
      render();
    } catch (error) {
      state.saving = pendingShotChanges.size > 0;
      toast(error.message, "error");
    }
  }, 600);
  saveTimers.set(shot.id, timer);
}

async function generateCurrent(goNext = false) {
  const shot = selectedShot();
  if (!shot) return;
  try {
    await flushShotInputs(shot);
    await api(`/api/shots/${encodeURIComponent(shot.id)}/generate`, {
      method: "POST",
      body: JSON.stringify({ count: state.generationCount, resolution: state.resolution, changeRequest: state.changeRequest, allowTextOnly: state.allowTextOnly })
    });
    toast(`已提交 ${state.generationCount} 个候选，后台生成中`);
    state.changeRequest = "";
    await openProject(state.project.id, true, "workspace");
    if (goNext) selectAdjacentShot(1);
  } catch (error) {
    toast(error.message, "error");
  }
}

async function renderPostShot() {
  const shot = selectedShot();
  if (!shot?.postOnly) return;
  try {
    await flushShotInputs(shot);
    const style = Object.fromEntries([...document.querySelectorAll("[data-title-card-style]")]
      .map((input) => [input.dataset.titleCardStyle, input.value]));
    await api(`/api/shots/${encodeURIComponent(shot.id)}/render-post`, { method: "POST", body: JSON.stringify({ style }) });
    await openProject(state.project.id, false, "workspace");
    toast("后期字幕卡已生成并设为主选");
  } catch (error) { toast(error.message, "error"); }
}

async function upgradePreferredTo1080() {
  const shot = selectedShot();
  const mainTake = preferredTake(shot);
  if (!shot || !mainTake) return toast("请先把满意的候选设为主选", "error");
  try {
    await flushShotInputs(shot);
    await api(`/api/shots/${encodeURIComponent(shot.id)}/generate`, {
      method: "POST",
      body: JSON.stringify({ count: 1, resolution: "1080p", upgradeFromTakeId: mainTake.id })
    });
    toast(`已基于 TAKE ${String(mainTake.no).padStart(2, "0")} 提交 1080p 定稿候选`);
    await openProject(state.project.id, true, "workspace");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function flushShotInputs(shot) {
  const payload = {};
  document.querySelectorAll("[data-shot-field]").forEach((input) => { payload[input.dataset.shotField] = input.value; });
  clearTimeout(saveTimers.get(shot.id));
  saveTimers.delete(shot.id);
  pendingShotChanges.delete(shot.id);
  if (Object.keys(payload).length) await api(`/api/shots/${encodeURIComponent(shot.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
}

function selectAdjacentShot(step) {
  const shots = workspaceShots();
  const index = shots.findIndex((shot) => shot.id === state.selectedShotId);
  const next = shots[index + step];
  if (next) {
    state.selectedShotId = next.id;
    state.selectedTakeId = next.preferredTakeId || next.takes[0]?.id || "";
    localStorage.setItem("novelcut:lastShot", next.id);
    render();
  }
}

async function updateTake(action) {
  const take = selectedTake();
  if (!take) return;
  try {
    await api(`/api/takes/${encodeURIComponent(take.id)}/${action}`, { method: "POST", body: "{}" });
    await openProject(state.project.id, true, "workspace");
    toast(action === "prefer" ? "已设为当前镜头主选" : action === "approve" ? "候选已通过" : "候选已淘汰");
  } catch (error) { toast(error.message, "error"); }
}

async function refreshActiveProject() {
  if (!state.project || !["workspace", "assets"].includes(state.view)) return;
  if (document.activeElement?.matches("input, textarea, select")) return;
  const projectId = state.project.id;
  const activeView = state.view;
  const previousUpdatedAt = state.project.updatedAt;
  await loadProjects().catch(() => {});
  if (!state.project) {
    render();
    toast("当前项目已被删除，已返回项目列表", "error");
    return;
  }
  if (activeView === "assets") {
    const summary = state.projects.find((project) => project.id === projectId);
    if (summary?.updatedAt !== previousUpdatedAt) await openProject(projectId, true, "assets").catch(() => {});
    return;
  }
  const hasActive = flattenShots().some((shot) => shot.takes.some((take) => ["queued", "submitting", "submitted", "processing"].includes(take.status)));
  if (hasActive) await openProject(projectId, true, "workspace").catch(() => {});
}

function transitionExecutionLabel(value) {
  return ({ generate: "生成空镜", edit: "剪辑衔接", audio: "声音桥", local_effect: "本地特效" })[value] || "待确认";
}

function renderTransitionQueue() {
  const project = state.project;
  const allTransitions = project?.production?.transitions || [];
  const episodeTransitions = state.transitionEpisode
    ? allTransitions.filter((item) => Number(item.episodeNumber) === state.transitionEpisode)
    : allTransitions;
  const transitions = state.transitionFilter === "all"
    ? episodeTransitions
    : episodeTransitions.filter((item) => item.execution === state.transitionFilter);
  const filters = [
    ["all", "全部"], ["generate", "生成空镜"], ["edit", "剪辑衔接"], ["audio", "声音桥"], ["local_effect", "本地特效"]
  ];
  const counts = Object.fromEntries(filters.map(([key]) => [key, key === "all" ? episodeTransitions.length : episodeTransitions.filter((item) => item.execution === key).length]));
  transitionDialogContent.innerHTML = `<div class="transition-wrap">
    <header class="modal-head transition-head"><div><span class="kicker">TRANSITION QUEUE</span><h2>转场制作清单</h2><p>${escapeHtml(project?.name || "")} · ${escapeHtml(episodeLabel(project, state.transitionEpisode))} · 转场与正片镜头分开管理</p></div><button class="icon-button" data-action="close-transitions" aria-label="关闭">×</button></header>
    <div class="transition-toolbar">
      ${renderEpisodeNavigator(project, state.transitionEpisode, "data-transition-episode")}
      <div class="transition-filters">${filters.map(([key, label]) => `<button class="${state.transitionFilter === key ? "active" : ""}" data-transition-filter="${key}" ${counts[key] ? "" : "disabled"}>${label}<small>${counts[key]}</small></button>`).join("")}</div>
    </div>
    <div class="transition-list">${transitions.length ? transitions.map((item) => `<article class="transition-card execution-${escapeHtml(item.execution || "unknown")}">
      <div class="transition-card-head"><span class="transition-id">${escapeHtml(item.id || item.type || "转场")}</span><strong>${escapeHtml(item.title || item.method || item.function || "未命名转场")}</strong><span class="transition-execution">${escapeHtml(transitionExecutionLabel(item.execution))}</span></div>
      <p>${escapeHtml(item.function || item.method || "未填写转场功能")}</p>
      <div class="transition-link"><button data-transition-shot="${escapeHtml(item.fromShot || "")}" data-transition-shot-episode="${Number(item.episodeNumber || 0)}" ${item.fromShot ? "" : "disabled"}>${escapeHtml(item.fromShot || "片头")}</button><span>→</span><button data-transition-shot="${escapeHtml(item.toShot || "")}" data-transition-shot-episode="${Number(item.episodeNumber || 0)}" ${item.toShot ? "" : "disabled"}>${escapeHtml(item.toShot || "片尾")}</button><small>${Number(item.duration || 0) ? `${Number(item.duration)}s` : "时长未定"}</small></div>
      ${item.prompt ? `<details><summary>查看执行提示词</summary><pre>${escapeHtml(item.prompt)}</pre></details>` : ""}
    </article>`).join("") : '<div class="transition-empty"><strong>当前筛选没有转场</strong><span>切换剧集或制作类型查看其他项目。</span></div>'}</div>
  </div>`;
}

function openTransitionQueue() {
  if (!state.project?.production?.transitions?.length) return toast("当前项目没有识别到转场关系", "error");
  state.transitionEpisode = state.activeEpisode;
  renderTransitionQueue();
  transitionDialog.showModal();
}

function locateTransitionShot(sourceShotId, episodeNumber) {
  const shot = flattenShots().find((item) => Number(shotEpisodeNumber(item)) === Number(episodeNumber)
    && String(item.generationMeta?.sourceShotId || "") === String(sourceShotId || ""));
  if (!shot) return toast(`没有找到来源镜头 ${sourceShotId}`, "error");
  state.activeEpisode = Number(episodeNumber) || 0;
  state.roughEpisode = state.activeEpisode;
  state.selectedShotId = shot.id;
  state.selectedTakeId = shot.preferredTakeId || shot.takes[0]?.id || "";
  state.view = "workspace";
  localStorage.setItem("novelcut:lastShot", shot.id);
  transitionDialog.close();
  render();
}

async function openRoughCut() {
  await loadProjects().catch(() => {});
  if (!state.project) {
    render();
    return toast("这个项目已删除或尚未打开，请从项目列表选择", "error");
  }
  try {
    const episodes = seriesEpisodes();
    if (episodes.length && !state.roughEpisode) state.roughEpisode = state.activeEpisode || Number(episodes[0].number);
    if (!episodes.length) state.roughEpisode = 0;
    const query = state.roughEpisode ? `?episode=${state.roughEpisode}` : "";
    const data = await api(`/api/projects/${encodeURIComponent(state.project.id)}/rough-cut${query}`);
    state.roughItems = data.items;
    state.roughIndex = Math.max(0, data.items.findIndex((item) => item.take));
    state.assembledUrl = "";
    renderRoughCut();
    roughCutDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

function renderRoughCut() {
  const item = state.roughItems[state.roughIndex];
  const ready = state.roughItems.filter((entry) => entry.take).length;
  const missing = state.roughItems.length - ready;
  const totalDuration = state.roughItems.reduce((sum, entry) => sum + Number(entry.duration || 0), 0);
  const player = state.assembledUrl
    ? `<video src="${escapeHtml(state.assembledUrl)}" controls autoplay></video>`
    : item?.take?.videoUrl
      ? `<video id="roughVideo" src="${escapeHtml(item.take.videoUrl)}" controls autoplay></video>`
      : `<div class="empty-frame roughcut-empty"><div><h3>${escapeHtml(item?.title || "暂无镜头")}</h3><p>${item?.postOnly ? "这个后期镜头尚未制作，请返回工作台生成字幕卡。" : "这个镜头还没有可播放候选，请返回工作台生成或设为主选。"}</p></div></div>`;
  const exportAction = state.assembledUrl
    ? `<a class="button primary" href="${escapeHtml(state.assembledUrl)}" download>下载完整视频</a><button class="button ghost" data-action="assemble">重新合成</button>`
    : `<button class="button primary" data-action="assemble" ${missing || ready < 2 ? "disabled" : ""}>${missing ? `还差 ${missing} 镜，暂不能合片` : ready < 2 ? "至少需要 2 个镜头" : "合成完整视频"}</button>`;
  roughCutContent.innerHTML = `<div class="roughcut-wrap ${seriesEpisodes().length ? "has-episodes" : ""}">
    <header class="modal-head roughcut-head"><div><h2>粗剪与导出</h2><p>${escapeHtml(state.project.name)} · ${escapeHtml(episodeLabel(state.project, state.roughEpisode))} · ${formatDuration(totalDuration)} · ${ready}/${state.roughItems.length} 镜可播放</p></div><div class="roughcut-actions">${exportAction}<button class="icon-button" data-action="close-rough" aria-label="关闭">×</button></div></header>
    ${seriesEpisodes().length ? `<div class="roughcut-episode-nav">${renderEpisodeNavigator(state.project, state.roughEpisode, "data-rough-episode", false)}<span>每集单独合成，避免误把整季导出为一个视频。</span></div>` : ""}
    <div class="roughcut-viewer">${player}</div>
    <div class="roughcut-strip">${state.roughItems.map((entry, index) => `<button class="roughcut-item ${index === state.roughIndex ? "active" : ""} ${entry.take ? "ready" : "missing"} ${entry.postOnly ? "post-only" : ""}" data-rough-index="${index}"><span>${String(entry.no).padStart(2,"0")} · ${entry.duration}s</span><strong>${escapeHtml(entry.title)}</strong><small>${entry.take ? "可播放" : entry.postOnly ? "待制作后期" : "未生成"}</small></button>`).join("")}</div>
  </div>`;
  const video = document.querySelector("#roughVideo");
  if (video) video.addEventListener("ended", playNextRoughItem, { once: true });
}

function playNextRoughItem() {
  let next = state.roughIndex + 1;
  while (next < state.roughItems.length && !state.roughItems[next].take) next += 1;
  if (next < state.roughItems.length) { state.roughIndex = next; renderRoughCut(); }
}

async function assembleRoughCut() {
  try {
    const button = roughCutContent.querySelector('[data-action="assemble"]');
    if (button) { button.disabled = true; button.textContent = "合片中…"; }
    const data = await api(`/api/projects/${encodeURIComponent(state.project.id)}/assemble`, { method: "POST", body: JSON.stringify({ episode: state.roughEpisode || 0 }) });
    state.assembledUrl = data.videoUrl;
    renderRoughCut();
    toast("完整粗剪已合成");
  } catch (error) { toast(error.message, "error"); renderRoughCut(); }
}

function showCapabilities() {
  const caps = state.capabilities;
  toast(`Seedance ${caps?.seedance?.available ? "已连接" : "未配置"} · 镜头知识库 ${caps?.promptKnowledge?.version || "未加载"} · FFmpeg ${caps?.ffmpeg?.available ? "可用" : "不可用"}`);
}

app.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-project]");
  if (deleteButton) return openDeleteProject(deleteButton.dataset.deleteProject, deleteButton.dataset.projectName, deleteButton.dataset.projectUpdatedAt);
  const projectButton = event.target.closest("[data-project-id]");
  if (projectButton) return openProject(projectButton.dataset.projectId);
  const shotButton = event.target.closest("[data-shot-id]");
  if (shotButton) {
    state.selectedShotId = shotButton.dataset.shotId;
    const shot = selectedShot();
    state.selectedTakeId = shot?.preferredTakeId || shot?.takes[0]?.id || "";
    state.changeRequest = "";
    state.allowTextOnly = false;
    localStorage.setItem("novelcut:lastShot", state.selectedShotId);
    return render();
  }
  const takeButton = event.target.closest("[data-take-id]");
  if (takeButton) { state.selectedTakeId = takeButton.dataset.takeId; return render(); }
  const countButton = event.target.closest("[data-count]");
  if (countButton) { state.generationCount = Number(countButton.dataset.count); return render(); }
  const episodeButton = event.target.closest("[data-episode-number]");
  if (episodeButton) {
    state.activeEpisode = Number(episodeButton.dataset.episodeNumber || 0);
    state.roughEpisode = state.activeEpisode;
    const shots = workspaceShots();
    if (!shots.some((shot) => shot.id === state.selectedShotId)) {
      state.selectedShotId = shots[0]?.id || "";
      state.selectedTakeId = shots[0]?.preferredTakeId || shots[0]?.takes[0]?.id || "";
    }
    state.changeRequest = "";
    state.allowTextOnly = false;
    return render();
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "home") { state.view = "home"; await loadProjects(); render(); }
  if (action === "assets") {
    await loadProjects();
    if (state.project) { state.view = "assets"; render(); }
    else { render(); toast("请先打开一个项目", "error"); }
  }
  if (action === "workspace") {
    await loadProjects();
    if (state.project) { state.view = "workspace"; render(); }
    else { render(); toast("请先打开一个项目", "error"); }
  }
  if (action === "enter-workspace") { state.view = "workspace"; state.allowTextOnly = false; render(); }
  if (action === "reparse-assets") reparseAssets();
  if (action === "toggle-asset-group") {
    const key = event.target.closest("[data-group-key]")?.dataset.groupKey;
    if (key) state.assetSections[key] = !state.assetSections[key];
    render();
  }
  if (action === "expand-asset-groups") {
    Object.keys(state.assetSections).forEach((key) => { state.assetSections[key] = true; });
    render();
  }
  if (action === "collapse-asset-groups") {
    Object.keys(state.assetSections).forEach((key) => { state.assetSections[key] = false; });
    render();
  }
  if (action === "save-bindings") saveShotAssetBindings();
  if (action === "auto-bindings") autoBindShotAssets();
  if (action === "generate-asset") generateAsset(event.target.closest("[data-asset-id]").dataset.assetId);
  if (action === "generate-all-assets") generateAllAssets();
  if (action === "approve-asset") approveAsset(event.target.closest("[data-asset-id]").dataset.assetId);
  if (action === "new-project") openCreateDialog("project");
  if (action === "append-shots") openCreateDialog("append");
  if (action === "rough-cut") openRoughCut();
  if (action === "transitions") openTransitionQueue();
  if (action === "preview-prompt") openPromptPreview();
  if (action === "close-prompt") promptDialog.close();
  if (action === "generate") generateCurrent(false);
  if (action === "generate-next") generateCurrent(true);
  if (action === "render-post") renderPostShot();
  if (action === "upgrade-1080") upgradePreferredTo1080();
  if (action === "approve-take") updateTake("approve");
  if (action === "prefer-take") updateTake("prefer");
  if (action === "reject-take") updateTake("reject");
  if (action === "focus-generate") document.querySelector("#changeRequest")?.focus();
  if (action === "capabilities") showCapabilities();
  if (action === "next-action") {
    const shots = workspaceShots();
    const unfinishedShots = shots.filter((shot) => !shot.takes.some((take) => take.status === "succeeded"));
    const unfinished = unfinishedShots.find((shot) => shot.assetReadiness?.ready) || unfinishedShots[0];
    const unselected = shots.find((shot) => shot.takes.some((take) => take.status === "succeeded") && !shot.preferredTakeId);
    if (unfinished && !unfinished.assetReadiness?.ready) {
      state.view = "assets";
      render();
      return;
    }
    if (unfinished || unselected) {
      state.selectedShotId = (unfinished || unselected).id;
      state.selectedTakeId = (unfinished || unselected).takes[0]?.id || "";
      render();
      if (unfinished) setTimeout(() => document.querySelector("#changeRequest")?.focus(), 0);
    } else openRoughCut();
  }
  if (action === "show-tasks") {
    const jobs = await api(`/api/jobs?projectId=${encodeURIComponent(state.project.id)}`);
    const active = jobs.filter((job) => !["succeeded", "failed"].includes(job.status)).length;
    const failed = jobs.filter((job) => job.status === "failed").length;
    toast(`${active} 个任务进行中，${failed} 个失败，${jobs.length} 个近期任务`);
  }
});

app.addEventListener("input", (event) => {
  if (event.target.id === "shotSearch") {
    state.search = event.target.value;
    render();
    const input = document.querySelector("#shotSearch");
    input?.focus();
    input?.setSelectionRange(state.search.length, state.search.length);
    return;
  }
  if (event.target.id === "changeRequest") { state.changeRequest = event.target.value; return; }
  if (event.target.matches("[data-shot-field]")) scheduleSave(event.target.dataset.shotField, event.target.value);
});

app.addEventListener("change", (event) => {
  if (event.target.id === "resolutionSelect") state.resolution = event.target.value;
  if (event.target.id === "allowTextOnly") { state.allowTextOnly = event.target.checked; render(); }
  if (event.target.matches("[data-asset-upload]")) return uploadAssetReference(event.target.dataset.assetUpload, event.target.files?.[0]);
  if (event.target.matches("[data-asset-field]")) return updateAsset(event.target.dataset.assetId, event.target.dataset.assetField, event.target.value);
  if (event.target.matches("[data-shot-field]")) scheduleSave(event.target.dataset.shotField, event.target.value);
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = createSubmit;
  const payload = Object.fromEntries(new FormData(createForm));
  payload.sourceManifest = manifestFromSources();
  try {
    const preview = await refreshSourcePreview();
    if (!preview?.shotCount) throw new Error("没有识别到可创建的分镜，请先检查解析预览");
    if (preview.requiresConfirmation && payload.confirmSourceRisks !== "on") throw new Error("请先查看完稿体检，并确认使用系统修复方案后再创建");
    submit.disabled = true;
    submit.textContent = createMode === "append" ? "正在追加分镜…" : "正在整理项目…";
    const previousCount = flattenShots().length;
    const project = createMode === "append"
      ? await api(`/api/projects/${encodeURIComponent(state.project.id)}/import-shots`, { method: "POST", body: JSON.stringify(payload) })
      : await api("/api/projects", { method: "POST", body: JSON.stringify(payload) });
    createDialog.close();
    createForm.reset();
    resetSourceImport();
    await loadProjects();
    await openProject(project.id, false, "assets");
    toast(createMode === "append" ? `已追加 ${flattenShots().length - previousCount} 个镜头` : `已整理出 ${flattenShots().length} 个镜头`);
  } catch (error) { toast(error.message, "error"); }
  finally {
    submit.disabled = false;
    submit.textContent = createMode === "append" ? "确认追加分镜" : "创建并准备资产";
  }
});

document.querySelector("#loadSample").addEventListener("click", () => {
  if (createMode === "project") createForm.elements.name.value = "雾港来信 · 第一集";
  applyImportedSources([{ name: "雾港来信 · 第一集.md", relativePath: "雾港来信 · 第一集.md", size: sampleSource.length, text: sampleSource, kind: "sample" }], "内置示例");
});

sourceFileInput.addEventListener("change", async () => {
  try { await loadSourceFiles(sourceFileInput.files); }
  catch (error) { toast(error.message, "error"); }
  finally { sourceFileInput.value = ""; }
});

document.querySelector("#sourceFileButton").addEventListener("pointerdown", () => {
  setSourceStatus("请选择 .docx / .md / .markdown / .txt 文件，可一次多选");
});

document.querySelector("#sourceFolderButton").addEventListener("pointerdown", () => {
  setSourceStatus("文件夹模式：文件置灰是正常的，请选中整个文件夹");
});

sourceFolderInput.addEventListener("change", async () => {
  try { await loadSourceFiles(sourceFolderInput.files); }
  catch (error) { toast(error.message, "error"); }
  finally { sourceFolderInput.value = ""; }
});

document.querySelector("#loadSourcePath").addEventListener("click", loadSourcePath);
sourcePathInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); loadSourcePath(); }
});

sourceImportZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  sourceImportZone.classList.add("dragging");
});
sourceImportZone.addEventListener("dragleave", (event) => {
  if (!sourceImportZone.contains(event.relatedTarget)) sourceImportZone.classList.remove("dragging");
});
sourceImportZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  sourceImportZone.classList.remove("dragging");
  try { await loadSourceFiles(event.dataTransfer?.files); }
  catch (error) { toast(error.message, "error"); }
});

sourceList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-source]");
  if (!button) return;
  importedSources.splice(Number(button.dataset.removeSource), 1);
  createForm.elements.sourceText.value = combineSources(importedSources);
  lastSourceDescription = importedSources.length ? `已选择 ${importedSources.length} 个文件` : "手动输入内容";
  renderSourceList();
  scheduleSourcePreview();
});

createForm.elements.sourceText.addEventListener("input", () => {
  sourceTextDirty = true;
  lastSourceDescription = importedSources.length ? `已导入并编辑 ${importedSources.length} 个文件` : "手动输入内容";
  setSourceStatus(`${lastSourceDescription} · 正在解析…`);
  renderSourceList();
  scheduleSourcePreview();
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => createDialog.close()));
document.querySelectorAll("[data-close-delete]").forEach((button) => button.addEventListener("click", () => {
  pendingProjectDelete = null;
  deleteDialog.close();
}));
deleteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await deletePendingProject();
});

roughCutContent.addEventListener("click", (event) => {
  const episodeButton = event.target.closest("[data-rough-episode]");
  if (episodeButton) {
    state.roughEpisode = Number(episodeButton.dataset.roughEpisode || 0);
    state.assembledUrl = "";
    openRoughCut();
    return;
  }
  const indexButton = event.target.closest("[data-rough-index]");
  if (indexButton) { state.roughIndex = Number(indexButton.dataset.roughIndex); state.assembledUrl = ""; renderRoughCut(); return; }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "close-rough") roughCutDialog.close();
  if (action === "assemble") assembleRoughCut();
});

promptDialogContent.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="close-prompt"]')) promptDialog.close();
});

transitionDialogContent.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="close-transitions"]')) return transitionDialog.close();
  const episodeButton = event.target.closest("[data-transition-episode]");
  if (episodeButton) {
    state.transitionEpisode = Number(episodeButton.dataset.transitionEpisode || 0);
    state.transitionFilter = "all";
    renderTransitionQueue();
    return;
  }
  const filterButton = event.target.closest("[data-transition-filter]");
  if (filterButton) {
    state.transitionFilter = filterButton.dataset.transitionFilter;
    renderTransitionQueue();
    return;
  }
  const shotButton = event.target.closest("[data-transition-shot]");
  if (shotButton) locateTransitionShot(shotButton.dataset.transitionShot, shotButton.dataset.transitionShotEpisode);
});

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea, select")) return;
  if (state.view !== "workspace") return;
  if (event.key.toLowerCase() === "j") selectAdjacentShot(-1);
  if (event.key.toLowerCase() === "k") selectAdjacentShot(1);
  if (event.key.toLowerCase() === "g") generateCurrent(false);
  if (event.key.toLowerCase() === "a") updateTake("approve");
  if (event.key.toLowerCase() === "p") updateTake("prefer");
  if (event.key === " ") { event.preventDefault(); document.querySelector(".video-shell video")?.paused ? document.querySelector(".video-shell video")?.play() : document.querySelector(".video-shell video")?.pause(); }
});

init();
