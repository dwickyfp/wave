(() => {
  if (globalThis.__emmaPilotContentScriptLoaded) {
    return;
  }

  globalThis.__emmaPilotContentScriptLoaded = true;

  const PILOT_ATTR = "data-emma-pilot-id";

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function nextElementId() {
    return crypto.randomUUID();
  }

  function ensureElementId(element) {
    if (!element.getAttribute(PILOT_ATTR)) {
      element.setAttribute(PILOT_ATTR, nextElementId());
    }
    return element.getAttribute(PILOT_ATTR);
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getLabelForField(element) {
    if (!(element instanceof HTMLElement)) return "";

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return normalizeText(ariaLabel);

    const id = element.getAttribute("id");
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return normalizeText(label.textContent);
    }

    const parentLabel = element.closest("label");
    if (parentLabel) return normalizeText(parentLabel.textContent);

    return normalizeText(element.getAttribute("placeholder"));
  }

  function getFieldValue(element) {
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox" || element.type === "radio") {
        return element.checked ? "checked" : "";
      }
      return element.value;
    }

    if (
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      return element.value;
    }

    return "";
  }

  function serializeField(element) {
    if (!isVisible(element)) return null;

    const base = {
      elementId: ensureElementId(element),
      tagName: element.tagName.toLowerCase(),
      label: getLabelForField(element),
      name: element.getAttribute("name") || undefined,
      placeholder: element.getAttribute("placeholder") || undefined,
      text: normalizeText(element.textContent),
      disabled: element.disabled || undefined,
    };

    if (element instanceof HTMLInputElement) {
      return {
        ...base,
        type: element.type || "text",
        value: getFieldValue(element),
        required: element.required || undefined,
        checked: element.checked || undefined,
      };
    }

    if (element instanceof HTMLTextAreaElement) {
      return {
        ...base,
        type: "textarea",
        value: element.value,
        required: element.required || undefined,
      };
    }

    if (element instanceof HTMLSelectElement) {
      return {
        ...base,
        type: "select",
        value: element.value,
        required: element.required || undefined,
        options: Array.from(element.options).map((option) => ({
          value: option.value,
          label: normalizeText(option.label || option.textContent),
        })),
      };
    }

    return null;
  }

  function collectForms() {
    return Array.from(document.querySelectorAll("form"))
      .map((form) => {
        const fields = Array.from(
          form.querySelectorAll("input, textarea, select"),
        )
          .map((field) => serializeField(field))
          .filter(Boolean);

        if (!fields.length) return null;

        return {
          formId: ensureElementId(form),
          label: normalizeText(form.getAttribute("aria-label") || ""),
          action: form.getAttribute("action") || undefined,
          method: form.getAttribute("method") || undefined,
          fields,
        };
      })
      .filter(Boolean);
  }

  function collectActionables() {
    return Array.from(
      document.querySelectorAll(
        "button, a[href], input[type='submit'], input[type='button'], input[type='checkbox'], input[type='radio'], select",
      ),
    )
      .map((element) => {
        if (!isVisible(element)) return null;

        const role =
          element instanceof HTMLAnchorElement
            ? "link"
            : element instanceof HTMLSelectElement
              ? "select"
              : element instanceof HTMLInputElement &&
                  element.type === "checkbox"
                ? "checkbox"
                : element instanceof HTMLInputElement &&
                    element.type === "radio"
                  ? "radio"
                  : element instanceof HTMLInputElement
                    ? "input"
                    : "button";

        return {
          elementId: ensureElementId(element),
          role,
          label: getLabelForField(element),
          text: normalizeText(element.textContent || element.value),
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          disabled:
            element instanceof HTMLButtonElement ||
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement
              ? element.disabled || undefined
              : undefined,
        };
      })
      .filter(Boolean);
  }

  function collectSnapshot() {
    const selectedText = normalizeText(window.getSelection()?.toString() || "");
    const activeElement =
      document.activeElement &&
      document.activeElement.matches("input, textarea, select")
        ? serializeField(document.activeElement)
        : null;

    return {
      url: window.location.href,
      title: document.title,
      visibleText: normalizeText(document.body?.innerText || "").slice(
        0,
        12000,
      ),
      selectedText: selectedText || undefined,
      focusedElement: activeElement || undefined,
      forms: collectForms(),
      actionables: collectActionables(),
      generatedAt: new Date().toISOString(),
    };
  }

  function findElementById(elementId) {
    return document.querySelector(`[${PILOT_ATTR}="${CSS.escape(elementId)}"]`);
  }

  function dispatchValueEvents(element) {
    ["input", "change", "blur"].forEach((eventName) => {
      element.dispatchEvent(new Event(eventName, { bubbles: true }));
    });
  }

  function setElementValue(element, value) {
    if (element instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      );
      descriptor?.set?.call(element, value);
      dispatchValueEvents(element);
      return;
    }

    if (element instanceof HTMLTextAreaElement) {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      );
      descriptor?.set?.call(element, value);
      dispatchValueEvents(element);
      return;
    }

    if (element instanceof HTMLSelectElement) {
      element.value = value;
      dispatchValueEvents(element);
    }
  }

  function highlightElement(element) {
    const previousOutline = element.style.outline;
    const previousOffset = element.style.outlineOffset;
    element.style.outline = "3px solid #ff8f00";
    element.style.outlineOffset = "2px";
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    setTimeout(() => {
      element.style.outline = previousOutline;
      element.style.outlineOffset = previousOffset;
    }, 1800);
  }

  function executeProposal(proposal) {
    if (!proposal) {
      throw new Error("No proposal was provided.");
    }

    if (proposal.kind === "navigate" && proposal.url) {
      window.location.href = proposal.url;
      return {
        proposalId: proposal.id,
        status: "succeeded",
        summary: `Navigated to ${proposal.url}`,
      };
    }

    const target = proposal.elementId
      ? findElementById(proposal.elementId)
      : null;
    if (!target && proposal.kind !== "fillFields") {
      throw new Error("The requested page element is no longer available.");
    }

    switch (proposal.kind) {
      case "highlightElement":
        highlightElement(target);
        return {
          proposalId: proposal.id,
          status: "succeeded",
          summary: `Highlighted ${proposal.label || "the requested element"}.`,
        };

      case "scrollToElement":
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        return {
          proposalId: proposal.id,
          status: "succeeded",
          summary: `Scrolled to ${proposal.label || "the requested element"}.`,
        };

      case "clickElement":
        highlightElement(target);
        target.click();
        return {
          proposalId: proposal.id,
          status: "succeeded",
          summary: `Clicked ${proposal.label || "the requested element"}.`,
        };

      case "toggleCheckbox":
        if (!(target instanceof HTMLInputElement)) {
          throw new Error("The requested checkbox is not available.");
        }
        target.checked = Boolean(proposal.checked);
        dispatchValueEvents(target);
        return {
          proposalId: proposal.id,
          status: "succeeded",
          summary: `${proposal.checked ? "Enabled" : "Disabled"} ${proposal.label || "the checkbox"}.`,
        };

      case "selectOption":
        setElementValue(target, proposal.value || "");
        return {
          proposalId: proposal.id,
          status: "succeeded",
          summary: `Selected ${proposal.value || "the requested option"}.`,
        };

      case "setInputValue":
        setElementValue(target, proposal.value || "");
        return {
          proposalId: proposal.id,
          status: "succeeded",
          summary: `Updated ${proposal.label || "the requested field"}.`,
        };

      case "fillFields": {
        const updatedFields = [];
        for (const field of proposal.fields || []) {
          const fieldElement = findElementById(field.elementId);
          if (!fieldElement) continue;
          setElementValue(fieldElement, field.value);
          updatedFields.push(field.value);
        }
        return {
          proposalId: proposal.id,
          status: "succeeded",
          summary: `Filled ${updatedFields.length} field${updatedFields.length === 1 ? "" : "s"}.`,
        };
      }

      default:
        throw new Error(`Unsupported Emma Pilot action: ${proposal.kind}`);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "emma.ping") {
      sendResponse({ ready: true });
      return;
    }

    if (message?.type === "emma.collectSnapshot") {
      sendResponse(collectSnapshot());
      return;
    }

    if (message?.type === "emma.executeAction") {
      try {
        sendResponse(executeProposal(message.proposal));
      } catch (error) {
        sendResponse({
          proposalId: message.proposal?.id,
          status: "failed",
          summary: "Emma Pilot could not execute the page action.",
          error: error?.message || "Unknown error",
        });
      }
    }
  });
})();
