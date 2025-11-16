// client/login.js
document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const status = document.getElementById("login-status");

  function updateStatus(text, type = "error") {
    status.textContent = text;
    status.className = `status ${type}`;
    status.classList.remove("hidden");
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      updateStatus("Preencha email e senha");
      return;
    }

    // Desabilitar botão
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Entrando...";
    status.classList.add("hidden");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
        credentials: "include", // Importante: envia cookies
      });

      const data = await response.json();

      if (response.ok && data.success) {
        updateStatus("Login realizado! Redirecionando...", "connected");
        // Redireciona para o dashboard
        setTimeout(() => {
          window.location.href = "/";
        }, 1000);
      } else {
        updateStatus(data.error || "Erro no login");
      }
    } catch (error) {
      console.error("Login error:", error);
      updateStatus("Erro de conexão. Tente novamente.");
    } finally {
      // Reabilitar botão
      submitBtn.disabled = false;
      submitBtn.textContent = "Entrar";
    }
  });
});
