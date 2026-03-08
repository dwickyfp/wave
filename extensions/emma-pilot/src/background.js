const AUTH_STORAGE_KEY = "emmaPilotAuth";
const ALL_URLS_PERMISSION = { origins: ["<all_urls>"] };
let runtimeConfigPromise = null;

async function getRuntimeConfig() {
  runtimeConfigPromise ??= (async () => {
    const response = await fetch(chrome.runtime.getURL("runtime-config.json"));
    if (!response.ok) {
      runtimeConfigPromise = null;
      throw new Error("Failed to load Emma Pilot runtime config.");
    }
    return await response.json();
  })();

  return await runtimeConfigPromise;
}

function getStoredAuth() {
  return chrome.storage.local.get(AUTH_STORAGE_KEY).then((result) => {
    return result[AUTH_STORAGE_KEY] || null;
  });
}

function setStoredAuth(value) {
  return chrome.storage.local.set({
    [AUTH_STORAGE_KEY]: value,
  });
}

function clearStoredAuth() {
  return chrome.storage.local.remove(AUTH_STORAGE_KEY);
}

async function hasAllSitesPermission() {
  return await chrome.permissions.contains(ALL_URLS_PERMISSION);
}

async function ensureInjectableTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "emma.ping",
    });
    if (response?.ready) {
      return;
    }
  } catch {
    // The content script is not ready in this tab yet.
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-script.js"],
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }
  return tab;
}

async function configurePanelBehavior() {
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    });
  }
}

async function startAuthFlow() {
  const config = await getRuntimeConfig();
  const state = crypto.randomUUID();
  const browserInfo = config.browser === "edge" ? "edge" : "chrome";
  const authorizeUrl = new URL("/pilot/authorize", config.backendOrigin);
  authorizeUrl.searchParams.set("extension_id", chrome.runtime.id);
  authorizeUrl.searchParams.set("browser", browserInfo);
  authorizeUrl.searchParams.set("state", state);

  const callbackUrl = await chrome.identity.launchWebAuthFlow({
    url: authorizeUrl.toString(),
    interactive: true,
  });

  if (!callbackUrl) {
    throw new Error("Browser sign-in did not complete.");
  }

  const parsed = new URL(callbackUrl);
  const callbackState = parsed.searchParams.get("state");
  const code = parsed.searchParams.get("code");

  if (!code || callbackState !== state) {
    throw new Error("Pilot authorization callback was invalid.");
  }

  const exchangeResponse = await fetch(
    `${config.backendOrigin}/api/pilot/auth/exchange`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        extensionId: chrome.runtime.id,
      }),
    },
  );

  if (!exchangeResponse.ok) {
    const error = await exchangeResponse.json().catch(() => ({}));
    throw new Error(error.error || "Pilot auth exchange failed.");
  }

  const auth = await exchangeResponse.json();
  await setStoredAuth(auth);
  return auth;
}

chrome.runtime.onInstalled.addListener(() => {
  void configurePanelBehavior();
});

chrome.runtime.onStartup?.addListener(() => {
  void configurePanelBehavior();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "pilot.getStatus": {
        sendResponse({
          auth: await getStoredAuth(),
          hasAllSitesPermission: await hasAllSitesPermission(),
        });
        return;
      }

      case "pilot.startAuth": {
        sendResponse({
          auth: await startAuthFlow(),
        });
        return;
      }

      case "pilot.clearAuth": {
        await clearStoredAuth();
        sendResponse({ success: true });
        return;
      }

      case "pilot.requestAllSites": {
        const granted = await chrome.permissions.request(ALL_URLS_PERMISSION);
        sendResponse({ granted });
        return;
      }

      case "pilot.collectSnapshot": {
        const tab = await getActiveTab();
        try {
          await ensureInjectableTab(tab.id);
        } catch (error) {
          sendResponse({
            tab: {
              tabId: tab.id,
              url: tab.url,
              title: tab.title,
            },
            error:
              error?.message ||
              "Emma Pilot could not access this page. Grant site access first.",
          });
          return;
        }

        const snapshot = await chrome.tabs.sendMessage(tab.id, {
          type: "emma.collectSnapshot",
        });
        sendResponse({
          tab: {
            tabId: tab.id,
            url: tab.url,
            title: tab.title,
          },
          snapshot,
        });
        return;
      }

      case "pilot.executeAction": {
        const tab = await getActiveTab();
        await ensureInjectableTab(tab.id);
        const result = await chrome.tabs.sendMessage(tab.id, {
          type: "emma.executeAction",
          proposal: message.proposal,
        });
        sendResponse(result);
        return;
      }

      default:
        sendResponse({ error: "Unknown Emma Pilot message." });
    }
  })().catch((error) => {
    sendResponse({
      error: error?.message || "Emma Pilot background request failed.",
    });
  });

  return true;
});
