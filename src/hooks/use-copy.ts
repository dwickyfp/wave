"use client";

import { useState } from "react";

export const useCopy = (timeout = 2000) => {
  const [copied, setCopied] = useState(false);

  const copy = (text: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, timeout);
  };

  return { copied, copy };
};
