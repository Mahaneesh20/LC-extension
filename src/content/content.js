(function () {
  var C = globalThis.LEET_TRACKER || {};
  var lastSubmissionSignalAt = 0;
  var lastAcceptedDedupeKey = "";
  var domObserver = null;
  var manualButtonId = "leet-sheet-upload-btn";

  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function getProblemSlugFromUrl() {
    var match = location.pathname.match(/^\/problems\/([^/]+)/);
    return match ? match[1] : "";
  }

  function getProblemTitle() {
    var candidates = document.querySelectorAll("h1, [data-cy='question-title'], a[href*='/problems/']");
    for (var i = 0; i < candidates.length; i += 1) {
      var text = normalizeText(candidates[i].textContent);
      if (text && text.length > 2 && text.length < 180) {
        return text;
      }
    }
    return getProblemSlugFromUrl();
  }

  function getDifficulty() {
    var nodes = document.querySelectorAll("span, div, p");
    for (var i = 0; i < nodes.length; i += 1) {
      var text = normalizeText(nodes[i].textContent);
      if (text === "Easy" || text === "Medium" || text === "Hard") {
        return text;
      }
    }
    return "";
  }

  function extractMetric(metricName) {
    var bodyText = normalizeText(document.body ? document.body.innerText : "");
    var regex = new RegExp(metricName + "\\s*:?\\s*([^\\n]+?)\\s*(?:Beat|$)", "i");
    var match = bodyText.match(regex);
    return match ? normalizeText(match[1]).slice(0, 80) : "";
  }

  function buildEventPayload(source) {
    var slug = getProblemSlugFromUrl();
    var timestamp = new Date().toISOString();
    var runtime = extractMetric("Runtime");
    var memory = extractMetric("Memory");
    var title = getProblemTitle();
    var difficulty = getDifficulty();

    var timeBucket = Math.floor(Date.now() / (C.DEDUPE_WINDOW_MS || 120000));
    var dedupeKey = [slug, runtime, memory, timeBucket].join("|");

    return {
      source: source,
      title: title,
      slug: slug,
      url: slug ? "https://leetcode.com/problems/" + slug + "/" : location.href,
      difficulty: difficulty,
      runtime: runtime,
      memory: memory,
      timestamp: timestamp,
      dedupeKey: dedupeKey
    };
  }

  function sendAcceptedEvent(source, forceSend) {
    var payload = buildEventPayload(source);
    if (!payload.slug) {
      return;
    }

    if (forceSend) {
      payload.dedupeKey = payload.dedupeKey + "|manual|" + Date.now();
    }

    if (!forceSend && payload.dedupeKey === lastAcceptedDedupeKey) {
      return;
    }

    lastAcceptedDedupeKey = payload.dedupeKey;

    chrome.runtime.sendMessage(
      {
        type: C.MESSAGE_ACCEPTED || "leetcode-accepted-event",
        payload: payload
      },
      function () {
        void chrome.runtime.lastError;
      }
    );
  }

  function setManualButtonState(button, label) {
    if (!button) {
      return;
    }

    button.textContent = label;
  }

  function findLeetHubButton() {
    var buttons = document.querySelectorAll("button, a[role='button']");
    for (var i = 0; i < buttons.length; i += 1) {
      var text = normalizeText(buttons[i].textContent).toLowerCase();
      if (text.indexOf("leethub") >= 0 || text.indexOf("sync w/") >= 0) {
        return buttons[i];
      }
    }
    return null;
  }

  function createManualUploadButton() {
    var button = document.createElement("button");
    button.id = manualButtonId;
    button.type = "button";
    button.textContent = "Upload to Sheet";
    button.style.marginLeft = "8px";
    button.style.padding = "8px 12px";
    button.style.border = "0";
    button.style.borderRadius = "8px";
    button.style.fontWeight = "600";
    button.style.cursor = "pointer";
    button.style.background = "#1f6feb";
    button.style.color = "#ffffff";

    button.addEventListener("click", function () {
      setManualButtonState(button, "Uploading...");
      sendAcceptedEvent("manual", true);
      setTimeout(function () {
        setManualButtonState(button, "Uploaded");
      }, 200);
      setTimeout(function () {
        setManualButtonState(button, "Upload to Sheet");
      }, 1800);
    });

    return button;
  }

  function ensureManualUploadButton() {
    var existing = document.getElementById(manualButtonId);
    if (existing) {
      return;
    }

    var leetHubButton = findLeetHubButton();
    if (!leetHubButton || !leetHubButton.parentElement) {
      return;
    }

    var button = createManualUploadButton();
    leetHubButton.parentElement.insertBefore(button, leetHubButton.nextSibling);
  }

  function looksLikeAcceptedGraphqlResponse(responseJson) {
    if (!responseJson || !responseJson.data) {
      return false;
    }

    var data = responseJson.data;
    if (data.submissionDetails && String(data.submissionDetails.statusDisplay).toLowerCase() === "accepted") {
      return true;
    }

    if (data.submissionDetail && String(data.submissionDetail.statusDisplay).toLowerCase() === "accepted") {
      return true;
    }

    if (data.checkSubmissionResult && String(data.checkSubmissionResult.statusMsg).toLowerCase() === "accepted") {
      return true;
    }

    return false;
  }

  function looksLikeSubmitRequest(requestBodyText) {
    var text = (requestBodyText || "").toLowerCase();
    return text.indexOf("submit") >= 0 || text.indexOf("submission") >= 0;
  }

  function attachGraphqlListener() {
    return;
  }

  function injectNetworkProbe() {
    return;
  }

  function hasVisibleAcceptedMarker() {
    var candidates = document.querySelectorAll("span, div, h2, h3");
    for (var i = 0; i < candidates.length; i += 1) {
      var text = normalizeText(candidates[i].textContent);
      if (text === "Accepted") {
        return true;
      }
    }
    return false;
  }

  function attachDomFallback() {
    var check = function () {
      var recentSubmit = Date.now() - lastSubmissionSignalAt < 10 * 60 * 1000;
      ensureManualUploadButton();
      if (recentSubmit && hasVisibleAcceptedMarker()) {
        sendAcceptedEvent("dom");
      }
    };

    domObserver = new MutationObserver(function () {
      check();
    });

    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: false
    });

    setInterval(check, 4000);
  }

  function init() {
    lastSubmissionSignalAt = Date.now();
    injectNetworkProbe();
    attachGraphqlListener();
    attachDomFallback();
    ensureManualUploadButton();
  }

  init();
})();
