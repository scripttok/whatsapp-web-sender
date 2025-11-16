// server/auth/db.js
const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "../database/users.db");
const db = new Database(dbPath);

// Habilitar WAL para melhor desempenho
db.pragma("journal_mode = WAL");

// Criar tabelas se não existirem
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS active_sessions (
    user_id INTEGER,
    session_id TEXT UNIQUE,
    expires_at DATETIME,
    PRIMARY KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`);

// Funções de utilidade
const getUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const getUserById = db.prepare("SELECT * FROM users WHERE id = ?");
const insertUser = db.prepare(
  "INSERT INTO users (email, password, name) VALUES (?, ?, ?)"
);
const deleteUser = db.prepare("DELETE FROM users WHERE id = ?");
const getAllUsers = db.prepare(
  "SELECT id, email, name, created_at FROM users ORDER BY created_at DESC"
);

const getActiveSession = db.prepare(
  "SELECT * FROM active_sessions WHERE user_id = ?"
);
const insertSession = db.prepare(
  "INSERT OR REPLACE INTO active_sessions (user_id, session_id, expires_at) VALUES (?, ?, ?)"
);
const deleteSession = db.prepare(
  "DELETE FROM active_sessions WHERE session_id = ?"
);
const deleteSessionByUser = db.prepare(
  "DELETE FROM active_sessions WHERE user_id = ?"
);

module.exports = {
  db,
  getUserByEmail,
  getUserById,
  insertUser,
  deleteUser,
  getAllUsers,
  getActiveSession,
  insertSession,
  deleteSession,
  deleteSessionByUser,
};
