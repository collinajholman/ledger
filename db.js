/* =========================================================
   Ledger — IndexedDB persistence layer
   All user data (expenses, income, mileage, categories,
   settings) lives here. IndexedDB is used because it is
   the reliable, high-capacity, fully offline storage
   mechanism available in Safari on iOS, and — unlike
   sessionStorage/in-memory state — it survives the app
   being closed, the phone being restarted, and the page
   being refreshed.
   ========================================================= */
const DB_NAME = "LedgerDB";
const DB_VERSION = 1;
const STORES = ["expenses", "income", "mileage", "categories", "settings"];

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("expenses")) {
        db.createObjectStore("expenses", { keyPath: "id" }).createIndex("date", "date");
      }
      if (!db.objectStoreNames.contains("income")) {
        db.createObjectStore("income", { keyPath: "id" }).createIndex("date", "date");
      }
      if (!db.objectStoreNames.contains("mileage")) {
        db.createObjectStore("mileage", { keyPath: "id" }).createIndex("date", "date");
      }
      if (!db.objectStoreNames.contains("categories")) {
        db.createObjectStore("categories", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
    req.onblocked = () => reject(new Error("Database upgrade blocked — close other open tabs of this app."));
  });
  return _dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

const DB = {
  async put(storeName, obj) {
    const store = await tx(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const r = store.put(obj);
      r.onsuccess = () => resolve(obj);
      r.onerror = (e) => reject(e.target.error);
    });
  },

  async delete(storeName, id) {
    const store = await tx(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const r = store.delete(id);
      r.onsuccess = () => resolve(true);
      r.onerror = (e) => reject(e.target.error);
    });
  },

  async get(storeName, id) {
    const store = await tx(storeName, "readonly");
    return new Promise((resolve, reject) => {
      const r = store.get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = (e) => reject(e.target.error);
    });
  },

  async getAll(storeName) {
    const store = await tx(storeName, "readonly");
    return new Promise((resolve, reject) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = (e) => reject(e.target.error);
    });
  },

  async clear(storeName) {
    const store = await tx(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const r = store.clear();
      r.onsuccess = () => resolve(true);
      r.onerror = (e) => reject(e.target.error);
    });
  },

  async bulkPut(storeName, items) {
    const store = await tx(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      let count = 0;
      if (items.length === 0) return resolve(true);
      items.forEach((item) => {
        const r = store.put(item);
        r.onsuccess = () => { count++; if (count === items.length) resolve(true); };
        r.onerror = (e) => reject(e.target.error);
      });
    });
  }
};

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
