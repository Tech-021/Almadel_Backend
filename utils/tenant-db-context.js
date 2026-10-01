const { AsyncLocalStorage } = require("async_hooks");

const tenantDbStorage = new AsyncLocalStorage();

function runWithTenantDb(clients, fn) {
  return tenantDbStorage.run(clients, fn);
}

function getTenantDbStore() {
  return tenantDbStorage.getStore();
}

module.exports = {
  getTenantDbStore,
  runWithTenantDb,
};
