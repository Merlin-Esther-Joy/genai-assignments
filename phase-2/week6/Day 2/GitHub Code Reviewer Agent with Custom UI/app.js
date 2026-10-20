const analyzerInput = document.querySelector("#github-file-url");
const analyzerForm = document.querySelector(".analyzer-form");
const reviewButton = document.querySelector(".review-button");
const reviewButtonLabel = reviewButton.querySelector("span");
const workspace = document.querySelector(".workspace-card");
const waitingScreen = document.querySelector(".workspace-waiting");
const loadingScreen = document.querySelector(".workspace-loading");
const loadingStatus = document.querySelector("#loading-status-text");
const report = document.querySelector("#workspace-report");
const workspaceError = document.querySelector("#workspace-error");
const formError = document.querySelector("#form-error");
const completionBadge = document.querySelector("#completion-badge");
const reviewWebhookUrl = "http://localhost:5678/webhook/code_reviewer";
const progressMessages = [
  "Reading Code...",
  "Contacting Github API...",
  "Evaluating description clarity...",
  "Synthesizing recommendations...",
];
let progressTimer;

function setFormError(message) {
  formError.textContent = message;
  formError.hidden = !message;
  analyzerInput.setAttribute("aria-invalid", message ? "true" : "false");
}

function clearWorkspaceError() {
  workspaceError.textContent = "";
  workspaceError.hidden = true;
  workspace.classList.remove("is-error");
}

function shakeWorkspace() {
  workspace.classList.remove("is-error");
  void workspace.offsetWidth;
  workspace.classList.add("is-error");
}

function showWorkspaceError(message) {
  workspace.classList.remove("is-loading");
  workspace.classList.add("is-error");
  loadingScreen.hidden = true;
  waitingScreen.hidden = true;
  report.hidden = true;
  workspaceError.textContent = message;
  workspaceError.hidden = false;
}

function setAnalyzing(isAnalyzing) {
  analyzerInput.disabled = isAnalyzing;
  reviewButton.disabled = isAnalyzing;
  reviewButtonLabel.textContent = isAnalyzing ? "Analyzing..." : "Review Code";
}

function extractMarkdown(value, depth = 0) {
  if (depth > 12 || value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = extractMarkdown(item, depth + 1);
      if (result) {
        return result;
      }
    }
    return "";
  }

  if (typeof value === "object") {
    const preferredKeys = ["markdown", "analysis", "review", "result", "output", "response", "content", "text", "body", "data"];
    for (const key of preferredKeys) {
      if (key in value) {
        const result = extractMarkdown(value[key], depth + 1);
        if (result) {
          return result;
        }
      }
    }

    for (const nestedValue of Object.values(value)) {
      const result = extractMarkdown(nestedValue, depth + 1);
      if (result) {
        return result;
      }
    }
  }

  return "";
}

function startLoading() {
  let messageIndex = 0;
  loadingStatus.textContent = progressMessages[messageIndex];
  progressTimer = window.setInterval(() => {
    messageIndex = (messageIndex + 1) % progressMessages.length;
    loadingStatus.textContent = progressMessages[messageIndex];
  }, 1500);

  waitingScreen.hidden = true;
  report.hidden = true;
  workspaceError.hidden = true;
  loadingScreen.hidden = false;
  workspace.classList.remove("is-error");
  workspace.classList.add("is-loading");
}

function stopLoading() {
  window.clearInterval(progressTimer);
  progressTimer = undefined;
}

function appendInlineMarkdown(parent, text) {
  const boldPattern = /(\*\*|__)(.+?)\1/g;
  let position = 0;
  let match;

  while ((match = boldPattern.exec(text)) !== null) {
    parent.append(document.createTextNode(text.slice(position, match.index)));
    const strong = document.createElement("strong");
    strong.textContent = match[2];
    parent.append(strong);
    position = boldPattern.lastIndex;
  }

  parent.append(document.createTextNode(text.slice(position)));
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isBlockStart(lines, index) {
  const line = lines[index];
  return (
    /^#{1,6}\s+/.test(line) ||
    /^```/.test(line) ||
    /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line) ||
    (index + 1 < lines.length &&
      line.includes("|") &&
      lines[index + 1].includes("|") &&
      isTableSeparator(lines[index + 1]))
  );
}

function renderTable(lines, startIndex) {
  const table = document.createElement("table");
  table.className = "report-table";
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");

  for (const cell of splitTableRow(lines[startIndex])) {
    const header = document.createElement("th");
    header.scope = "col";
    appendInlineMarkdown(header, cell);
    headerRow.append(header);
  }

  head.append(headerRow);
  table.append(head);

  const body = document.createElement("tbody");
  let index = startIndex + 2;

  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    const row = document.createElement("tr");
    for (const cell of splitTableRow(lines[index])) {
      const tableCell = document.createElement("td");
      appendInlineMarkdown(tableCell, cell);
      row.append(tableCell);
    }
    body.append(row);
    index += 1;
  }

  table.append(body);
  const wrapper = document.createElement("div");
  wrapper.className = "report-table-wrap";
  wrapper.append(table);
  return { element: wrapper, nextIndex: index };
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const fragment = document.createDocumentFragment();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([\w#+.-]*)\s*$/);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }

      const pre = document.createElement("pre");
      pre.className = "report-code-block";
      if (fence[1]) {
        const language = document.createElement("span");
        language.className = "report-code-language";
        language.textContent = fence[1];
        pre.append(language);
      }
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.append(code);
      fragment.append(pre);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      appendInlineMarkdown(element, heading[2]);
      fragment.append(element);
      index += 1;
      continue;
    }

    if (
      index + 1 < lines.length &&
      line.includes("|") &&
      lines[index + 1].includes("|") &&
      isTableSeparator(lines[index + 1])
    ) {
      const table = renderTable(lines, index);
      fragment.append(table.element);
      index = table.nextIndex;
      continue;
    }

    const listMatch = line.match(/^\s*(?:([-*+])|(\d+[.)]))\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const list = document.createElement(ordered ? "ol" : "ul");

      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:([-*+])|(\d+[.)]))\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) {
          break;
        }
        const listItem = document.createElement("li");
        appendInlineMarkdown(listItem, item[3]);
        list.append(listItem);
        index += 1;
      }

      fragment.append(list);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, paragraphLines.join(" "));
    fragment.append(paragraph);
  }

  return fragment;
}

function showAnalysisComplete(markdown) {
  report.replaceChildren(renderMarkdown(markdown));
  report.classList.remove("workspace-report--visible");
  waitingScreen.hidden = true;
  loadingScreen.hidden = true;
  workspaceError.hidden = true;
  clearWorkspaceError();
  workspace.classList.remove("is-loading", "is-error");
  report.hidden = false;

  completionBadge.hidden = false;
  completionBadge.classList.remove("completion-badge--visible");
  void completionBadge.offsetWidth;
  completionBadge.classList.add("completion-badge--visible");
  void report.offsetWidth;
  report.classList.add("workspace-report--visible");

  setFormError("");
  setAnalyzing(false);
}

analyzerInput.addEventListener("input", () => {
  if (analyzerInput.value.trim()) {
    setFormError("");
  }
});

analyzerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = analyzerInput.value.trim();

  if (!url) {
    setFormError("Enter a GitHub file URL before starting the review.");
    clearWorkspaceError();
    shakeWorkspace();
    analyzerInput.focus();
    return;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("URL must use HTTP or HTTPS.");
    }
  } catch {
    setFormError("Enter a valid GitHub file URL.");
    clearWorkspaceError();
    shakeWorkspace();
    analyzerInput.focus();
    return;
  }

  setFormError("");
  completionBadge.hidden = true;
  report.hidden = true;
  clearWorkspaceError();
  setAnalyzing(true);
  startLoading();

  try {
    const response = await fetch(reviewWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      throw new Error(`The review service returned HTTP ${response.status}.`);
    }

    const responseText = await response.text();
    let responseData = responseText;
    if (responseText.trim()) {
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }
    }

    const markdown = extractMarkdown(responseData);
    if (!markdown) {
      throw new Error("The review service returned an empty or unsupported result.");
    }

    stopLoading();
    window.dispatchEvent(new CustomEvent("code-review:complete", { detail: { markdown } }));
  } catch (error) {
    stopLoading();
    setAnalyzing(false);
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    showWorkspaceError(`Unable to complete the code review. ${message} Check that the local review service is running and try again.`);
  }
});

window.addEventListener("code-review:complete", (event) => {
  const markdown = event.detail?.markdown;
  if (typeof markdown !== "string") {
    console.error('The "code-review:complete" event requires detail.markdown to be a string.');
    return;
  }
  stopLoading();
  showAnalysisComplete(markdown);
});
