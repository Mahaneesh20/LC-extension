(function () {
  var C = globalThis.LEET_TRACKER || {};

  var elements = {
    enabled: document.getElementById("enabled"),
    username: document.getElementById("username"),
    endpointUrl: document.getElementById("endpointUrl"),
    fields: document.getElementById("fields"),
    saveBtn: document.getElementById("saveBtn"),
    statusBox: document.getElementById("statusBox"),
    statusText: document.getElementById("statusText"),
    queueText: document.getElementById("queueText"),
    sheetNamePreview: document.getElementById("sheetNamePreview")
  };

  function defaultSettings() {
    return {
      enabled: true,
      username: "",
      endpointUrl: "",
      fields: C.DEFAULT_FIELDS || ["title", "url", "difficulty", "runtime", "memory", "timestamp"]
    };
  }

  function sanitizeSheetName(value) {
    var text = (value || "").trim();
    if (!text) {
      text = "default-user";
    }

    text = text.replace(/[\\/\[\]:*?]/g, "-").replace(/\s+/g, " ");
    if (text.length > 90) {
      text = text.slice(0, 90).trim();
    }

    return text || "default-user";
  }

  function isValidHttpUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  function renderFieldCheckboxes(selectedFields) {
    elements.fields.innerHTML = "";

    var labels = C.FIELD_LABELS || {};
    Object.keys(labels).forEach(function (field) {
      var label = document.createElement("label");
      label.className = "checkbox-card";

      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = field;
      input.checked = selectedFields.indexOf(field) >= 0;

      var text = document.createElement("span");
      text.textContent = labels[field];

      label.appendChild(input);
      label.appendChild(text);
      elements.fields.appendChild(label);
    });
  }

  function collectSelectedFields() {
    var checked = elements.fields.querySelectorAll("input[type='checkbox']:checked");
    var out = [];
    checked.forEach(function (box) {
      out.push(box.value);
    });
    return out;
  }

  async function readSettings() {
    var key = C.SETTINGS_KEY || "leetTrackerSettings";
    var syncRaw = await chrome.storage.sync.get([key]);
    var localRaw = await chrome.storage.local.get([key]);
    return Object.assign(defaultSettings(), localRaw[key] || {}, syncRaw[key] || {});
  }

  async function writeSettings(settings) {
    var key = C.SETTINGS_KEY || "leetTrackerSettings";
    var payload = {};
    payload[key] = settings;
    await chrome.storage.sync.set(payload);
    await chrome.storage.local.set(payload);
  }

  function setStatus(message, ok) {
    elements.statusText.textContent = message;
    elements.statusText.classList.remove("ok", "err");
    elements.statusText.classList.add(ok ? "ok" : "err");
  }

  function refreshSheetPreview() {
    var sheetName = sanitizeSheetName(elements.username.value);
    elements.sheetNamePreview.textContent = sheetName;
  }

  async function refreshStatus() {
    var keys = [C.STATUS_KEY || "leetTrackerLastStatus", C.QUEUE_KEY || "leetTrackerQueue"];
    var raw = await chrome.storage.local.get(keys);
    var status = raw[C.STATUS_KEY || "leetTrackerLastStatus"];
    var queue = raw[C.QUEUE_KEY || "leetTrackerQueue"] || [];

    if (status && status.message) {
      setStatus(status.message + " (" + new Date(status.at).toLocaleTimeString() + ")", !!status.ok);
    } else {
      setStatus("No uploads yet.", true);
    }

    elements.queueText.textContent = "Pending queue: " + queue.length;
  }

  async function init() {
    var settings = await readSettings();
    elements.enabled.checked = !!settings.enabled;
    elements.username.value = settings.username || "";
    elements.endpointUrl.value = settings.endpointUrl || "";
    renderFieldCheckboxes(settings.fields || defaultSettings().fields);
    refreshSheetPreview();
    await refreshStatus();
  }

  elements.username.addEventListener("input", refreshSheetPreview);

  elements.saveBtn.addEventListener("click", async function () {
    var username = elements.username.value.trim();
    var endpointUrl = elements.endpointUrl.value.trim();
    var selectedFields = collectSelectedFields();

    if (!username) {
      setStatus("User name is required.", false);
      return;
    }

    if (!endpointUrl) {
      setStatus("Endpoint URL is required.", false);
      return;
    }

    if (!isValidHttpUrl(endpointUrl)) {
      setStatus("Use a valid https URL.", false);
      return;
    }

    if (selectedFields.length === 0) {
      setStatus("Select at least one field.", false);
      return;
    }

    await writeSettings({
      enabled: elements.enabled.checked,
      username: username,
      endpointUrl: endpointUrl,
      fields: selectedFields,
      sheetName: sanitizeSheetName(username)
    });

    chrome.runtime.sendMessage({ type: "leet-tracker-settings-updated" }, function () {
      void chrome.runtime.lastError;
    });

    setStatus("Settings saved.", true);
    await refreshStatus();
  });

  init();
})();
