const loadButton = document.getElementById("load-users");
const filterInput = document.getElementById("filter-input");
const statusMessage = document.getElementById("status");
const usersList = document.getElementById("users-list");

const API_URL = "https://jsonplaceholder.typicode.com/users";

// All users loaded from the API (the filter works on this array, so no new request is needed)
let users = [];

// Draws any array of users in the list
function renderUsers(list) {
  usersList.replaceChildren();

  if (list.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No users match your filter.";
    usersList.append(empty);
    return;
  }

  for (const user of list) {
    const item = document.createElement("li");

    const name = document.createElement("strong");
    name.textContent = user.name;

    const email = document.createElement("p");
    email.textContent = `Email: ${user.email}`;

    const city = document.createElement("p");
    city.textContent = `City: ${user.address.city}`;

    const company = document.createElement("p");
    company.textContent = `Company: ${user.company.name}`;

    item.append(name, email, city, company);
    usersList.append(item);
  }
}

// Shows only users whose name includes the typed text (not case-sensitive)
function applyFilter() {
  if (users.length === 0) {
    return;
  }
  const term = filterInput.value.trim().toLowerCase();
  const matches = users.filter((user) => user.name.toLowerCase().includes(term));
  renderUsers(matches);
}

async function loadUsers() {
  loadButton.disabled = true;
  statusMessage.textContent = "Loading users...";

  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`);
    }

    users = await response.json();
    applyFilter();
    statusMessage.textContent = `Loaded ${users.length} users.`;
  } catch (error) {
    statusMessage.textContent = `Error: could not load users. ${error.message}`;
  } finally {
    loadButton.disabled = false;
  }
}

loadButton.addEventListener("click", loadUsers);
filterInput.addEventListener("input", applyFilter);
