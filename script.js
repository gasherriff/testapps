const STORAGE_KEY = "pastel-sticky-notes";
const TRANSLATE_FUNCTION_NAME = "translate-note";
const TRANSLATION_DEBOUNCE_MS = 700;
const NOTE_WIDTH = 260;
const NOTE_HEIGHT = 332;
const MOBILE_NOTE_WIDTH = 240;
const MOBILE_NOTE_HEIGHT = 344;
const NOTE_COLORS = [
  "#ffd9ec",
  "#ffeab6",
  "#d9f6ff",
  "#e7dcff",
  "#dff8d8",
  "#ffdcca"
];

const addNoteButton = document.getElementById("add-note-button");
const notesBoard = document.getElementById("notes-board");
const notesCanvas = document.getElementById("notes-canvas");
const noteTemplate = document.getElementById("note-template");
const syncStatus = document.getElementById("sync-status");

let highestZIndex = 1;
let notes = [];
let supabaseClient = null;
let syncTimeoutId = null;
let pendingSyncIds = new Map();
let locallyDirtyNoteIds = new Map();
let translationTimeoutIds = new Map();
let activeEditingNoteId = null;
let isHydratingFromRemote = false;
let lastKnownViewportWidth = window.innerWidth;

function loadNotes() {
  try {
    const savedNotes = window.localStorage.getItem(STORAGE_KEY);

    if (!savedNotes) {
      return [
        createNoteData({
          text: "Good morning",
          translatedText: "Bom dia",
          detectedLanguage: "EN",
          translationStatus: "translated",
          x: 42,
          y: 42,
          color: NOTE_COLORS[0]
        }),
        createNoteData({
          text: "Tudo bem?",
          translatedText: "How are you?",
          detectedLanguage: "PT-BR",
          translationStatus: "translated",
          x: 330,
          y: 110,
          color: NOTE_COLORS[2]
        })
      ];
    }

    return JSON.parse(savedNotes).map(normalizeStoredNote);
  } catch (error) {
    console.error("Could not load notes from localStorage.", error);
    return [];
  }
}

function normalizeStoredNote(note) {
  const legacyText = typeof note.text === "string" ? note.text : "";

  return {
    id: note.id || crypto.randomUUID(),
    text: legacyText,
    translatedText: typeof note.translatedText === "string" ? note.translatedText : "",
    detectedLanguage: note.detectedLanguage || null,
    translationStatus: note.translationStatus || (legacyText ? "idle" : "idle"),
    color: note.color || NOTE_COLORS[0],
    x: Number(note.x) || 24,
    y: Number(note.y) || 24,
    zIndex: Number(note.zIndex ?? note.z_index) || 1
  };
}

function saveNotes() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

function setSyncStatus(message, state = "warning") {
  syncStatus.textContent = message;
  syncStatus.dataset.state = state;
}

function hasSupabaseConfig() {
  const config = window.SUPABASE_CONFIG || {};
  return (
    typeof config.url === "string" &&
    typeof config.anonKey === "string" &&
    config.url &&
    config.anonKey &&
    !config.url.includes("PASTE_YOUR_SUPABASE_URL_HERE") &&
    !config.anonKey.includes("PASTE_YOUR_SUPABASE_ANON_KEY_HERE")
  );
}

function initializeSupabase() {
  if (!window.supabase || !hasSupabaseConfig()) {
    return null;
  }

  return window.supabase.createClient(
    window.SUPABASE_CONFIG.url,
    window.SUPABASE_CONFIG.anonKey
  );
}

function getFunctionUrl(functionName) {
  return `${window.SUPABASE_CONFIG.url}/functions/v1/${functionName}`;
}

function createNoteData(overrides = {}) {
  highestZIndex += 1;

  return normalizeStoredNote({
    id: crypto.randomUUID(),
    text: "",
    translatedText: "",
    detectedLanguage: null,
    translationStatus: "idle",
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
    x: 24,
    y: 24,
    zIndex: highestZIndex,
    ...overrides
  });
}

function getNoteDimensions() {
  const isMobile = window.innerWidth <= 720;
  return {
    width: isMobile ? MOBILE_NOTE_WIDTH : NOTE_WIDTH,
    height: isMobile ? MOBILE_NOTE_HEIGHT : NOTE_HEIGHT
  };
}

function clampPosition(x, y) {
  const { width, height } = getNoteDimensions();
  const maxX = Math.max(12, notesCanvas.clientWidth - width - 12);
  const maxY = Math.max(12, notesCanvas.clientHeight - height - 12);

  return {
    x: Math.min(Math.max(12, x), maxX),
    y: Math.min(Math.max(12, y), maxY)
  };
}

function positionNewNote() {
  const offset = notes.length * 18;
  return clampPosition(28 + offset, 28 + offset);
}

function bringNoteToFront(noteId, noteElement) {
  highestZIndex += 1;
  const targetNote = notes.find((note) => note.id === noteId);

  if (!targetNote) {
    return;
  }

  targetNote.zIndex = highestZIndex;
  saveNotes();
  scheduleNoteSync(noteId);

  if (noteElement) {
    noteElement.style.zIndex = targetNote.zIndex;
  }
}

function updateNote(noteId, updates, options = {}) {
  notes = notes.map((note) => (note.id === noteId ? { ...note, ...updates } : note));
  saveNotes();

  if (!options.skipSync) {
    scheduleNoteSync(noteId);
  }
}

function deleteNote(noteId) {
  notes = notes.filter((note) => note.id !== noteId);
  pendingSyncIds.delete(noteId);
  locallyDirtyNoteIds.delete(noteId);

  if (translationTimeoutIds.has(noteId)) {
    window.clearTimeout(translationTimeoutIds.get(noteId));
    translationTimeoutIds.delete(noteId);
  }

  saveNotes();
  renderNotes();
  deleteNoteFromRemote(noteId);
}

function addNewNote() {
  const position = positionNewNote();
  const note = createNoteData(position);
  notes.push(note);
  saveNotes();
  renderNotes();
  scheduleNoteSync(note.id);

  const textArea = notesCanvas.querySelector(`[data-note-id="${note.id}"] .note-source-text`);
  textArea?.focus();
}

function getTranslationStatusMessage(note) {
  if (!note.text.trim()) {
    return "";
  }

  if (note.translationStatus === "translating") {
    return "Translating...";
  }

  if (note.translationStatus === "setup") {
    return "Add the DeepL function to turn this on.";
  }

  if (note.translationStatus === "unsupported") {
    return "Try English or Brazilian Portuguese.";
  }

  if (note.translationStatus === "error") {
    return "Translation could not be loaded right now.";
  }

  if (note.detectedLanguage?.startsWith("PT")) {
    return "Brazilian Portuguese -> English";
  }

  if (note.detectedLanguage?.startsWith("EN")) {
    return "English -> Brazilian Portuguese";
  }

  if (note.translationStatus === "translated") {
    return "Translated automatically";
  }

  return "Waiting for text...";
}

function getTranslationDisplayText(note) {
  if (note.translatedText) {
    return note.translatedText;
  }

  if (!note.text.trim()) {
    return "The translation will appear here.";
  }

  if (note.translationStatus === "translating") {
    return "Listening for the finished translation...";
  }

  if (note.translationStatus === "setup") {
    return "This note is ready for translation once the DeepL function is deployed.";
  }

  if (note.translationStatus === "unsupported") {
    return "Automatic switching is tuned for English and Brazilian Portuguese.";
  }

  return "Translation will appear here shortly.";
}

function renderNotes() {
  const activeElement = document.activeElement;
  const activeNoteElement = activeElement?.closest?.(".note");
  const focusState = activeNoteElement
    ? {
        noteId: activeNoteElement.dataset.noteId,
        selectionStart: activeElement.selectionStart,
        selectionEnd: activeElement.selectionEnd
      }
    : null;

  notesCanvas.innerHTML = "";

  notes
    .slice()
    .sort((first, second) => (first.zIndex || 0) - (second.zIndex || 0))
    .forEach((note) => {
      const noteFragment = noteTemplate.content.cloneNode(true);
      const noteElement = noteFragment.querySelector(".note");
      const textArea = noteFragment.querySelector(".note-source-text");
      const label = noteFragment.querySelector(".sr-only");
      const deleteButton = noteFragment.querySelector(".delete-note-button");
      const translationElement = noteFragment.querySelector(".note-translation");
      const translationStatus = noteFragment.querySelector(".translation-status");

      noteElement.dataset.noteId = note.id;
      noteElement.style.left = `${note.x}px`;
      noteElement.style.top = `${note.y}px`;
      noteElement.style.background = note.color;
      noteElement.style.zIndex = note.zIndex || 1;

      const textAreaId = `note-text-${note.id}`;
      textArea.id = textAreaId;
      textArea.value = note.text;
      label.htmlFor = textAreaId;
      translationElement.textContent = getTranslationDisplayText(note);
      translationStatus.textContent = getTranslationStatusMessage(note);
      translationStatus.dataset.state = note.translationStatus;

      textArea.addEventListener("input", (event) => {
        const nextText = event.target.value;
        const trimmedText = nextText.trim();

        updateNote(note.id, {
          text: nextText,
          translatedText: trimmedText ? "" : "",
          detectedLanguage: trimmedText ? note.detectedLanguage : null,
          translationStatus: trimmedText ? "translating" : "idle"
        });

        scheduleTranslation(note.id);
      });

      textArea.addEventListener("focus", () => {
        activeEditingNoteId = note.id;
        bringNoteToFront(note.id, noteElement);
      });

      textArea.addEventListener("blur", () => {
        if (activeEditingNoteId === note.id) {
          activeEditingNoteId = null;
        }
      });

      deleteButton.addEventListener("click", () => {
        deleteNote(note.id);
      });

      setupDrag(noteElement, note.id);
      notesCanvas.appendChild(noteFragment);
    });

  updateBoardCanvasSize();

  if (focusState?.noteId) {
    const nextTextArea = notesCanvas.querySelector(`[data-note-id="${focusState.noteId}"] .note-source-text`);

    if (nextTextArea) {
      nextTextArea.focus();
      nextTextArea.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
    }
  }
}

function updateBoardCanvasSize() {
  const { width, height } = getNoteDimensions();
  const furthestX = notes.reduce((max, note) => Math.max(max, note.x + width + 24), notesBoard.clientWidth);
  const furthestY = notes.reduce((max, note) => Math.max(max, note.y + height + 24), notesBoard.clientHeight);

  notesCanvas.style.width = `${furthestX}px`;
  notesCanvas.style.height = `${furthestY}px`;
}

function setupDrag(noteElement, noteId) {
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  noteElement.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".delete-note-button") || event.target.closest(".note-source-text")) {
      return;
    }

    if (window.innerWidth <= 720 && event.pointerType !== "mouse") {
      if (!event.target.closest(".note-footer")) {
        return;
      }

      event.preventDefault();
      bringNoteToFront(noteId, noteElement);
    } else {
      event.preventDefault();
      bringNoteToFront(noteId, noteElement);
    }

    noteElement.classList.add("is-dragging");

    const noteRect = noteElement.getBoundingClientRect();
    dragOffsetX = event.clientX - noteRect.left;
    dragOffsetY = event.clientY - noteRect.top;

    noteElement.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent) => {
      const canvasRect = notesCanvas.getBoundingClientRect();
      const nextPosition = clampPosition(
        moveEvent.clientX - canvasRect.left - dragOffsetX,
        moveEvent.clientY - canvasRect.top - dragOffsetY
      );

      noteElement.style.left = `${nextPosition.x}px`;
      noteElement.style.top = `${nextPosition.y}px`;
      updateNote(noteId, nextPosition);
      updateBoardCanvasSize();
    };

    const stopDragging = (pointerEvent) => {
      noteElement.classList.remove("is-dragging");

      if (noteElement.hasPointerCapture(pointerEvent.pointerId)) {
        noteElement.releasePointerCapture(pointerEvent.pointerId);
      }

      noteElement.removeEventListener("pointermove", handlePointerMove);
      noteElement.removeEventListener("pointerup", stopDragging);
      noteElement.removeEventListener("pointercancel", stopDragging);
    };

    noteElement.addEventListener("pointermove", handlePointerMove);
    noteElement.addEventListener("pointerup", stopDragging);
    noteElement.addEventListener("pointercancel", stopDragging);
  });
}

function keepNotesInsideBoard() {
  let hasUpdates = false;

  notes = notes.map((note) => {
    const constrained = clampPosition(note.x, note.y);

    if (constrained.x !== note.x || constrained.y !== note.y) {
      hasUpdates = true;
      return { ...note, ...constrained };
    }

    return note;
  });

  if (hasUpdates) {
    saveNotes();
    notes.forEach((note) => scheduleNoteSync(note.id));
  }

  renderNotes();
}

function normalizeRemoteNote(note) {
  return normalizeStoredNote({
    id: note.id,
    text: note.text || "",
    translatedText: note.translated_text || "",
    detectedLanguage: note.detected_language || null,
    translationStatus: note.translation_status || "idle",
    color: note.color || NOTE_COLORS[0],
    x: Number(note.x) || 24,
    y: Number(note.y) || 24,
    zIndex: Number(note.z_index) || 1
  });
}

function notesAreEqual(firstNotes, secondNotes) {
  if (firstNotes.length !== secondNotes.length) {
    return false;
  }

  return firstNotes.every((note, index) => {
    const otherNote = secondNotes[index];

    return (
      note.id === otherNote.id &&
      note.text === otherNote.text &&
      note.translatedText === otherNote.translatedText &&
      note.detectedLanguage === otherNote.detectedLanguage &&
      note.translationStatus === otherNote.translationStatus &&
      note.color === otherNote.color &&
      note.x === otherNote.x &&
      note.y === otherNote.y &&
      note.zIndex === otherNote.zIndex
    );
  });
}

function mergeRemoteWithLocal(remoteNotes) {
  const localNotesById = new Map(notes.map((note) => [note.id, note]));

  return remoteNotes.map((remoteNote) => {
    if (locallyDirtyNoteIds.has(remoteNote.id) || activeEditingNoteId === remoteNote.id) {
      return localNotesById.get(remoteNote.id) || remoteNote;
    }

    return remoteNote;
  });
}

function noteToRow(note) {
  return {
    id: note.id,
    text: note.text,
    translated_text: note.translatedText,
    detected_language: note.detectedLanguage,
    translation_status: note.translationStatus,
    color: note.color,
    x: Math.round(note.x),
    y: Math.round(note.y),
    z_index: Math.round(note.zIndex)
  };
}

async function loadNotesFromRemote() {
  const { data, error } = await supabaseClient
    .from("notes")
    .select("id, text, translated_text, detected_language, translation_status, color, x, y, z_index")
    .order("z_index", { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []).map(normalizeRemoteNote);
}

async function syncNotesFromRemote() {
  if (!supabaseClient) {
    return;
  }

  const remoteNotes = await loadNotesFromRemote();
  const mergedNotes = mergeRemoteWithLocal(remoteNotes);
  const localOnlyNotes = notes.filter((note) => !remoteNotes.some((remoteNote) => remoteNote.id === note.id));
  const protectedLocalNotes = localOnlyNotes.filter((note) => locallyDirtyNoteIds.has(note.id));
  const nextNotes = [...mergedNotes, ...protectedLocalNotes];
  const sortedRemoteNotes = nextNotes
    .slice()
    .sort((first, second) => (first.zIndex || 0) - (second.zIndex || 0));
  const sortedLocalNotes = notes
    .slice()
    .sort((first, second) => (first.zIndex || 0) - (second.zIndex || 0));

  if (sortedRemoteNotes.length === 0 && notes.length > 0) {
    const { error } = await supabaseClient.from("notes").upsert(notes.map(noteToRow));

    if (error) {
      throw error;
    }

    setSyncStatus("Shared board ready. Everyone sees the same notes.", "ready");
    return;
  }

  if (notesAreEqual(sortedLocalNotes, sortedRemoteNotes)) {
    setSyncStatus("Shared board ready. Everyone sees the same notes.", "ready");
    return;
  }

  isHydratingFromRemote = true;
  notes = sortedRemoteNotes;
  highestZIndex = notes.reduce((max, note) => Math.max(max, note.zIndex || 1), 1);
  saveNotes();
  renderNotes();
  isHydratingFromRemote = false;
  setSyncStatus("Shared board ready. Everyone sees the same notes.", "ready");
}

async function flushPendingSync() {
  if (!supabaseClient || pendingSyncIds.size === 0 || isHydratingFromRemote) {
    return;
  }

  const noteIds = [...pendingSyncIds.keys()];
  pendingSyncIds.clear();
  const rows = noteIds
    .map((noteId) => notes.find((note) => note.id === noteId))
    .filter(Boolean)
    .map(noteToRow);

  if (rows.length === 0) {
    return;
  }

  const { error } = await supabaseClient.from("notes").upsert(rows);

  if (error) {
    console.error("Could not sync notes to Supabase.", error);
    setSyncStatus("Could not sync to Supabase. Using local backup for now.", "error");
    return;
  }

  noteIds.forEach((noteId) => {
    locallyDirtyNoteIds.delete(noteId);
  });

  setSyncStatus("Shared board ready. Everyone sees the same notes.", "ready");
}

function scheduleNoteSync(noteId) {
  if (!supabaseClient || isHydratingFromRemote) {
    return;
  }

  pendingSyncIds.set(noteId, true);
  locallyDirtyNoteIds.set(noteId, Date.now());
  window.clearTimeout(syncTimeoutId);
  syncTimeoutId = window.setTimeout(() => {
    flushPendingSync().catch((error) => {
      console.error(error);
      setSyncStatus("Could not sync to Supabase. Using local backup for now.", "error");
    });
  }, 250);
}

function scheduleTranslation(noteId) {
  if (translationTimeoutIds.has(noteId)) {
    window.clearTimeout(translationTimeoutIds.get(noteId));
  }

  const timeoutId = window.setTimeout(() => {
    translationTimeoutIds.delete(noteId);
    translateNote(noteId).catch((error) => {
      console.error("Could not translate note.", error);

      const latestNote = notes.find((note) => note.id === noteId);
      if (!latestNote?.text.trim()) {
        return;
      }

      updateNote(noteId, { translationStatus: "error" });
      renderNotes();
    });
  }, TRANSLATION_DEBOUNCE_MS);

  translationTimeoutIds.set(noteId, timeoutId);
}

async function translateNote(noteId) {
  const note = notes.find((entry) => entry.id === noteId);
  const sourceText = note?.text.trim();

  if (!note || !sourceText) {
    return;
  }

  if (!supabaseClient) {
    updateNote(noteId, { translatedText: "", translationStatus: "setup" });
    renderNotes();
    return;
  }

  const response = await fetch(getFunctionUrl(TRANSLATE_FUNCTION_NAME), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: window.SUPABASE_CONFIG.anonKey,
      Authorization: `Bearer ${window.SUPABASE_CONFIG.anonKey}`
    },
    body: JSON.stringify({ text: sourceText })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error || `Translation request failed with status ${response.status}.`;
    throw new Error(message);
  }

  const latestNote = notes.find((entry) => entry.id === noteId);

  if (!latestNote || latestNote.text.trim() !== sourceText) {
    return;
  }

  if (data?.unsupported) {
    updateNote(noteId, {
      translatedText: "",
      detectedLanguage: data.detectedLanguage || null,
      translationStatus: "unsupported"
    });
    renderNotes();
    return;
  }

  updateNote(noteId, {
    translatedText: data?.translatedText || "",
    detectedLanguage: data?.detectedLanguage || null,
    translationStatus: "translated"
  });
  renderNotes();
}

async function deleteNoteFromRemote(noteId) {
  if (!supabaseClient) {
    return;
  }

  pendingSyncIds.delete(noteId);
  locallyDirtyNoteIds.delete(noteId);

  const { error } = await supabaseClient.from("notes").delete().eq("id", noteId);

  if (error) {
    console.error("Could not delete note from Supabase.", error);
    setSyncStatus("Delete failed to sync. Refresh after checking Supabase setup.", "error");
    return;
  }

  setSyncStatus("Shared board ready. Everyone sees the same notes.", "ready");
}

function subscribeToRemoteChanges() {
  if (!supabaseClient) {
    return;
  }

  supabaseClient
    .channel("public:notes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notes" },
      async () => {
        try {
          await syncNotesFromRemote();
        } catch (error) {
          console.error("Could not refresh remote notes.", error);
          setSyncStatus("Remote updates could not be refreshed.", "error");
        }
      }
    )
    .subscribe();
}

function handleViewportResize() {
  const widthChanged = Math.abs(window.innerWidth - lastKnownViewportWidth) > 1;
  lastKnownViewportWidth = window.innerWidth;

  if (widthChanged) {
    keepNotesInsideBoard();
    return;
  }

  updateBoardCanvasSize();
}

async function initializeApp() {
  notes = loadNotes();
  highestZIndex = notes.reduce((max, note) => Math.max(max, note.zIndex || 1), highestZIndex);
  supabaseClient = initializeSupabase();
  renderNotes();

  if (!supabaseClient) {
    setSyncStatus("Supabase is not configured yet. Notes are saving only in this browser.", "warning");
    return;
  }

  try {
    await syncNotesFromRemote();
    subscribeToRemoteChanges();
  } catch (error) {
    console.error("Could not connect to Supabase.", error);
    setSyncStatus("Supabase connection failed. Notes are using local backup only.", "error");
  }
}

addNoteButton.addEventListener("click", addNewNote);
window.addEventListener("resize", handleViewportResize);

initializeApp();
