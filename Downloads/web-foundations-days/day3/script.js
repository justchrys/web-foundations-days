// ---------- Starting data ----------
let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" },
];

const VALID_CATEGORIES = ["personal", "work", "study"];

// ---------- Helper ----------
// Trims, lower-cases and collapses repeated spaces so texts can be compared fairly.
function normalize(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------- 1. searchNotes ----------
function searchNotes(word) {
  const search = word.toLowerCase();
  return notes.filter((note) => note.text.toLowerCase().includes(search));
}

// ---------- 2. longestNote ----------
function longestNote() {
  if (notes.length === 0) {
    return null;
  }
  let longest = notes[0];
  for (const note of notes) {
    if (note.text.length > longest.text.length) {
      longest = note;
    }
  }
  return longest;
}

// ---------- 3. countByCategory ----------
function countByCategory() {
  const counts = {};
  for (const note of notes) {
    if (counts[note.category] === undefined) {
      counts[note.category] = 1;
    } else {
      counts[note.category]++;
    }
  }
  return counts;
}

// ---------- 4. getSummary ----------
function getSummary() {
  const counts = countByCategory();
  const total = notes.length;
  const word = total === 1 ? "note" : "notes";

  const parts = [];
  for (const category of VALID_CATEGORIES) {
    if (counts[category] !== undefined) {
      parts.push(`${counts[category]} ${category}`);
    }
  }

  if (parts.length === 0) {
    return `${total} ${word}.`;
  }
  return `${total} ${word}: ${parts.join(", ")}.`;
}

// ---------- 5. isDuplicate ----------
function isDuplicate(text) {
  const target = normalize(text);
  return notes.some((note) => normalize(note.text) === target);
}

// ---------- 6. addNote ----------
function addNote(text, category) {
  if (typeof text !== "string" || text.trim().length < 1 || text.trim().length > 200) {
    console.log("Not added: text must be 1-200 characters.");
    return false;
  }
  if (!VALID_CATEGORIES.includes(category)) {
    console.log("Not added: category must be personal, work or study.");
    return false;
  }
  if (isDuplicate(text)) {
    console.log("Not added: a note with the same text already exists.");
    return false;
  }

  const newId = notes.length === 0 ? 1 : Math.max(...notes.map((note) => note.id)) + 1;
  notes.push({ id: newId, text: text.trim(), category: category });
  return true;
}

// ---------- Tests ----------
// Objects appear in the Console in a slightly different style, but the values match.

console.log("--- searchNotes ---");
console.log(searchNotes("the"));      // [ {id: 2, "Finish the Day 3 assignment"}, {id: 3, "Email the project report to Grace"} ]
console.log(searchNotes("MILK"));     // [ {id: 1, "Buy milk and bread", personal} ]  (upper case still matches)
console.log(searchNotes("zebra"));    // []  (edge case: no results)

console.log("--- longestNote ---");
console.log(longestNote());           // {id: 3, text: "Email the project report to Grace", category: "work"}
const savedNotes = notes;             // edge case: temporarily use an empty list
notes = [];
console.log(longestNote());           // null
notes = savedNotes;

console.log("--- countByCategory ---");
console.log(countByCategory());       // { personal: 2, study: 2, work: 1 }
notes = [];                           // edge case: empty list
console.log(countByCategory());       // {}
notes = savedNotes;

console.log("--- getSummary ---");
console.log(getSummary());            // "5 notes: 2 personal, 1 work, 2 study."
notes = [savedNotes[0]];              // edge case: exactly one note
console.log(getSummary());            // "1 note: 1 personal."
notes = [];                           // edge case: no notes
console.log(getSummary());            // "0 notes."
notes = savedNotes;

console.log("--- isDuplicate ---");
console.log(isDuplicate("  call   MUM  ")); // true  (ignores case and extra spaces)
console.log(isDuplicate("Walk the dog"));   // false (not in the list)

console.log("--- addNote ---");
console.log(addNote("Walk the dog", "personal"));  // true
console.log(addNote("walk the DOG ", "personal")); // logs "Not added: a note with the same text already exists." then false
console.log(addNote("   ", "work"));               // logs "Not added: text must be 1-200 characters." then false
console.log(addNote("a".repeat(201), "work"));     // logs "Not added: text must be 1-200 characters." then false
console.log(addNote("Plan holiday", "travel"));    // logs "Not added: category must be personal, work or study." then false

console.log("--- summary after adding ---");
console.log(getSummary());            // "6 notes: 3 personal, 1 work, 2 study."
