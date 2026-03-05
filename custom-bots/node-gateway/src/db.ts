/** Backward-compat re-export; canonical definition in infrastructure/persistence. */
export {
  createPool,
  runMigrations,
  createUserStateRepository,
  createAllowedChatRepository,
  createOutboxRepository,
} from "./infrastructure/persistence.js";
