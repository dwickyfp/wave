const INDONESIA_TIME_ZONES = new Set([
  "Asia/Jakarta",
  "Asia/Pontianak",
  "Asia/Makassar",
  "Asia/Jayapura",
]);

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  ar: "Arabic",
  en: "English",
  es: "Spanish",
  fr: "French",
  he: "Hebrew",
  hi: "Hindi",
  id: "Indonesian",
  ja: "Japanese",
  ko: "Korean",
  no: "Norwegian",
  ru: "Russian",
  th: "Thai",
  uk: "Ukrainian",
  zh: "Chinese",
};

const LANGUAGE_TRANSCRIPTION_PROMPTS: Record<string, string> = {
  en: "English, Emma, Dwicky, customer support, report, chart, table, mermaid, workflow, dashboard, sales, employee, data",
  es: "espanol, Emma, Dwicky, soporte, informe, grafico, tabla, mermaid, flujo, panel, ventas, empleado, datos",
  fr: "francais, Emma, Dwicky, assistance, rapport, graphique, tableau, mermaid, workflow, tableau de bord, ventes, employe, donnees",
  id: "bahasa indonesia, Emma, Dwicky, bantu, tolong, laporan, tabel, grafik, mermaid, workflow, dashboard, penjualan, karyawan, data",
  ja: "nihongo, Emma, Dwicky, sapoto, repoto, hyo, gurafu, mermaid, wakufuro, dasshubodo, uriage, juugyouin, deeta",
  ko: "hangugeo, Emma, Dwicky, jiwon, bogoseo, pyo, chateu, mermaid, workflow, daesibodeu, maechul, jigwon, deiteo",
  no: "norsk, Emma, Dwicky, support, rapport, diagram, tabell, mermaid, arbeidsflyt, dashbord, salg, ansatt, data",
  zh: "zhongwen, Emma, Dwicky, zhichi, baogao, biaoge, tubiao, mermaid, gongzuoliu, yibiaoban, xiaoshou, yuangong, shuju",
};

const SCRIPT_PATTERNS = {
  arabic: /\p{Script=Arabic}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  devanagari: /\p{Script=Devanagari}/u,
  han: /\p{Script=Han}/u,
  hangul: /\p{Script=Hangul}/u,
  hebrew: /\p{Script=Hebrew}/u,
  hiragana: /\p{Script=Hiragana}/u,
  katakana: /\p{Script=Katakana}/u,
  thai: /\p{Script=Thai}/u,
};

function hasUnexpectedScript(
  text: string,
  allowedScripts: Array<keyof typeof SCRIPT_PATTERNS>,
) {
  const allowed = new Set(allowedScripts);

  return Object.entries(SCRIPT_PATTERNS).some(([script, pattern]) => {
    if (allowed.has(script as keyof typeof SCRIPT_PATTERNS)) {
      return false;
    }

    return pattern.test(text);
  });
}

export function normalizeVoiceLanguage(value?: string | null) {
  if (!value?.trim()) {
    return undefined;
  }

  const match = value
    .trim()
    .toLowerCase()
    .match(/^[a-z]{2,3}/);
  return match?.[0];
}

export function getVoiceLanguageDisplayName(language?: string | null) {
  const normalized = normalizeVoiceLanguage(language);
  return normalized ? LANGUAGE_DISPLAY_NAMES[normalized] : undefined;
}

export function buildVoiceTranscriptionBias(language?: string | null) {
  const normalized = normalizeVoiceLanguage(language);
  if (!normalized) {
    return undefined;
  }

  const prompt = LANGUAGE_TRANSCRIPTION_PROMPTS[normalized];
  return {
    language: normalized,
    ...(prompt ? { prompt } : {}),
  };
}

export function pickVoiceLanguageHint(input: {
  candidates: Array<string | null | undefined>;
  timeZone?: string | null;
}) {
  const normalizedCandidates = input.candidates
    .map((candidate) => normalizeVoiceLanguage(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));

  if (normalizedCandidates.includes("id")) {
    return "id";
  }

  const firstNonEnglish = normalizedCandidates.find(
    (candidate) => candidate !== "en",
  );
  if (firstNonEnglish) {
    return firstNonEnglish;
  }

  if (input.timeZone && INDONESIA_TIME_ZONES.has(input.timeZone)) {
    return "id";
  }

  return normalizedCandidates[0];
}

export function isTranscriptCompatibleWithLanguage(
  transcript: string,
  language?: string | null,
) {
  const normalized = normalizeVoiceLanguage(language);
  if (!normalized || !/\p{L}/u.test(transcript)) {
    return true;
  }

  switch (normalized) {
    case "ar":
      return !hasUnexpectedScript(transcript, ["arabic"]);
    case "he":
      return !hasUnexpectedScript(transcript, ["hebrew"]);
    case "hi":
      return !hasUnexpectedScript(transcript, ["devanagari"]);
    case "ja":
      return !hasUnexpectedScript(transcript, ["han", "hiragana", "katakana"]);
    case "ko":
      return !hasUnexpectedScript(transcript, ["hangul"]);
    case "ru":
    case "uk":
      return !hasUnexpectedScript(transcript, ["cyrillic"]);
    case "th":
      return !hasUnexpectedScript(transcript, ["thai"]);
    case "zh":
      return !hasUnexpectedScript(transcript, ["han"]);
    default:
      return !hasUnexpectedScript(transcript, []);
  }
}
