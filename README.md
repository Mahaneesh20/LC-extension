# LeetCode Accepted -> Google Sheet (Chrome Extension)

This extension detects accepted LeetCode submissions and sends them to your Google Apps Script Web App endpoint as JSON.
Each upload includes a username label and the Apps Script creates or reuses a separate sheet tab for that user.

## What Gets Sent

You can choose fields in the popup. The username label is added automatically and also used to choose the user's sheet tab.
Default selectable fields:
- `title`
- `url`
- `difficulty`
- `runtime`
- `memory`
- `timestamp`

The extension posts data in this format:

```json
{
  "source": "leetcode-extension",
  "event": "accepted",
  "username": "shobi",
  "sheetName": "shobi",
  "row": {
    "username": "shobi",
    "title": "Two Sum",
    "url": "https://leetcode.com/problems/two-sum/",
    "difficulty": "Easy",
    "runtime": "0 ms",
    "memory": "16.2 MB",
    "timestamp": "2026-04-06T12:00:00.000Z"
  },
  "fields": ["username", "title", "url", "difficulty", "runtime", "memory", "timestamp"],
  "receivedAt": "2026-04-06T12:00:00.000Z"
}
```

## 1) Create Google Apps Script Endpoint

1. Open [Google Apps Script](https://script.google.com/).
2. Create a new script and paste this:

```javascript
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID";

function sanitizeSheetName(name) {
  return String(name || "default-user")
    .replace(/[\\/\[\]:*?]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "default-user";
}

function doPost(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  const rowObj = body.row || {};
  const username = sanitizeSheetName(body.sheetName || body.username || rowObj.username || "default-user");
  const fields = body.fields || ["username", "title", "url", "difficulty", "runtime", "memory", "timestamp"];
  const sheet = ss.getSheetByName(username) || ss.insertSheet(username);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(fields);
  }

  const rowValues = fields.map((key) => rowObj[key] || "");
  sheet.appendRow(rowValues);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. Deploy:
- Click `Deploy` -> `New deployment`
- Type: `Web app`
- Execute as: `Me`
- Who has access: `Anyone`
- Copy the `/exec` URL

## 2) Load Extension in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder

## 3) Configure Extension

1. Open the extension popup
2. Enter the username or profile label for this Chrome profile
3. Paste your Apps Script `/exec` URL
4. Keep uploads enabled
5. Save

## 4) Test

1. Open a LeetCode problem
2. Submit an accepted solution or click `Upload to Sheet`
3. Confirm a new row appears in that user's tab inside your Google Sheet

## Notes

- Upload retries are automatic with backoff if the endpoint is unavailable.
- Duplicate sends are reduced with a short dedupe window.
- If LeetCode changes UI/API structure, update parsers in `src/content/content.js`.
