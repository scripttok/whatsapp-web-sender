// client/admin/script.js
document.addEventListener("DOMContentLoaded", async () => {
  const createBtn = document.getElementById("create-btn");
  const status = document.getElementById("create-status");
  const usersList = document.getElementById("users-list");

  function showStatus(msg, type = "error") {
    status.textContent = msg;
    status.className = `status ${type}`;
    status.classList.remove("hidden");
    setTimeout(() => status.classList.add("hidden"), 3000);
  }

  async function loadUsers() {
    try {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (!res.ok) throw new Error("Não autorizado");
      const users = await res.json();
      renderUsers(users);
    } catch (err) {
      showStatus("Erro ao carregar usuários");
    }
  }

  function renderUsers(users) {
    usersList.innerHTML = "";
    users.forEach((user) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
                <td>${user.email}</td>
                <td>${user.name || "-"}</td>
                <td>${new Date(user.created_at).toLocaleString("pt-BR")}</td>
                <td class="actions">
                    <button class="btn btn-danger" onclick="deleteUser(${
                      user.id
                    })">Excluir</button>
                </td>
            `;
      usersList.appendChild(tr);
    });
  }

  createBtn.onclick = async () => {
    const email = document.getElementById("new-email").value.trim();
    const name = document.getElementById("new-name").value.trim();
    const password = document.getElementById("new-password").value;

    if (!email || !password) {
      showStatus("Email e senha obrigatórios");
      return;
    }

    createBtn.disabled = true;
    createBtn.textContent = "Criando...";

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password }),
        credentials: "include",
      });

      const data = await res.json();
      if (res.ok) {
        showStatus("Usuário criado com sucesso!", "success");
        document.getElementById("new-email").value = "";
        document.getElementById("new-name").value = "";
        document.getElementById("new-password").value = "";
        loadUsers();
      } else {
        showStatus(data.error || "Erro ao criar");
      }
    } catch (err) {
      showStatus("Erro de conexão");
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = "Criar Usuário";
    }
  };

  window.deleteUser = async (id) => {
    if (!confirm("Excluir este usuário?")) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        loadUsers();
      } else {
        showStatus("Erro ao excluir");
      }
    } catch (err) {
      showStatus("Erro de conexão");
    }
  };

  loadUsers();
});
