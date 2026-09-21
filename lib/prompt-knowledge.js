const fs = require("node:fs");
const path = require("node:path");

const defaultKnowledgePath = path.join(__dirname, "..", "knowledge", "prompt-knowledge.json");

function loadKnowledgeBase(filePath = defaultKnowledgePath) {
  const knowledge = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!knowledge?.meta?.version || !knowledge?.compiler || !knowledge?.lexicon) {
    throw new Error("镜头知识库格式不完整");
  }
  return knowledge;
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function detectEntries(text, entries = []) {
  const normalized = normalizeText(text);
  return entries.map((entry) => {
    let lastIndex = -1;
    let matchedLabel = "";
    for (const label of entry.labels || []) {
      const index = normalized.lastIndexOf(normalizeText(label));
      if (index > lastIndex) {
        lastIndex = index;
        matchedLabel = label;
      }
    }
    return lastIndex >= 0 ? { ...entry, matchedLabel, index: lastIndex } : null;
  }).filter(Boolean).sort((a, b) => a.index - b.index);
}

function uniqueById(items) {
  return items.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
}

function countSignals(text, signals = []) {
  const normalized = normalizeText(text);
  return signals.filter((signal) => normalized.includes(normalizeText(signal))).length;
}

function hasAny(text, values = []) {
  const normalized = normalizeText(text);
  return values.some((value) => normalized.includes(normalizeText(value)));
}

function selectShotRecipes(shot, knowledge) {
  const text = normalizeText([shot.title, shot.prompt, shot.scene, shot.characters].filter(Boolean).join("\n"));
  return (knowledge.shotRecipes || []).map((recipe) => {
    if ((recipe.exclude || []).some((item) => text.includes(normalizeText(item)))) return null;
    const matches = (recipe.labels || []).filter((item) => text.includes(normalizeText(item)));
    if (matches.length < Number(recipe.minimumMatches || 1)) return null;
    return { ...recipe, matches, score: Number(recipe.priority || 0) + matches.length * 8 };
  }).filter(Boolean).sort((left, right) => right.score - left.score || right.matches.length - left.matches.length);
}

function hasReadableTextRequest(prompt, risks) {
  return String(prompt || "").split(/[；;。\n]/).some((clause) => {
    if (!hasAny(clause, risks)) return false;
    return !/(?:禁止|不要|不生成|不出现|避免|后期|无文字|无可读文字)/.test(clause);
  });
}

function selectDefaultShotSize(shot, knowledge) {
  const prompt = String(shot.prompt || "");
  const characters = String(shot.characters || "").split(/[、,，/]+/).map((item) => item.trim()).filter(Boolean);
  if (hasAny(prompt, ["眼神", "表情", "脸", "泪", "嘴角", "瞳孔", "微表情"])) return knowledge.compiler.defaultShotSize.emotion;
  if (characters.length >= 2 && hasAny(prompt, ["说", "问", "回答", "对话", "争吵"])) return knowledge.compiler.defaultShotSize.dialoguePair;
  if (!characters.length) return knowledge.compiler.defaultShotSize.environment;
  return knowledge.compiler.defaultShotSize.character;
}

function buildTimeline(duration, hasTimeline) {
  if (hasTimeline) return "沿用原分镜的明确时序，不交换事件顺序。";
  const total = Number(duration) || 5;
  const first = Math.max(1, Math.round(total * 0.2));
  const last = Math.max(first + 1, Math.round(total * 0.8));
  return `0–${first}秒建立主体与空间；${first}–${last}秒完成一个核心动作；${last}–${total}秒停在清楚的动作结果，留出剪辑点。`;
}

function analyzeShot(shot, knowledge) {
  const text = [shot.title, shot.prompt, shot.scene, shot.characters].filter(Boolean).join("\n");
  const shotSizes = uniqueById(detectEntries(text, knowledge.lexicon.shotSizes));
  const angles = uniqueById(detectEntries(text, knowledge.lexicon.angles));
  const cameraMoves = uniqueById(detectEntries(text, knowledge.lexicon.cameraMoves));
  const lighting = uniqueById(detectEntries(text, knowledge.lexicon.lighting));
  const compositions = uniqueById(detectEntries(text, knowledge.lexicon.compositions));
  const focus = uniqueById(detectEntries(text, knowledge.lexicon.focus));
  const lenses = uniqueById(detectEntries(text, knowledge.lexicon.lenses));
  const blocking = uniqueById(detectEntries(text, knowledge.lexicon.blocking));
  const transitions = uniqueById(detectEntries(text, knowledge.lexicon.transitions));
  const patterns = uniqueById(detectEntries(text, knowledge.dramaticPatterns));
  const characters = String(shot.characters || "").split(/[、,，/]+/).map((item) => item.trim()).filter(Boolean);
  const meaningfulCharacters = characters.filter((item) => !/(?:车流|列车|车辆|乘客(?:群)?|人群|群演|救援队|救援者|消防员|特警|记者|媒体|伤者|路人|剪影|远景|背景)$/.test(item));
  const recipes = selectShotRecipes(shot, knowledge);
  const actionCount = countSignals(shot.prompt, knowledge.lint.actionSignals);
  const duration = Number(shot.duration || shot.duration_sec) || 5;
  const actionLimit = Number(knowledge.lint.maxActions[String(duration)] || Math.ceil(duration / 2));
  const hasTimeline = /(?:\d+(?:\.\d+)?\s*[-–~至]\s*\d+(?:\.\d+)?\s*秒|\[?\d+(?:\.\d+)?s?\s*[-–]\s*\d+(?:\.\d+)?s?\]?)/i.test(String(shot.prompt || ""));
  const issues = [];

  if (!String(shot.prompt || "").trim()) issues.push({ level: "error", code: "missing_prompt", message: "缺少镜头内容，无法形成可执行动作。" });
  if (!String(shot.scene || "").trim()) issues.push({ level: "warning", code: "missing_scene", message: "未识别场景，空间、时间和光向无法跨镜锁定。" });
  if (!shotSizes.length) issues.push({ level: "info", code: "missing_shot_size", message: `未写景别，生成时将按内容采用“${selectDefaultShotSize(shot, knowledge)}”。` });
  if (!cameraMoves.length) issues.push({ level: "info", code: "missing_camera", message: `未写运镜，生成时将采用“${knowledge.compiler.defaultCamera}”。` });
  const locked = cameraMoves.some((item) => item.id === "locked");
  const moving = cameraMoves.some((item) => item.id !== "locked");
  if (locked && moving) issues.push({ level: "warning", code: "camera_conflict", message: "同时出现固定机位和运动镜头；生成时只执行最后出现的主运镜。" });
  if (cameraMoves.filter((item) => item.id !== "rack_focus").length > 2) issues.push({ level: "warning", code: "too_many_camera_moves", message: "运镜指令过多；短镜头建议只保留一个主运镜。" });
  if (actionCount > actionLimit) issues.push({ level: "warning", code: "action_overload", message: `${duration} 秒内检测到约 ${actionCount} 个动作信号，可能丢动作；建议压缩到 ${actionLimit} 个以内。` });
  if (meaningfulCharacters.length >= 2 && !hasAny(shot.prompt, knowledge.lint.positionSignals)) {
    issues.push({ level: "warning", code: "missing_blocking", message: "多人物镜头缺少左右、前后或具体空间站位，容易出现换位、串脸和视线错误。" });
  }
  if (patterns.some((item) => item.id === "entrance") && !hasAny(shot.prompt, knowledge.lint.screenDirectionSignals)) {
    issues.push({ level: "info", code: "missing_screen_direction", message: "人物入场未注明入画侧或入口；建议写清从左、从右或由哪个门口进入。" });
  }
  if (hasAny(shot.prompt, knowledge.lint.wardrobeSignals) && !hasAny(shot.prompt, knowledge.lint.wardrobeSpecificationSignals)) {
    issues.push({ level: "info", code: "underspecified_wardrobe", message: "镜头提到服装但缺少颜色、材质或新旧状态，换装时可能产生颜色和款式漂移。" });
  }
  if (hasReadableTextRequest(shot.prompt, knowledge.lint.readableTextRisks)) issues.push({ level: "warning", code: "readable_text", message: "镜头要求生成可读文字，建议把字幕、信件或屏幕文字留到后期叠加。" });
  const vague = knowledge.lint.vagueWords.filter((word) => normalizeText(shot.prompt).includes(normalizeText(word)));
  if (vague.length >= 2 && !lighting.length && !cameraMoves.length) issues.push({ level: "info", code: "vague_style", message: "抽象氛围词较多，缺少可执行的光线或机位信息。" });

  const penalty = issues.reduce((sum, item) => sum + (item.level === "error" ? 35 : item.level === "warning" ? 14 : 5), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const primaryCamera = cameraMoves.at(-1) || null;
  return {
    score,
    status: issues.some((item) => item.level === "error") ? "blocked" : issues.some((item) => item.level === "warning") ? "review" : "ready",
    detected: {
      shotSize: shotSizes.at(-1)?.canonical || "",
      angle: angles.at(-1)?.canonical || "",
      camera: primaryCamera?.canonical || "",
      lighting: lighting.map((item) => item.canonical),
      composition: compositions.at(-1)?.canonical || "",
      focus: focus.at(-1)?.canonical || "",
      lens: lenses.at(-1)?.canonical || "",
      blocking: blocking.map((item) => item.canonical),
      transitions: transitions.map((item) => item.canonical),
      patterns: patterns.map((item) => item.name),
      primaryRecipe: recipes[0]?.name || "",
      recipes: recipes.slice(0, 2).map((item) => item.name),
      actionCount,
      hasTimeline
    },
    issues
  };
}

function buildKnowledgeDirectives(shot, knowledge) {
  const review = analyzeShot(shot, knowledge);
  const characters = String(shot.characters || "").trim();
  const scene = String(shot.scene || "").trim();
  const shotSize = review.detected.shotSize || selectDefaultShotSize(shot, knowledge);
  const angle = review.detected.angle || "保持自然视线高度";
  const camera = review.detected.camera || knowledge.compiler.defaultCamera;
  const pattern = detectEntries([shot.title, shot.prompt].join("\n"), knowledge.dramaticPatterns).at(-1);
  const recipes = selectShotRecipes(shot, knowledge);
  const primaryRecipe = recipes[0] || null;
  const secondaryRecipe = recipes[1] && recipes[1].score >= recipes[0].score - 8 ? recipes[1] : null;
  const characterList = characters.split(/[、,，/]+/).map((item) => item.trim()).filter(Boolean);
  const wardrobeMentioned = hasAny(shot.prompt, knowledge.lint.wardrobeSignals);
  const referenceRoleLabels = {
    character_view: "人物逐镜参考图",
    scene_view: "场景逐镜参考图",
    prop: "关键道具参考图",
    previous_frame: "上一镜尾帧"
  };
  const positives = [
    ...knowledge.compiler.constraints.basePositive,
    ...(characters ? knowledge.compiler.constraints.characterPositive : []),
    ...(scene ? knowledge.compiler.constraints.scenePositive : [])
  ];
  const negatives = knowledge.compiler.constraints.negative.slice(0, knowledge.compiler.constraints.maxNegativeItems);
  return {
    review,
    lines: [
      `镜头执行：${shotSize}，${angle}；主运镜只执行“${camera}”。`,
      review.detected.composition || review.detected.focus || review.detected.lens
        ? `摄影补充：${[review.detected.composition, review.detected.focus, review.detected.lens].filter(Boolean).join("；")}。`
        : "",
      `时序执行：${buildTimeline(shot.duration || shot.duration_sec, review.detected.hasTimeline)}`,
      pattern ? `短剧节拍：${pattern.name}。${pattern.direction}` : "短剧节拍：只呈现本镜的一个主要信息变化，动作完成后留出可剪辑停顿。",
      primaryRecipe ? `智能镜头模板：${primaryRecipe.name}。${primaryRecipe.direction}` : "",
      primaryRecipe ? `模板执行骨架：${primaryRecipe.promptSkeleton}` : "",
      secondaryRecipe ? `辅助镜头意图：${secondaryRecipe.name}；只作为次要节拍，不增加第二条独立动作线。` : "",
      primaryRecipe?.referencePriority?.length ? `参考资产优先级：${primaryRecipe.referencePriority.map((item) => referenceRoleLabels[item] || item).join(" → ")}；每张参考图只承担其既定职责。` : "",
      primaryRecipe?.continuityChecks?.length ? `本镜连续性复核：${primaryRecipe.continuityChecks.join("、")}。` : "",
      characters ? `连续性锚点：${characters}；每次出现均保持同一身份、五官、发型、服装和关键配饰。` : "",
      characterList.length >= 2 && !review.detected.blocking.length
        ? "人物调度：按分镜明确每人的画面左/右、前/后景、朝向和对视对象；未明确前不让人物自行换位。"
        : review.detected.blocking.length ? `人物调度：${review.detected.blocking.join("；")}，保持轴线、视线和屏幕方向。` : "",
      wardrobeMentioned ? "服装状态：本镜明确写出的服装覆盖身份参考图的外层服装；未写换装的人物继承上一出场状态，禁止混搭多套服装。" : "",
      scene ? `空间锚点：${scene}；保持场景地理、陈设位置、时间和主光方向一致。` : "",
      `稳定性要求：${positives.join("；")}。`,
      `画面约束：${negatives.join("；")}。`
    ].filter(Boolean)
  };
}

function getKnowledgeSummary(knowledge) {
  return {
    name: knowledge.meta.name,
    version: knowledge.meta.version,
    updatedAt: knowledge.meta.updatedAt,
    purpose: knowledge.meta.purpose,
    sourceCount: knowledge.sources.length,
    officialSourceCount: knowledge.sources.filter((source) => source.type.startsWith("official")).length,
    githubSourceCount: knowledge.sources.filter((source) => source.type.startsWith("github")).length,
    lexiconCount: Object.values(knowledge.lexicon).reduce((sum, items) => sum + items.length, 0),
    patternCount: knowledge.dramaticPatterns.length,
    recipeCount: knowledge.shotRecipes?.length || 0,
    continuityDimensionCount: knowledge.continuity?.dimensions?.length || 0,
    referenceRoleCount: knowledge.continuity?.referenceRoles?.length || 0,
    failureTypeCount: knowledge.failureTaxonomy?.length || 0,
    principles: knowledge.meta.principles,
    sources: knowledge.sources
  };
}

module.exports = { loadKnowledgeBase, analyzeShot, buildKnowledgeDirectives, getKnowledgeSummary, selectShotRecipes };
