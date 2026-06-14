const storageKey = "kid-mistake-book-v1";
const uploadDbName = "kid-mistake-book-files";
const uploadStoreName = "uploads";

const uploadObjectUrls = new Map();
const defaultAiSettings = {
  reviewMode: "custom",
  provider: "gemini",
  apiKey: "",
  connectionStatus: "untested",
  testedAt: ""
};
const providerLabels = {
  gemini: "Gemini",
  deepseek: "DeepSeek",
  claude: "Claude",
  gpt: "GPT"
};

let state = loadState();
let activeFilter = "all";
let editingId = null;

const elements = {
  todayLabel: document.querySelector("#todayLabel"),
  paperUpload: document.querySelector("#paperUpload"),
  subjectInput: document.querySelector("#subjectInput"),
  dropzone: document.querySelector(".dropzone"),
  uploadStatus: document.querySelector("#uploadStatus"),
  uploadPreview: document.querySelector("#uploadPreview"),
  startReview: document.querySelector("#startReview"),
  reviewStatus: document.querySelector("#reviewStatus"),
  reviewModeInput: document.querySelector("#reviewModeInput"),
  aiProviderInput: document.querySelector("#aiProviderInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  customAiFields: document.querySelector("#customAiFields"),
  saveAiSettings: document.querySelector("#saveAiSettings"),
  testAiSettings: document.querySelector("#testAiSettings"),
  aiSettingsStatus: document.querySelector("#aiSettingsStatus"),
  resetDemo: document.querySelector("#resetDemo"),
  correctionPanel: document.querySelector("#correctionPanel"),
  problemForm: document.querySelector("#problemForm"),
  questionInput: document.querySelector("#questionInput"),
  childAnswerInput: document.querySelector("#childAnswerInput"),
  correctAnswerInput: document.querySelector("#correctAnswerInput"),
  resultInput: document.querySelector("#resultInput"),
  problemSubjectInput: document.querySelector("#problemSubjectInput"),
  topicInput: document.querySelector("#topicInput"),
  explanationInput: document.querySelector("#explanationInput"),
  saveProblemButton: document.querySelector("#saveProblemButton"),
  cancelEdit: document.querySelector("#cancelEdit"),
  problemList: document.querySelector("#problemList"),
  problemTemplate: document.querySelector("#problemTemplate"),
  totalCount: document.querySelector("#totalCount"),
  wrongCount: document.querySelector("#wrongCount"),
  understoodCount: document.querySelector("#understoodCount"),
  correctRate: document.querySelector("#correctRate"),
  encouragement: document.querySelector("#encouragement"),
  stageStats: document.querySelector("#stageStats"),
  tabs: document.querySelectorAll(".tab")
};

elements.todayLabel.textContent = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "long"
}).format(new Date());

elements.paperUpload.addEventListener("change", handleFiles);
elements.subjectInput.addEventListener("change", () => {
  elements.problemSubjectInput.value = elements.subjectInput.value;
});
elements.dropzone.addEventListener("dragover", handleDragOver);
elements.dropzone.addEventListener("dragleave", handleDragLeave);
elements.dropzone.addEventListener("drop", handleDrop);
elements.startReview.addEventListener("click", startReview);
elements.saveAiSettings.addEventListener("click", saveAiSettings);
elements.testAiSettings.addEventListener("click", testAiSettings);
elements.aiProviderInput.addEventListener("change", markAiSettingsUntested);
elements.apiKeyInput.addEventListener("input", markAiSettingsUntested);
elements.resetDemo.addEventListener("click", resetAll);
elements.problemForm.addEventListener("submit", addProblem);
elements.cancelEdit.addEventListener("click", closeCorrectionPanel);

elements.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveFilter(tab.dataset.filter);
    render();
  });
});

initializeApp();

async function initializeApp() {
  await migrateLegacyUploads();
  removeLegacyMockProblems();
  render();
}

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    return { uploads: [], problems: [], aiSettings: { ...defaultAiSettings } };
  }

  try {
    const parsed = JSON.parse(saved);
    return {
      uploads: parsed.uploads || [],
      problems: parsed.problems || [],
      aiSettings: {
        ...defaultAiSettings,
        ...(parsed.aiSettings || {})
      }
    };
  } catch {
    return { uploads: [], problems: [], aiSettings: { ...defaultAiSettings } };
  }
}

function saveState() {
  const savedState = {
    ...state,
    uploads: state.uploads.map(stripUploadForState)
  };
  localStorage.setItem(storageKey, JSON.stringify(savedState));
}

async function handleFiles(event) {
  await addUploadFiles(event.target.files);
  event.target.value = "";
}

function handleDragOver(event) {
  event.preventDefault();
  elements.dropzone.classList.add("is-dragging");
}

function handleDragLeave() {
  elements.dropzone.classList.remove("is-dragging");
}

async function handleDrop(event) {
  event.preventDefault();
  elements.dropzone.classList.remove("is-dragging");
  await addUploadFiles(event.dataTransfer.files);
}

async function addUploadFiles(fileList) {
  const files = Array.from(fileList || []).filter(isAcceptedUpload);
  if (files.length === 0) {
    setUploadStatus("选一张作业照片就可以。", "error");
    return;
  }

  setUploadStatus(`正在收好 ${files.length} 张作业...`, "working");
  let savedCount = 0;

  try {
    for (const file of files) {
      const upload = {
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type || guessFileType(file.name),
        subject: elements.subjectInput.value,
        size: file.size,
        createdAt: new Date().toISOString()
      };

      await saveUploadFile(upload, file);
      state.uploads.unshift(upload);
      savedCount += 1;
    }

    saveState();
    render();
    setUploadStatus(`拍好啦：${savedCount} 份。先连接自己的 AI，再开始批改。`, "success");
  } catch (error) {
    console.error(error);
    setUploadStatus("这次没拍进去。换一张更清楚的照片再试。", "error");
  }
}

function startReview() {
  if (state.uploads.length === 0) {
    setReviewStatus("先拍一份作业，再开始批改。", "error");
    return;
  }

  const unreviewedUploads = state.uploads.filter((upload) => !upload.reviewedAt);
  if (unreviewedUploads.length === 0) {
    setReviewStatus("这些作业已经批改过了。", "info");
    return;
  }

  const settings = normalizeAiSettings(state.aiSettings);
  if (!settings.apiKey) {
    setReviewStatus(`先连接自己的 ${providerLabels[settings.provider]} API，再开始批改。`, "error");
    return;
  }
  if (settings.connectionStatus !== "connected") {
    setReviewStatus("先点“测试连接”完成本地检查。真实 API 测试需要接后端。", "error");
    return;
  }

  setReviewStatus(buildReviewIntegrationMessage(settings), "info");
}

async function resetAll() {
  state = { uploads: [], problems: [], aiSettings: { ...defaultAiSettings } };
  await clearUploadFiles();
  revokeUploadUrls();
  saveState();
  render();
}

function addProblem(event) {
  event.preventDefault();
  const question = elements.questionInput.value.trim();
  if (!question) {
    elements.questionInput.focus();
    return;
  }

  const payload = {
    question,
    childAnswer: elements.childAnswerInput.value.trim() || defaultChildAnswer(elements.resultInput.value),
    correctAnswer: elements.correctAnswerInput.value.trim() || "等会儿再看",
    result: elements.resultInput.value,
    subject: elements.problemSubjectInput.value,
    topic: elements.topicInput.value.trim() || "还没分",
    explanation: elements.explanationInput.value.trim() || "这里还没有写想法。",
    retryResult: elements.resultInput.value === "correct" ? "not-needed" : "",
    understood: elements.resultInput.value === "correct"
  };

  if (editingId) {
    updateProblem(editingId, payload);
    editingId = null;
    closeCorrectionPanel();
  } else {
    state.problems.unshift({
      id: crypto.randomUUID(),
      ...payload,
      archived: false,
      createdAt: new Date().toISOString()
    });
  }

  elements.problemForm.reset();
  elements.problemSubjectInput.value = elements.subjectInput.value;
  saveState();
  render();
}

function render() {
  renderUploads();
  renderProblems();
  renderStats();
  renderReviewAction();
  renderAiSettings();
}

function renderAiSettings() {
  const settings = normalizeAiSettings({
    ...state.aiSettings,
    reviewMode: "custom",
    provider: elements.aiProviderInput.value || state.aiSettings?.provider
  });
  elements.reviewModeInput.value = settings.reviewMode;
  elements.aiProviderInput.value = settings.provider;
  elements.apiKeyInput.value = settings.apiKey;
  elements.customAiFields.hidden = false;
}

function saveAiSettings() {
  const previous = normalizeAiSettings(state.aiSettings);
  const settings = normalizeAiSettings({
    reviewMode: "custom",
    provider: elements.aiProviderInput.value,
    apiKey: elements.apiKeyInput.value.trim()
  });
  if (settings.provider !== previous.provider || settings.apiKey !== previous.apiKey) {
    settings.connectionStatus = "untested";
    settings.testedAt = "";
  }
  state.aiSettings = settings;
  saveState();
  renderAiSettings();
  renderReviewAction();
  renderAiSettingsStatus();
}

async function testAiSettings() {
  const settings = normalizeAiSettings({
    reviewMode: "custom",
    provider: elements.aiProviderInput.value,
    apiKey: elements.apiKeyInput.value.trim(),
    connectionStatus: "testing",
    testedAt: ""
  });

  state.aiSettings = settings;
  saveState();
  renderReviewAction();
  renderAiSettingsStatus("正在检查设置...");

  await waitForConnectionTest();

  if (!settings.apiKey) {
    state.aiSettings = {
      ...settings,
      connectionStatus: "failed",
      testedAt: new Date().toISOString()
    };
    saveState();
    renderReviewAction();
    renderAiSettingsStatus("没有填 API Key，连接失败。");
    return;
  }

  state.aiSettings = {
    ...settings,
    connectionStatus: "connected",
    testedAt: new Date().toISOString()
  };
  saveState();
  renderReviewAction();
  renderAiSettingsStatus();
}

function markAiSettingsUntested() {
  const settings = normalizeAiSettings(state.aiSettings);
  if (settings.connectionStatus === "untested") return;
  state.aiSettings = {
    ...settings,
    provider: elements.aiProviderInput.value,
    apiKey: elements.apiKeyInput.value.trim(),
    connectionStatus: "untested",
    testedAt: ""
  };
  saveState();
  renderReviewAction();
  renderAiSettingsStatus("设置改过了，需要重新测试连接。原型会先做本地检查。");
}

function renderAiSettingsStatus(message) {
  if (message) {
    elements.aiSettingsStatus.textContent = message;
    return;
  }

  const settings = normalizeAiSettings(state.aiSettings);
  if (!settings.apiKey) {
    elements.aiSettingsStatus.textContent = "还没有填 API Key，暂时不能批改。";
    return;
  }
  if (settings.connectionStatus === "connected") {
    elements.aiSettingsStatus.textContent = `${providerLabels[settings.provider]} 设置已通过本地检查。真实连接测试需要接后端。`;
    return;
  }
  if (settings.connectionStatus === "failed") {
    elements.aiSettingsStatus.textContent = `${providerLabels[settings.provider]} 连接失败，请检查 API Key。`;
    return;
  }
  if (settings.connectionStatus === "testing") {
    elements.aiSettingsStatus.textContent = "正在检查设置...";
    return;
  }
  elements.aiSettingsStatus.textContent = "已保存。请测试连接；原型先做本地检查，真实 API 测试要接后端。";
}

function renderReviewAction() {
  const hasUploads = state.uploads.length > 0;
  const hasUnreviewedUploads = state.uploads.some((upload) => !upload.reviewedAt);
  const settings = normalizeAiSettings(state.aiSettings);
  const canReview = Boolean(settings.apiKey) && settings.connectionStatus === "connected";
  elements.startReview.disabled = !hasUploads || !hasUnreviewedUploads || !canReview;
  if (!settings.apiKey) {
    elements.startReview.textContent = "先连接 AI";
    return;
  }
  if (settings.connectionStatus !== "connected") {
    elements.startReview.textContent = "先测试连接";
    return;
  }
  elements.startReview.textContent = hasUnreviewedUploads ? "开始批改" : "已完成批改";
}

async function renderUploads() {
  elements.uploadPreview.innerHTML = "";
  if (state.uploads.length === 0) {
    return;
  }

  for (const upload of state.uploads) {
    const item = document.createElement("div");
    item.className = "preview-item";
    if (upload.type.startsWith("image/")) {
      try {
        const image = document.createElement("img");
        image.src = await getUploadObjectUrl(upload);
        image.alt = upload.name;
        item.append(image);
      } catch {
        const fileBadge = document.createElement("div");
        fileBadge.className = "file-badge";
        fileBadge.textContent = "图片";
        item.append(fileBadge);
      }
    } else {
      const fileBadge = document.createElement("div");
      fileBadge.className = "file-badge";
      fileBadge.textContent = upload.type === "application/pdf" ? "材料" : "文件";
      item.append(fileBadge);
    }

    const name = document.createElement("span");
    const reviewText = upload.reviewedAt ? " · 已批改" : "";
    name.textContent = `${upload.subject || "未分学科"} · ${upload.name}${upload.size ? ` · ${formatFileSize(upload.size)}` : ""}${reviewText}`;
    item.append(name);
    const removeButton = document.createElement("button");
    removeButton.className = "remove-upload-button";
    removeButton.type = "button";
    removeButton.textContent = "拿掉";
    removeButton.addEventListener("click", async () => {
      await deleteUpload(upload.id);
    });
    item.append(removeButton);
    elements.uploadPreview.append(item);
  }
}

function renderProblems() {
  elements.problemList.innerHTML = "";
  const visibleProblems = state.problems.filter((problem) => {
    const normalized = normalizeProblem(problem);
    if (activeFilter === "wrongArchive") return normalized.archived && normalized.result === "wrong";
    if (activeFilter === "blankArchive") return normalized.archived && normalized.result === "blank";
    if (activeFilter === "wrong") return normalized.result === "wrong";
    if (activeFilter === "blank") return normalized.result === "blank";
    if (activeFilter === "correct") return normalized.result === "correct";
    return normalized.result !== "correct";
  });

  if (visibleProblems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "这里还空着。先拍一份作业，小诺整理好以后会放在这里。";
    elements.problemList.append(empty);
    return;
  }

  visibleProblems.forEach((rawProblem) => {
    const problem = normalizeProblem(rawProblem);
    const node = elements.problemTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector("h3").textContent = problem.question;
    node.querySelector(".subject").textContent = problem.subject;
    node.querySelector(".child-answer").textContent = problem.childAnswer;
    node.querySelector(".correct-answer").textContent = problem.correctAnswer;
    node.querySelector(".topic").textContent = problem.topic;
    const explanation = node.querySelector(".explanation");
    const methodTitle = document.createElement("strong");
    methodTitle.textContent = "解题方法";
    const methodText = document.createElement("p");
    methodText.textContent = problem.explanation;
    explanation.replaceChildren(methodTitle, methodText);
    node.querySelector(".redo-note").textContent = buildRedoNote(problem);

    const badge = node.querySelector(".status-badge");
    badge.textContent = statusLabel(problem);
    badge.classList.add(statusClass(problem));

    const redoPanel = node.querySelector(".redo-panel");
    const similarButton = node.querySelector(".similar-button");
    const similarBox = node.querySelector(".similar-box");
    const similarQuestion = node.querySelector(".similar-question");
    const redoPassButton = node.querySelector(".redo-pass-button");
    const redoFailButton = node.querySelector(".redo-fail-button");
    redoPanel.hidden = problem.result === "correct";
    similarQuestion.textContent = problem.similarQuestion || "";
    similarBox.hidden = !problem.similarQuestion;
    similarButton.textContent = problem.similarQuestion ? "换一道相似题" : "出一道相似题";
    similarButton.addEventListener("click", () => {
      updateProblem(problem.id, {
        similarQuestion: buildSimilarQuestion(problem),
        retryResult: "",
        understood: false,
        archived: false
      });
    });
    redoPassButton.addEventListener("click", () => {
      updateProblem(problem.id, {
        retryResult: "passed",
        understood: true
      });
    });
    redoFailButton.addEventListener("click", () => {
      updateProblem(problem.id, {
        retryResult: "failed",
        understood: false,
        archived: false
      });
    });

    const archiveButton = node.querySelector(".archive-button");
    archiveButton.textContent = archiveButtonLabel(problem);
    archiveButton.hidden = problem.result === "correct";
    archiveButton.disabled = problem.archived || !problem.understood;
    archiveButton.title = archiveButton.disabled && !problem.archived ? redoFirstHint(problem) : "";
    archiveButton.addEventListener("click", () => {
      updateProblem(problem.id, { archived: true });
    });

    node.querySelector(".edit-button").addEventListener("click", () => {
      editingId = problem.id;
      elements.questionInput.value = problem.question;
      elements.childAnswerInput.value = problem.childAnswer;
      elements.correctAnswerInput.value = problem.correctAnswer;
      elements.resultInput.value = problem.result;
      elements.problemSubjectInput.value = problem.subject;
      elements.topicInput.value = problem.topic;
      elements.explanationInput.value = problem.explanation;
      elements.saveProblemButton.textContent = "保存修改";
      elements.correctionPanel.hidden = false;
      elements.problemForm.scrollIntoView({ behavior: "smooth", block: "start" });
      elements.questionInput.focus();
    });

    node.querySelector(".delete-button").addEventListener("click", () => {
      state.problems = state.problems.filter((item) => item.id !== problem.id);
      saveState();
      render();
    });

    elements.problemList.append(node);
  });
}

function renderStats() {
  const problems = state.problems.map(normalizeProblem);
  const materials = state.uploads.length;
  const wrong = problems.filter((item) => item.result === "wrong").length;
  const blank = problems.filter((item) => item.result === "blank").length;
  const correct = problems.filter((item) => item.result === "correct").length;
  const archived = problems.filter((item) => item.archived).length;
  const reviewed = problems.length;
  const rate = reviewed ? Math.round((correct / reviewed) * 100) : 0;

  elements.totalCount.textContent = materials;
  elements.wrongCount.textContent = wrong + blank;
  elements.understoodCount.textContent = `${rate}%`;
  elements.correctRate.textContent = archived;
  elements.encouragement.textContent = buildEncouragement(materials, wrong, blank, correct, archived, problems);
  renderStageStats(problems);
}

function renderStageStats(problems) {
  elements.stageStats.innerHTML = "";
  const uploads = state.uploads.map(normalizeUpload);
  const subjects = Array.from(
    new Set([...uploads.map((item) => item.subject), ...problems.map((item) => item.subject)])
  ).filter(Boolean);

  if (subjects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "stage-empty";
    empty.textContent = "还没有可以看的变化。拍几天作业后，这里会慢慢亮起来。";
    elements.stageStats.append(empty);
    return;
  }

  subjects.forEach((subject) => {
    const currentUploads = uploads.filter((item) => item.subject === subject && isInDayRange(item.createdAt, 0, 6));
    const previousUploads = uploads.filter((item) => item.subject === subject && isInDayRange(item.createdAt, 7, 13));
    const currentProblems = problems.filter((item) => item.subject === subject && isInDayRange(item.createdAt, 0, 6));
    const previousProblems = problems.filter((item) => item.subject === subject && isInDayRange(item.createdAt, 7, 13));
    const current = summarizeStage(currentUploads, currentProblems);
    const previous = summarizeStage(previousUploads, previousProblems);

    const card = document.createElement("article");
    card.className = "stage-card";
    card.innerHTML = `
      <div class="stage-head">
        <strong>${subject}</strong>
        <span>最近 7 天</span>
      </div>
      <div class="stage-metrics">
        <div><b>${current.materials}</b><span>拍了</span></div>
        <div><b>${current.wrong}</b><span>错了</span></div>
        <div><b>${current.blank}</b><span>空着</span></div>
        <div><b>${current.fixed}</b><span>过关</span></div>
      </div>
      <p>${buildStageMessage(current, previous)}</p>
    `;
    elements.stageStats.append(card);
  });
}

function updateProblem(id, patch) {
  state.problems = state.problems.map((problem) =>
    problem.id === id ? { ...problem, ...patch } : problem
  );
  saveState();
  render();
}

function closeCorrectionPanel() {
  editingId = null;
  elements.correctionPanel.hidden = true;
  elements.problemForm.reset();
  elements.problemSubjectInput.value = elements.subjectInput.value;
  elements.saveProblemButton.textContent = "保存修改";
}

function normalizeAiSettings(settings = {}) {
  const normalized = {
    ...defaultAiSettings,
    ...settings
  };
  if (!providerLabels[normalized.provider]) {
    normalized.provider = defaultAiSettings.provider;
  }
  normalized.reviewMode = "custom";
  return normalized;
}

function buildReviewIntegrationMessage(settings) {
  return `已选择自己的 ${providerLabels[settings.provider]} API。下一步需要接后端代理，才能安全地把照片送去批改。`;
}

function waitForConnectionTest() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 500);
  });
}

function removeLegacyMockProblems() {
  const legacyMockQuestions = new Set([
    "阅读题：用一句话说清楚这段话主要讲了什么。",
    "词语题：把句子里的关键词找出来。",
    "计算题：先算括号，再算外面。",
    "应用题：先找题目问什么。",
    "基础题：同类方法的小题。"
  ]);
  const removedUploadIds = new Set();
  const remainingProblems = state.problems.filter((problem) => {
    if (!legacyMockQuestions.has(problem.question)) return true;
    if (problem.sourceUploadId) removedUploadIds.add(problem.sourceUploadId);
    return false;
  });

  if (remainingProblems.length === state.problems.length) return;

  state.problems = remainingProblems;
  state.uploads = state.uploads.map((upload) => {
    if (removedUploadIds.size > 0 && !removedUploadIds.has(upload.id)) return upload;
    return { ...upload, reviewedAt: "" };
  });
  saveState();
  setReviewStatus("旧的假批改结果已经清掉了。现在不会再凭空生成错题或空白题。", "info");
}

function setActiveFilter(filter) {
  activeFilter = filter;
  elements.tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.filter === filter);
  });
}

function setReviewStatus(message, tone = "info") {
  elements.reviewStatus.textContent = message;
  elements.reviewStatus.dataset.tone = tone;
}

function statusLabel(problem) {
  if (problem.result === "correct") return "做对了";
  if (problem.result === "blank" && problem.understood) return "补上了";
  if (problem.result === "blank" && problem.retryResult === "failed") return "还卡着";
  if (problem.result === "blank") return "空着";
  if (problem.understood) return "过关了";
  if (problem.retryResult === "failed") return "还要练";
  return "做错了";
}

function statusClass(problem) {
  if (problem.result === "correct") return "status-correct";
  if (problem.understood) return "status-understood";
  if (problem.retryResult === "failed") return "status-wrong";
  if (problem.result === "blank") return "status-blank";
  return "status-pending";
}

function buildEncouragement(materials, wrong, blank, correct, archived, problems) {
  const fixedWrong = problems.filter((item) => item.result === "wrong" && item.understood).length;
  const fixedBlank = problems.filter((item) => item.result === "blank" && item.understood).length;

  if (materials === 0 && wrong === 0 && blank === 0 && correct === 0) {
    return "先拍一张作业。拍进来以后，我们再一起看看哪里会了、哪里还卡着。";
  }

  if (blank > 0 && fixedBlank === 0) {
    return `有 ${blank} 道题空着。空着也很有用，它在告诉我们：可能是没读懂，可能是没想起第一步。`;
  }

  if (wrong === 0 && blank === 0 && correct > 0) {
    return `今天有 ${correct} 道做对了。这些地方已经很稳，可以好好表扬。`;
  }

  if (wrong + blank > 0 && fixedWrong === wrong && fixedBlank === blank) {
    return `做错和空着的题都过关了，${archived} 道已经收好。过几天再抽一题看看还记不记得。`;
  }

  if (fixedWrong + fixedBlank > 0) {
    return `已经有 ${fixedWrong + fixedBlank} 道题过关了。做错和空着分开看，会更清楚哪里在变好。`;
  }

  return "做错的看哪一步错，空着的先看为什么没开始。慢慢来，一次过一关。";
}

function normalizeProblem(problem) {
  const wasFixed = problem.result === "fixed";
  return {
    ...problem,
    subject: problem.subject || "数学",
    result: wasFixed ? "wrong" : problem.result,
    retryResult: problem.retryResult || (problem.understood || wasFixed ? "passed" : "")
  };
}

function normalizeUpload(upload) {
  return {
    ...upload,
    subject: upload.subject || "数学",
    createdAt: upload.createdAt || new Date().toISOString()
  };
}

function summarizeStage(uploads, problems) {
  return {
    materials: uploads.length,
    reviewed: problems.length,
    wrong: problems.filter((item) => item.result === "wrong").length,
    blank: problems.filter((item) => item.result === "blank").length,
    correct: problems.filter((item) => item.result === "correct").length,
    fixed: problems.filter((item) => item.result !== "correct" && item.understood).length
  };
}

function buildStageMessage(current, previous) {
  const currentNeeds = current.wrong + current.blank;
  const previousNeeds = previous.wrong + previous.blank;

  if (current.materials === 0 && current.reviewed === 0) {
    return "这几天还没有记录。";
  }

  if (current.blank > 0) {
    return `${current.blank} 道题空着，先找“第一步”在哪里。`;
  }

  if (previous.reviewed > 0 && currentNeeds < previousNeeds) {
    return `要再练的题从 ${previousNeeds} 道变成 ${currentNeeds} 道，变少了。`;
  }

  if (current.fixed > 0) {
    return `${current.fixed} 道已经过关，方法开始接上了。`;
  }

  if (current.correct > 0 && currentNeeds === 0) {
    return "这几天做对的多，可以给一个大大的肯定。";
  }

  return "再多拍几天，就能看到这个学科的变化。";
}

function isInDayRange(value, minDaysAgo, maxDaysAgo) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diff = Math.floor((today - target) / 86400000);
  return diff >= minDaysAgo && diff <= maxDaysAgo;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function buildRedoNote(problem) {
  if (problem.result === "correct") {
    return "这题已经做对，不用再练。";
  }

  if (problem.result === "blank" && problem.understood) {
    return "相似题补上并做对了，可以放进空白盒。";
  }

  if (problem.result === "blank" && problem.retryResult === "failed") {
    return "相似题还卡着，先留在空白题里继续练。";
  }

  if (problem.result === "blank") {
    return "先看正确答案和方法，再出一道相似题补上。";
  }

  if (problem.understood) {
    return "相似题做对了，这关过了。";
  }

  if (problem.retryResult === "failed") {
    return "相似题还没过，先留着继续练。";
  }

  return "先看正确答案和方法，再出一道相似题。做对了就过关。";
}

function buildSimilarQuestion(problem) {
  const topic = problem.topic || "";

  if (topic.includes("阅读") || topic.includes("概括")) {
    return "读一小段话后，用一句话回答：谁做了什么，结果怎样？";
  }

  if (topic.includes("关键词")) {
    return "读一句话，圈出最能说明意思的词，再说说为什么圈它。";
  }

  if (topic.includes("审题") || topic.includes("应用")) {
    return "一道相似应用题：先圈出已知条件和问题，再写第一步算式。";
  }

  if (topic.includes("计算") || topic.includes("顺序")) {
    return "同类计算题：先算括号里的部分，再算外面的部分。";
  }

  if (problem.result === "blank") {
    return `${topic || "这类题"}：先说第一步要做什么，再把答案补完整。`;
  }

  return `${topic || "这类题"}：换一个数字或句子，用同样方法再做一遍。`;
}

function defaultChildAnswer(result) {
  return result === "blank" ? "空着没写" : "还没写";
}

function archiveButtonLabel(problem) {
  const target = problem.result === "blank" ? "空白盒" : "错题盒";
  return problem.archived ? `已放进${target}` : `放进${target}`;
}

function redoFirstHint(problem) {
  return problem.result === "blank" ? "补上并做对后再放进空白盒" : "再做对后再放进错题盒";
}

async function migrateLegacyUploads() {
  const legacyUploads = state.uploads.filter((upload) => upload.dataUrl);
  if (legacyUploads.length === 0) return;

  try {
    for (const upload of legacyUploads) {
      const response = await fetch(upload.dataUrl);
      const blob = await response.blob();
      await saveUploadFile(upload, blob);
    }
    state.uploads = state.uploads.map(stripUploadForState);
    saveState();
  } catch (error) {
    console.error(error);
    setUploadStatus("有旧照片暂时没搬好。重新拍一张会更稳。", "error");
  }
}

function stripUploadForState(upload) {
  const normalized = normalizeUpload(upload);
  return {
    id: normalized.id,
    name: normalized.name,
    type: normalized.type || guessFileType(normalized.name),
    subject: normalized.subject,
    size: normalized.size || 0,
    createdAt: normalized.createdAt,
    reviewedAt: normalized.reviewedAt || ""
  };
}

function setUploadStatus(message, tone = "info") {
  elements.uploadStatus.textContent = message;
  elements.uploadStatus.dataset.tone = tone;
}

function isAcceptedUpload(file) {
  return (
    file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    /\.(png|jpe?g|webp|gif|heic|heif|pdf)$/i.test(file.name)
  );
}

function guessFileType(fileName) {
  if (/\.(png|jpe?g|webp|gif|heic|heif)$/i.test(fileName)) return "image/*";
  return /\.pdf$/i.test(fileName) ? "application/pdf" : "application/octet-stream";
}

function formatFileSize(size) {
  if (!size) return "已保存";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function openUploadDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser does not support IndexedDB."));
      return;
    }

    const request = indexedDB.open(uploadDbName, 1);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(uploadStoreName)) {
        db.createObjectStore(uploadStoreName, { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function withUploadStore(mode, callback) {
  return openUploadDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(uploadStoreName, mode);
        const store = transaction.objectStore(uploadStoreName);
        const request = callback(store);

        request?.addEventListener("success", () => resolve(request.result));
        request?.addEventListener("error", () => reject(request.error));
        transaction.addEventListener("complete", () => {
          db.close();
          if (!request) resolve();
        });
        transaction.addEventListener("error", () => {
          db.close();
          reject(transaction.error);
        });
      })
  );
}

function saveUploadFile(upload, file) {
  return withUploadStore("readwrite", (store) =>
    store.put({
      ...stripUploadForState(upload),
      file
    })
  );
}

function getUploadFile(id) {
  return withUploadStore("readonly", (store) => store.get(id));
}

async function getUploadObjectUrl(upload) {
  if (upload.dataUrl) return upload.dataUrl;
  if (uploadObjectUrls.has(upload.id)) return uploadObjectUrls.get(upload.id);

  const stored = await getUploadFile(upload.id);
  if (!stored?.file) return "";

  const url = URL.createObjectURL(stored.file);
  uploadObjectUrls.set(upload.id, url);
  return url;
}

async function deleteUpload(id) {
  await withUploadStore("readwrite", (store) => store.delete(id));
  const url = uploadObjectUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  uploadObjectUrls.delete(id);
  state.uploads = state.uploads.filter((upload) => upload.id !== id);
  saveState();
  render();
  setUploadStatus("已经拿掉这份材料。", "success");
}

function clearUploadFiles() {
  return withUploadStore("readwrite", (store) => store.clear()).catch(() => undefined);
}

function revokeUploadUrls() {
  uploadObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  uploadObjectUrls.clear();
}
