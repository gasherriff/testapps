const STORAGE_KEY = "pastel-sticky-notes";
const NOTE_WIDTH = 260;
const NOTE_HEIGHT = 240;
const MOBILE_NOTE_WIDTH = 220;
const MOBILE_NOTE_HEIGHT = 210;
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
const noteTemplate = document.getElementById("note-template");

let highestZIndex = 1;
let notes = loadNotes();
highestZIndex = notes.reduce((max, note) => Math.max(max, note.zIndex || 1), highestZIndex);

function loadNotes() {
  try {
    const savedNotes = window.localStorage.getItem(STORAGE_KEY);

    if (!savedNotes) {
      return [
        createNoteData({
          text: "Tap here and write your sweetest ideas.",
          x: 42,
          y: 42,
          color: NOTE_COLORS[0]
        }),
        createNoteData({
          text: "Drag notes wherever you like.",
          x: 330,
          y: 110,
          color: NOTE_COLORS[2]
        })
      ];
    }

    return JSON.parse(savedNotes);
  } catch (error) {
    console.error("Could not load notes from localStorage.", error);
    return [];
  }
}

function saveNotes() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

function createNoteData(overrides = {}) {
  highestZIndex += 1;

  return {
    id: crypto.randomUUID(),
    text: "",
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
    x: 24,
    y: 24,
    zIndex: highestZIndex,
    ...overrides
  };
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
  const maxX = Math.max(12, notesBoard.clientWidth - width - 12);
  const maxY = Math.max(12, notesBoard.clientHeight - height - 12);

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

  if (noteElement) {
    noteElement.style.zIndex = targetNote.zIndex;
  }
}

function updateNote(noteId, updates) {
  notes = notes.map((note) => (note.id === noteId ? { ...note, ...updates } : note));
  saveNotes();
}

function deleteNote(noteId) {
  notes = notes.filter((note) => note.id !== noteId);
  saveNotes();
  renderNotes();
}

function addNewNote() {
  const position = positionNewNote();
  const note = createNoteData(position);
  notes.push(note);
  saveNotes();
  renderNotes();

  const textArea = notesBoard.querySelector(`[data-note-id="${note.id}"] .note-text`);
  textArea?.focus();
}

function renderNotes() {
  notesBoard.innerHTML = "";

  notes
    .slice()
    .sort((first, second) => (first.zIndex || 0) - (second.zIndex || 0))
    .forEach((note) => {
      const noteFragment = noteTemplate.content.cloneNode(true);
      const noteElement = noteFragment.querySelector(".note");
      const textArea = noteFragment.querySelector(".note-text");
      const label = noteFragment.querySelector(".sr-only");
      const deleteButton = noteFragment.querySelector(".delete-note-button");

      noteElement.dataset.noteId = note.id;
      noteElement.style.left = `${note.x}px`;
      noteElement.style.top = `${note.y}px`;
      noteElement.style.background = note.color;
      noteElement.style.zIndex = note.zIndex || 1;

      const textAreaId = `note-text-${note.id}`;
      textArea.id = textAreaId;
      textArea.value = note.text;
      label.htmlFor = textAreaId;

      textArea.addEventListener("input", (event) => {
        updateNote(note.id, { text: event.target.value });
      });

      textArea.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        bringNoteToFront(note.id, noteElement);
      });

      deleteButton.addEventListener("click", () => {
        deleteNote(note.id);
      });

      setupDrag(noteElement, note.id);
      notesBoard.appendChild(noteFragment);
    });
}

function setupDrag(noteElement, noteId) {
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  noteElement.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".delete-note-button") || event.target.closest(".note-text")) {
      return;
    }

    event.preventDefault();

    bringNoteToFront(noteId, noteElement);
    noteElement.classList.add("is-dragging");

    const noteRect = noteElement.getBoundingClientRect();
    dragOffsetX = event.clientX - noteRect.left;
    dragOffsetY = event.clientY - noteRect.top;

    noteElement.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent) => {
      const boardRect = notesBoard.getBoundingClientRect();
      const nextPosition = clampPosition(
        moveEvent.clientX - boardRect.left - dragOffsetX,
        moveEvent.clientY - boardRect.top - dragOffsetY
      );

      noteElement.style.left = `${nextPosition.x}px`;
      noteElement.style.top = `${nextPosition.y}px`;
      updateNote(noteId, nextPosition);
    };

    const stopDragging = (pointerEvent) => {
      noteElement.classList.remove("is-dragging");
      noteElement.releasePointerCapture(pointerEvent.pointerId);
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
  }

  renderNotes();
}

addNoteButton.addEventListener("click", addNewNote);
window.addEventListener("resize", keepNotesInsideBoard);

renderNotes();
