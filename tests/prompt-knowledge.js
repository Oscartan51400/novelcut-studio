const assert = require("node:assert/strict");
const { loadKnowledgeBase, analyzeShot, buildKnowledgeDirectives, getKnowledgeSummary } = require("../lib/prompt-knowledge");

const knowledge = loadKnowledgeBase();
const summary = getKnowledgeSummary(knowledge);
assert.ok(summary.sourceCount >= 14);
assert.ok(summary.officialSourceCount >= 5);
assert.ok(summary.lexiconCount >= 60);
assert.equal(summary.continuityDimensionCount, 8);
assert.equal(summary.referenceRoleCount, 7);
assert.equal(summary.failureTypeCount, 8);
assert.ok(summary.recipeCount >= 20);

const clean = analyzeShot({
  title: "母亲发现戒指",
  prompt: "近景，平视固定机位。母亲拿起桌上的戒指，指尖停住，眼神从疑惑变为震惊。暖色侧光。",
  scene: "老宅餐厅，夜晚",
  characters: "母亲",
  duration: 5
}, knowledge);
assert.equal(clean.detected.shotSize, "近景特写");
assert.equal(clean.detected.camera, "固定机位");
assert.ok(clean.detected.patterns.includes("反应镜头"));
assert.equal(clean.issues.some((issue) => issue.code === "missing_scene"), false);

const conflict = analyzeShot({
  title: "追逐",
  prompt: "固定机位，随后快速跟拍并环绕，人物奔跑、转身、跳跃、摔倒。",
  scene: "雨夜小巷",
  characters: "林澈",
  duration: 5
}, knowledge);
assert.ok(conflict.issues.some((issue) => issue.code === "camera_conflict"));
assert.ok(conflict.issues.some((issue) => issue.code === "action_overload"));

const blockingRisk = analyzeShot({
  title: "争执入场",
  prompt: "中景，林澈推门进入，周默回头，两人争吵。",
  scene: "灯塔值班室",
  characters: "林澈、周默",
  duration: 5
}, knowledge);
assert.ok(blockingRisk.issues.some((issue) => issue.code === "missing_blocking"));
assert.ok(blockingRisk.issues.some((issue) => issue.code === "missing_screen_direction"));

const wardrobeRisk = analyzeShot({
  title: "换装",
  prompt: "近景，林澈穿上外套后看向镜子。",
  scene: "卧室",
  characters: "林澈",
  duration: 5
}, knowledge);
assert.ok(wardrobeRisk.issues.some((issue) => issue.code === "underspecified_wardrobe"));

const enriched = buildKnowledgeDirectives({
  title: "门后的人",
  prompt: "林澈推门，看见周默站在门后。",
  scene: "废弃灯塔，凌晨",
  characters: "林澈、周默",
  duration: 5
}, knowledge);
assert.ok(enriched.lines.some((line) => line.includes("0–1秒")));
assert.ok(enriched.lines.some((line) => line.includes("连续性锚点")));
assert.ok(enriched.lines.some((line) => line.includes("主运镜只执行")));
assert.ok(enriched.lines.some((line) => line.includes("智能镜头模板")));
assert.ok(enriched.lines.some((line) => line.includes("参考资产优先级")));

const genreCases = [
  {
    expected: "悬疑线索揭示",
    shot: { title: "门后的证据", prompt: "近景，侦探推开门，发现异常照片和关键证据。", scene: "旧书房", characters: "侦探", duration: 5 }
  },
  {
    expected: "情感靠近",
    shot: { title: "终于牵手", prompt: "双人中景，两人沉默靠近，她试探着牵手，他避开视线后轻轻回应。", scene: "天台", characters: "林夏、顾沉", duration: 10 }
  },
  {
    expected: "近身动作交锋",
    shot: { title: "走廊交手", prompt: "侧面中景，甲挥拳攻击，乙侧身闪避并格挡，双方重新站定。", scene: "走廊", characters: "甲、乙", duration: 5 }
  },
  {
    expected: "恐怖威胁逼近",
    shot: { title: "门外异响", prompt: "固定机位，黑暗中传来脚步声，门缝下的影子逐渐靠近。", scene: "卧室", characters: "女孩", duration: 5 }
  },
  {
    expected: "时间流逝蒙太奇",
    shot: { title: "多年后", prompt: "同一窗前固定构图，日夜交替，季节变化，表现多年后人物长大。", scene: "老宅", characters: "女孩", duration: 10 }
  }
];
genreCases.forEach(({ expected, shot }) => {
  assert.equal(analyzeShot(shot, knowledge).detected.primaryRecipe, expected, `应识别通用镜头配方：${expected}`);
});

console.log(`prompt knowledge ok · ${summary.version} · ${summary.sourceCount} sources · ${summary.lexiconCount} terms`);
